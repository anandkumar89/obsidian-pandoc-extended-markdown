import { Text } from '@codemirror/state';
import { EditorSuggest } from 'obsidian';
import type { Editor, EditorPosition, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import type { PandocExtendedMarkdownPlugin } from '../../core/main';
import type { FencedDivSuggestion } from '../../shared/types/fencedDivTypes';
import { CSS_CLASSES, TEXT_PROCESSING } from '../../core/constants';
import { scanFencedDivs } from '../../live-preview/scanners/fencedDivScanner';
import { extractEquations } from '../../shared/extractors/equationExtractor';
import { extractFigures } from '../../shared/extractors/figureExtractor';
import { isSyntaxFeatureEnabled } from '../../shared/types/settingsTypes';
import { withErrorBoundary } from '../../shared/utils/errorHandler';
import { LongformProjectManager } from '../../core/state/longformProjectManager';

const CITATION_QUERY_STOP = /[\s,;)\]}]/;
const NO_PREVIEW_TEXT = '(no content)';

type DivFactory = (options?: { cls?: string }) => HTMLElement;
type ObsidianDivParent = HTMLElement & {
    createDiv?: DivFactory;
};

/**
 * Simple fuzzy matching: checks if all characters of the query appear
 * in order in the target string (case-insensitive).
 */
function fuzzyMatch(query: string, target: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) qi++;
    }
    return qi === q.length;
}

/**
 * Score a fuzzy match — lower is better. Prefers prefix matches and shorter targets.
 */
function fuzzyScore(query: string, target: string): number {
    if (!query) return 0;
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    if (t.startsWith(q)) return 0;           // exact prefix → best
    if (t.includes(q)) return 1;             // substring
    return 2;                                // dispersed fuzzy
}

export class FencedDivReferenceSuggest extends EditorSuggest<FencedDivSuggestion> {
    plugin: PandocExtendedMarkdownPlugin;

    constructor(plugin: PandocExtendedMarkdownPlugin) {
        super(plugin.app);
        this.plugin = plugin;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        if (!isSyntaxFeatureEnabled(this.plugin.settings, 'enableFencedDivs')) {
            return null;
        }

        const line = editor.getLine(cursor.line).substring(0, cursor.ch);
        const startIndex = line.lastIndexOf('@');
        if (startIndex < 0) {
            return null;
        }

        // 1. Avoid triggering on emails or middle-of-word @
        const charBefore = startIndex > 0 ? line[startIndex - 1] : '';
        if (charBefore && /[a-zA-Z0-9]/.test(charBefore)) {
            return null;
        }

        // 2. Avoid clashing with Pandoc citations: [@cite] or [see @cite; @cite2]
        // We ignore @ if it's immediately preceded by [ or ; (ignoring whitespace)
        // Also ignore ( to avoid example list markers like (@label)
        const textBefore = line.substring(0, startIndex).trim();
        if (textBefore.endsWith('[') || textBefore.endsWith(';') || textBefore.endsWith('(')) {
            return null;
        }

        const query = line.substring(startIndex + 1);
        if (CITATION_QUERY_STOP.test(query)) {
            return null;
        }

        return {
            start: {
                ch: startIndex,
                line: cursor.line
            },
            end: cursor,
            query
        };
    }

    getSuggestions(context: EditorSuggestContext): FencedDivSuggestion[] {
        return withErrorBoundary(
            () => this.getSuggestionsInternal(context),
            [],
            'FencedDivReferenceSuggest.getSuggestions'
        );
    }

