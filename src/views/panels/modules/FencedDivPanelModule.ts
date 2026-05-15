import { MarkdownView } from 'obsidian';

import { BasePanelModule } from './BasePanelModule';

import { CSS_CLASSES, ICONS, MESSAGES } from '../../../core/constants';
import { FencedDivPanelItem, extractFencedDivs } from '../../../shared/extractors/fencedDivExtractor';
import { handleError } from '../../../shared/utils/errorHandler';
import { truncateContentWithRendering } from '../utils/contentTruncator';
import { renderContentWithMath, setupLabelClickHandler } from '../utils/viewInteractions';
import { setupRenderedHoverPreview } from '../../../shared/utils/hoverPopovers';
import { highlightLine } from '../../editor/highlightUtils';
import { LongformProjectManager } from '../../../core/state/longformProjectManager';

export class FencedDivPanelModule extends BasePanelModule {
    id = 'fenced-divs';
    displayName = 'Fenced Divs';
    icon = ICONS.FENCED_DIV_SVG;

    private showProjectBlocks = false;
    private showPreviews = true;
    private lastActiveView: MarkdownView | null = null;

    private fencedDivItems: FencedDivPanelItem[] = [];

    protected cleanupModuleData(): void {
        this.fencedDivItems = [];
    }

    protected extractData(content: string): void {
        this.fencedDivItems = extractFencedDivs(content, this.plugin.settings);
    }

    /** Render module-specific action buttons into the top bar */
    renderActions(actionsEl: HTMLElement, activeView: MarkdownView | null): void {
        const filePath = activeView?.file?.path;
        const pm = LongformProjectManager.getInstance();
        const isInProject = filePath ? pm.isFileInProject(filePath) : false;

        const previewBtn = actionsEl.createEl('button', {
            cls: `pem-toggle-btn ${this.showPreviews ? 'is-active' : ''}`,
            attr: { 'aria-label': 'Toggle previews' }
        });
        previewBtn.createSpan({ text: '👁', cls: 'pem-toggle-icon' });
        previewBtn.addEventListener('click', () => {
            this.showPreviews = !this.showPreviews;
            if (activeView) this.updateContent(activeView);
            // Re-render actions to update active state
            actionsEl.empty();
            this.renderActions(actionsEl, activeView);
        });

        if (isInProject) {
            const projectBtn = actionsEl.createEl('button', {
                cls: `pem-toggle-btn ${this.showProjectBlocks ? 'is-active' : ''}`,
                attr: { 'aria-label': 'Show all project blocks' }
            });
            projectBtn.createSpan({ text: '📁', cls: 'pem-toggle-icon' });
            projectBtn.addEventListener('click', () => {
                this.showProjectBlocks = !this.showProjectBlocks;
                if (activeView) this.updateContent(activeView);
                actionsEl.empty();
                this.renderActions(actionsEl, activeView);
            });
        }
    }

    protected renderContent(activeView: MarkdownView | null): void {
        this.lastActiveView = activeView;
        const pm = LongformProjectManager.getInstance();
        const pinnedPath = pm.getPinnedProjectPath();
        const filePath = activeView?.file?.path || pinnedPath || '';
        const isInProject = pinnedPath || (filePath ? pm.isFileInProject(filePath) : false);

        let itemsToRender: FencedDivPanelItem[] = [];

        if (isInProject && this.showProjectBlocks && filePath) {
            const globalEntries = pm.getProjectEntries(filePath);
            itemsToRender = globalEntries.map(e => ({
                title: e.displayTitle || e.displayName,
                content: e.content,
                lineNumber: e.lineNumber,
                classes: e.classes,
                label: e.label,
                inlineTitle: e.inlineTitle,
                contentLineNumber: e.lineNumber,
                contentPosition: { line: e.lineNumber, ch: 0 },
                position: { line: e.lineNumber, ch: 0 },
                filePath: e.filePath
            }));
        } else {
            itemsToRender = this.fencedDivItems.map(item => {
                 let finalTitle = item.title;
                 let inlineTitle = item.inlineTitle;
                 if (item.label) {
                      const globalRef = pm.getReference(item.label);
                      if (globalRef && globalRef.displayTitle) {
                           finalTitle = globalRef.displayTitle;
                      }
                      if (globalRef && globalRef.inlineTitle) {
                           inlineTitle = globalRef.inlineTitle;
                      }
                 }
                 return { ...item, title: finalTitle, inlineTitle };
            });
        }

        if (this.searchQuery) {
            itemsToRender = itemsToRender.filter(item => 
                item.title.toLowerCase().includes(this.searchQuery) ||
                item.label.toLowerCase().includes(this.searchQuery) ||
                (item.inlineTitle || '').toLowerCase().includes(this.searchQuery) ||
                item.content.toLowerCase().includes(this.searchQuery) ||
                item.classes.some(c => c.toLowerCase().includes(this.searchQuery))
            );
        }

        this.renderFencedDivItemsList(activeView, itemsToRender);
    }

