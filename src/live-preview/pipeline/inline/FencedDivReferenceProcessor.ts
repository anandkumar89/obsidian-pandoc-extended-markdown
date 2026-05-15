import { Decoration } from '@codemirror/view';
import { isSyntaxFeatureEnabled } from '../../../shared/types/settingsTypes';
import { getRegionCursorPosition } from '../../../shared/utils/cursorUtils';
import { FencedDivReferenceWidget } from '../../widgets';
import { ContentRegion, InlineMatch, InlineProcessor, ProcessingContext } from '../types';
import { LongformProjectManager } from '../../../core/state/longformProjectManager';

const PANDOC_CITATION_REFERENCE = /@([^\s,;)\]}]+)/g;
const TRAILING_REFERENCE_PUNCTUATION = /[.!?]+$/;

export class FencedDivReferenceProcessor implements InlineProcessor {
    name = 'fenced-div-reference';
    priority = 12;
    supportedRegions = new Set(['list-content', 'definition-content', 'paragraph', 'normal', 'fenced-div-content']);

    findMatches(text: string, region: ContentRegion, context: ProcessingContext): InlineMatch[] {
        const matches: InlineMatch[] = [];
        if (!isSyntaxFeatureEnabled(context.settings, 'enableFencedDivs')) {
            return matches;
        }

        const labels: Map<string, unknown> = context.fencedDivLabels || new Map<string, unknown>();
        const regionCursorPos = getRegionCursorPosition(context, region);
        let match: RegExpExecArray | null;

        while ((match = PANDOC_CITATION_REFERENCE.exec(text)) !== null) {
            const label = this.resolveLabel(match[1], labels);
            if (!label) {
                continue;
            }

            const refStart = match.index;
            const refEnd = refStart + label.length + 1;
            const cursorInRef = regionCursorPos >= refStart && regionCursorPos <= refEnd;

            if (!cursorInRef) {
                matches.push({
                    from: refStart,
                    to: refEnd,
                    type: 'fenced-div-ref',
                    data: {
                        label,
                        rawText: text.slice(refStart, refEnd),
                        region
                    }
                });
            }
        }

        return matches;
    }

    createDecoration(match: InlineMatch, context: ProcessingContext): Decoration {
        const label = typeof match.data.label === 'string' ? match.data.label : '';
        
        let displayName = 'Ref';
        let content = '';
        let isValid = true;

        if (label.startsWith('eq:')) {
            const tagLabel = label.substring(3);
            const eqRef = LongformProjectManager.getInstance().getEquationReference(tagLabel);
            isValid = !!eqRef;
            displayName = isValid ? `(${tagLabel})` : `@${label}`;
            content = eqRef?.content || 'Equation not found';
        } else if (label.startsWith('fig:')) {
            const figRef = LongformProjectManager.getInstance().getFigureReference(label);
            isValid = !!figRef;
            displayName = isValid ? (figRef?.displayTitle || label) : `@${label}`;
            content = figRef?.description || figRef?.imagePath || 'Figure not found';
        } else {
            const localReference = context.fencedDivLabels?.get(label);
            const globalReference = LongformProjectManager.getInstance().getReference(label);
            
            isValid = !!(localReference || globalReference);
            displayName = isValid 
                ? (globalReference?.displayTitle || globalReference?.displayName || localReference?.displayName || 'Div')
                : `@${label}`;
            content = localReference?.content || globalReference?.content || 'Reference not found';
        }
        
        const region = match.data.region as ContentRegion | undefined;
        const absolutePosition = match.from + (region?.from || 0);

        return Decoration.replace({
            widget: new FencedDivReferenceWidget(
                displayName,
                label,
                content,
                context.view,
                absolutePosition,
                context.app,
                context.component,
                isValid
            ),
            inclusive: false
        });
    }

    private resolveLabel(rawLabel: string, labels: Map<string, unknown>): string | undefined {
        // Always match labels that look like references (start with known prefixes or just alphanumeric)
        // This allows us to catch invalid labels and color them red.
        
        // If it starts with eq: or fig:, it's definitely a reference attempt
        if (rawLabel.startsWith('eq:') || rawLabel.startsWith('fig:')) {
            return rawLabel;
        }

        // If it exists locally or globally, it's valid
        if (LongformProjectManager.getInstance().getReference(rawLabel)) return rawLabel;
        if (labels.has(rawLabel)) return rawLabel;

        const trimmedLabel = rawLabel.replace(TRAILING_REFERENCE_PUNCTUATION, '');
        if (LongformProjectManager.getInstance().getReference(trimmedLabel)) return trimmedLabel;
        
        if (trimmedLabel !== rawLabel && labels.has(trimmedLabel)) {
            return trimmedLabel;
        }

        // If it has a colon and isn't a URL, it's likely an intended reference (e.g. thm:label)
        if (rawLabel.includes(':') && !rawLabel.includes('://')) {
            return rawLabel;
        }

        // For plain labels without colons, we only match if they exist
        // to avoid coloring every @word as a red invalid label.
        return undefined;
    }
}