    private getSuggestionsInternal(context: EditorSuggestContext): FencedDivSuggestion[] {
        if (!isSyntaxFeatureEnabled(this.plugin.settings, 'enableFencedDivs')) {
            return [];
        }

        const query = context.query;
        const doc = Text.of(context.editor.getValue().split('\n'));
        const labels = scanFencedDivs(doc, this.plugin.settings);
        const suggestions: (FencedDivSuggestion & { isExternal?: boolean; fileTag?: string })[] = [];
        const seenLabels = new Set<string>();

        const activeFile = this.plugin.app.workspace.getActiveFile();
        const activeFilePath = activeFile?.path || '';

        // Local labels
        for (const reference of labels.values()) {
            if (!reference.label) continue;
            
            if (query && !fuzzyMatch(query, reference.label) && !fuzzyMatch(query, reference.displayName)) {
                continue;
            }

            seenLabels.add(reference.label);
            suggestions.push({
                label: reference.label,
                displayName: reference.displayName,
                previewText: this.createPreviewText(reference.content),
                lineNumber: reference.lineNumber,
                isExternal: false
            });
        }

        // Global labels
        for (const reference of LongformProjectManager.getInstance().getAllReferences()) {
            if (!reference.label || seenLabels.has(reference.label)) continue;
            if (reference.filePath === activeFilePath) continue;

            if (query && !fuzzyMatch(query, reference.label) && !fuzzyMatch(query, reference.displayName)) {
                continue;
            }

            let fileTag = 'Other';
            if (reference.filePath) {
                const parts = reference.filePath.split('/');
                fileTag = parts[parts.length - 1].replace('.md', '');
            }

            suggestions.push({
                label: reference.label,
                displayName: reference.displayTitle || reference.displayName,
                previewText: this.createPreviewText(reference.content),
                lineNumber: reference.lineNumber,
                isExternal: true,
                fileTag
            });
        }

        // Local Equations
        const localEquations = extractEquations(context.editor.getValue());
        for (const reference of localEquations) {
            if (!reference.label) continue;
            const fullLabel = `eq:${reference.label}`;
            
            if (query && !fuzzyMatch(query, fullLabel)) continue;

            seenLabels.add(fullLabel);
            suggestions.push({
                label: fullLabel,
                displayName: `(${fullLabel})`,
                previewText: this.createPreviewText(reference.content),
                lineNumber: reference.lineNumber,
                isExternal: false
            });
        }

        // Global Equations
        for (const reference of LongformProjectManager.getInstance().getAllEquationReferences()) {
            if (!reference.label) continue;
            const fullLabel = `eq:${reference.label}`;
            if (seenLabels.has(fullLabel)) continue;
            if (reference.filePath === activeFilePath) continue;

            if (query && !fuzzyMatch(query, fullLabel)) continue;

            let fileTag = 'Other';
            if (reference.filePath) {
                const parts = reference.filePath.split('/');
                fileTag = parts[parts.length - 1].replace('.md', '');
            }

            suggestions.push({
                label: fullLabel,
                displayName: `(${fullLabel})`,
                previewText: this.createPreviewText(reference.content),
                lineNumber: reference.lineNumber,
                isExternal: true,
                fileTag
            });
        }

        // Local Figures
        const localFigures = extractFigures(context.editor.getValue());
        for (const fig of localFigures) {
            if (!fig.label) continue;
            if (query && !fuzzyMatch(query, fig.label)) continue;

            seenLabels.add(fig.label);
            suggestions.push({
                label: fig.label,
                displayName: fig.displayTitle || fig.label,
                previewText: fig.description || fig.imagePath,
                lineNumber: fig.lineNumber,
                isExternal: false
            });
        }

        // Global Figures
        for (const fig of LongformProjectManager.getInstance().getAllFigureReferences()) {
            if (!fig.label || seenLabels.has(fig.label)) continue;
            if (fig.filePath === activeFilePath) continue;
            if (query && !fuzzyMatch(query, fig.label)) continue;

            let fileTag = 'Other';
            if (fig.filePath) {
                const parts = fig.filePath.split('/');
                fileTag = parts[parts.length - 1].replace('.md', '');
            }

            suggestions.push({
                label: fig.label,
                displayName: fig.displayTitle || fig.label,
                previewText: fig.description || fig.imagePath,
                lineNumber: fig.lineNumber,
                isExternal: true,
                fileTag
            });
        }

        // Sort: best fuzzy matches first, then alphabetical
        return suggestions.sort((a, b) => {
            const sa = fuzzyScore(query, a.label);
            const sb = fuzzyScore(query, b.label);
            if (sa !== sb) return sa - sb;
            return a.label.localeCompare(b.label);
        });
    }

    renderSuggestion(suggestion: FencedDivSuggestion, el: HTMLElement): void {
        withErrorBoundary(
            () => this.renderSuggestionInternal(suggestion, el),
            undefined,
            'FencedDivReferenceSuggest.renderSuggestion'
        );
    }

    private renderSuggestionInternal(suggestion: FencedDivSuggestion & { isExternal?: boolean; fileTag?: string }, el: HTMLElement): void {
        const container = this.createDiv(el, 'pem-suggest-item');

        // Left: compact tag + file info
        const leftCol = this.createDiv(container, 'pem-suggest-left');

        const tagEl = leftCol.createEl('div', { cls: 'pem-suggest-tag' });
        tagEl.textContent = `@${suggestion.label}`;

        if (suggestion.isExternal && suggestion.fileTag) {
            const fileEl = leftCol.createEl('div', { cls: 'pem-suggest-file' });
            fileEl.textContent = suggestion.fileTag;
        }

        // Right: preview
        const rightCol = this.createDiv(container, 'pem-suggest-preview');
        rightCol.textContent = suggestion.previewText;
    }

    selectSuggestion(suggestion: FencedDivSuggestion, evt: MouseEvent | KeyboardEvent): void {
        if (!this.context) return;

        const { editor, start, end } = this.context;
        const replacement = `@${suggestion.label}`;
        editor.replaceRange(replacement, start, end);
        editor.setCursor({
            line: start.line,
            ch: start.ch + replacement.length
        });
    }

    private createPreviewText(content: string): string {
        if (!content) {
            return NO_PREVIEW_TEXT;
        }

        const normalized = content.replace(/\s+/g, ' ').trim();
        if (normalized.length <= TEXT_PROCESSING.PREVIEW_TRUNCATE_LENGTH) {
            return normalized;
        }

        return normalized.substring(0, TEXT_PROCESSING.PREVIEW_TRUNCATE_LENGTH) +
            TEXT_PROCESSING.PREVIEW_ELLIPSIS;
    }

    private createDiv(parent: HTMLElement, className: string): HTMLElement {
        const obsidianParent = parent as ObsidianDivParent;
        if (obsidianParent.createDiv) {
            return obsidianParent.createDiv({ cls: className });
        }

        const div = document.createElement('div');
        div.className = className;
        parent.appendChild(div);
        return div;
    }
}