    protected showNoFileMessage(): void {
        if (!this.containerEl) return;

        this.containerEl.createEl('div', {
            text: MESSAGES.NO_ACTIVE_FILE,
            cls: CSS_CLASSES.FENCED_DIV_PANEL_EMPTY
        });
        this.fencedDivItems = [];
    }

    private renderFencedDivItemsList(activeView: MarkdownView, items: FencedDivPanelItem[]): void {
        if (!this.containerEl) return;

        if (items.length === 0) {
            this.containerEl.createEl('div', {
                text: this.searchQuery ? 'No matching blocks found' : 'No labelled blocks found',
                cls: CSS_CLASSES.FENCED_DIV_PANEL_EMPTY
            });
            return;
        }

        const container = this.containerEl.createEl('div', {
            cls: CSS_CLASSES.FENCED_DIV_PANEL_CONTAINER
        });

        for (const item of items) {
            this.renderFencedDivItem(container, item, activeView);
        }
    }

    private renderFencedDivItem(container: HTMLElement, item: FencedDivPanelItem, activeView: MarkdownView | null): void {
        const itemEl = container.createEl('div', {
            cls: CSS_CLASSES.FENCED_DIV_PANEL_ROW
        });

        // Row 1: blockname+number (left) — label (right)
        const headerEl = itemEl.createEl('div', { cls: 'pem-block-header' });

        const titleEl = headerEl.createEl('span', { cls: 'pem-block-title' });
        // Show title with inline title if present
        const titleText = item.inlineTitle 
            ? `${item.title} (${item.inlineTitle})`
            : item.title;
        titleEl.createEl('span', { text: titleText, cls: 'pem-block-title-text' });

        if (item.label) {
            const labelEl = headerEl.createEl('span', { cls: 'pem-block-label' });
            labelEl.textContent = `@${item.label}`;
            setupLabelClickHandler(labelEl, `@${item.label}`, this.abortController?.signal);
        }

        // Row 2: preview (if enabled)
        if (this.showPreviews) {
            const contentEl = itemEl.createEl('div', {
                cls: CSS_CLASSES.FENCED_DIV_PANEL_CONTENT
            });
            this.renderContentCell(contentEl, item);
        }

        // Setup cmd+hover preview for the whole row
        setupRenderedHoverPreview(itemEl, item.content, this.plugin.app, this.plugin, this.currentContext, undefined, this.abortController?.signal);

        this.setupContentClickHandler(itemEl, item, activeView);
    }

    private renderContentCell(contentEl: HTMLElement, item: FencedDivPanelItem): void {
        // For content with display math ($$), pass the full content for rendering
        const content = item.content;
        const truncatedContent = truncateContentWithRendering(content);
        renderContentWithMath(contentEl, truncatedContent, this.plugin.app, this.plugin, this.currentContext);
    }

    private setupContentClickHandler(
        element: HTMLElement,
        item: FencedDivPanelItem,
        activeView: MarkdownView
    ): void {
        const clickHandler = () => {
            try {
                if (item.filePath && item.filePath !== activeView?.file?.path) {
                    const targetFile = this.plugin.app.vault.getAbstractFileByPath(item.filePath);
                    if (targetFile) {
                        const leaf = this.plugin.app.workspace.getLeaf(false);
                        leaf.openFile(targetFile as any, { eState: { line: item.lineNumber } });
                        return;
                    }
                }

                if (!activeView?.editor) {
                    return;
                }

                const leaves = this.plugin.app.workspace.getLeavesOfType('markdown');
                const targetLeaf = leaves.find((leaf) => leaf.view === activeView);
                if (targetLeaf) {
                    this.plugin.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
                }

                activeView.editor.setCursor(item.contentPosition);
                activeView.editor.scrollIntoView({
                    from: item.contentPosition,
                    to: item.contentPosition
                }, true);
                highlightLine(activeView, item.contentLineNumber);
            } catch (error) {
                handleError(error, 'Scroll to fenced div content');
            }
        };

        element.addEventListener('click', clickHandler, { signal: this.abortController?.signal });
    }
}
