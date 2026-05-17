import { Decoration } from '@codemirror/view';
import { Line } from '@codemirror/state';
import { CSS_CLASSES } from '../../../core/constants';
import { isSyntaxFeatureEnabled } from '../../../shared/types/settingsTypes';
import { FencedDivStackItem } from '../../../shared/types/fencedDivTypes';
import { ProcessingContext, StructuralResult } from '../types';
import { StructuralProcessor } from '../types';
import {
    getFencedDivCssClass,
    getFencedDivDisplayName,
    isFencedDivClosing,
    parseFencedDivOpening
} from './fencedDiv/parser';
import { FencedDivClosingWidget, FencedDivHeaderWidget } from '../../widgets';
import { LongformProjectManager } from '../../../core/state/longformProjectManager';

export class FencedDivProcessor implements StructuralProcessor {
    name = 'fenced-div';
    priority = 18;
    private readonly maxDepthClass = 6;

    canProcess(line: Line, context: ProcessingContext): boolean {
        if (!isSyntaxFeatureEnabled(context.settings, 'enableFencedDivs')) {
            return false;
        }

        if (this.canOpenAtCurrentLine(context) && parseFencedDivOpening(line.text)) {
            return true;
        }

        const stack = context.fencedDivStack || [];
        return stack.length > 0;
    }

    process(line: Line, context: ProcessingContext): StructuralResult {
        const opening = this.canOpenAtCurrentLine(context)
            ? parseFencedDivOpening(line.text)
            : null;
        if (opening) {
            return this.processOpeningFence(line, context, {
                label: opening.id,
                classes: opening.classes,
                openingLine: line.number,
                inlineTitle: opening.keyValues.get('title') || opening.inlineTitle,
                openingFence: opening.fence
            });
        }

        const closingFence = isFencedDivClosing(line.text);
        if (closingFence && (context.fencedDivStack || []).length > 0) {
            const stack = context.fencedDivStack!;
            const top = stack[stack.length - 1];
            if (closingFence.length >= top.openingFence.length) {
                return this.processClosingFence(line, context);
            }
        }

        return this.processContentLine(line, context);
    }

    private processOpeningFence(
        line: Line,
        context: ProcessingContext,
        stackItem: FencedDivStackItem
    ): StructuralResult {
        const displayName = getFencedDivDisplayName(stackItem.classes);
        let finalDisplayName = displayName;
        
        const pm = LongformProjectManager.getInstance();

        if (stackItem.label) {
            const globalRef = pm.getReference(stackItem.label, context.filePath || '');
            if (globalRef && globalRef.displayTitle) {
                finalDisplayName = globalRef.displayTitle;
            }
        } else if (context.filePath) {
            // Find it by line number
            const entries = pm.getFileEntries(context.filePath);
            const entry = entries.find(e => e.lineNumber === stackItem.openingLine - 1);
            if (entry && entry.displayTitle) {
                finalDisplayName = entry.displayTitle;
            }
        }

        const activeItem = {
            ...stackItem,
            displayName: finalDisplayName
        };

        context.fencedDivStack = context.fencedDivStack || [];
        context.fencedDivStack.push(activeItem);
        context.fencedDivBoundaryLine = line.number;

        const renderDepth = context.fencedDivStack.length;
        const decorations = [
            this.createFenceLineDecoration(line, 'cm-pem-fenced-div-open', stackItem.classes, renderDepth),
            this.createOpeningMarkerDecoration(line, context, finalDisplayName, stackItem.label, stackItem.inlineTitle)
        ];

        return {
            decorations,
            skipFurtherProcessing: true
        };
    }

    private processClosingFence(line: Line, context: ProcessingContext): StructuralResult {
        const stack = context.fencedDivStack || [];
        const renderDepth = stack.length;
        const closingItem = stack.pop();
        context.fencedDivBoundaryLine = line.number;
        const decorations = [
            this.createFenceLineDecoration(line, 'cm-pem-fenced-div-close', closingItem?.classes || [], renderDepth),
            this.createClosingMarkerDecoration(line, context)
        ];

        return {
            decorations,
            skipFurtherProcessing: true
        };
    }

    private processContentLine(line: Line, context: ProcessingContext): StructuralResult {
        const activeItem = this.getActiveItem(context);
        const renderDepth = (context.fencedDivStack || []).length;
        const stateClass = this.isBeforeClosingFence(line, context)
            ? 'cm-pem-fenced-div-content cm-pem-fenced-div-content-end'
            : 'cm-pem-fenced-div-content';
        const decorations = [
            this.createFenceLineDecoration(line, stateClass, activeItem?.classes || [], renderDepth)
        ];

        return {
            decorations,
            skipFurtherProcessing: false
        };
    }

    private createOpeningMarkerDecoration(
        line: Line,
        context: ProcessingContext,
        displayName: string,
        label?: string,
        inlineTitle?: string
    ): { from: number; to: number; decoration: Decoration } {
        if (this.isCursorOnFenceLine(line, context)) {
            return {
                from: line.from,
                to: line.to,
                decoration: Decoration.mark({
                    class: 'cm-pem-fenced-div-marker-cursor'
                })
            };
        }

        return {
            from: line.from,
            to: line.to,
            decoration: Decoration.replace({
                widget: new FencedDivHeaderWidget(displayName, label, inlineTitle, context.view, line.from, context.app, context.component),
                inclusive: false
            })
        };
    }

    private createClosingMarkerDecoration(
        line: Line,
        context: ProcessingContext
    ): { from: number; to: number; decoration: Decoration } {
        if (this.isCursorOnFenceLine(line, context)) {
            return {
                from: line.from,
                to: line.to,
                decoration: Decoration.mark({
                    class: 'cm-pem-fenced-div-marker-cursor'
                })
            };
        }

        return {
            from: line.from,
            to: line.to,
            decoration: Decoration.replace({
                widget: new FencedDivClosingWidget(context.view, line.from),
                inclusive: false
            })
        };
    }

    private createFenceLineDecoration(
        line: Line,
        stateClass: string,
        classes: string[],
        renderDepth: number
    ): { from: number; to: number; decoration: Decoration } {
        const primaryClass = getFencedDivCssClass(classes);
        const depthClass = Math.min(renderDepth, this.maxDepthClass);
        const className = [
            CSS_CLASSES.FENCED_DIV_LINE,
            stateClass,
            renderDepth > 1 ? 'cm-pem-fenced-div-inner' : undefined,
            renderDepth > 1 ? `cm-pem-fenced-div-depth-${depthClass}` : undefined,
            primaryClass ? `cm-pem-fenced-div-${primaryClass}` : undefined,
            primaryClass || undefined
        ].filter(Boolean).join(' ');

        return {
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: className })
        };
    }

    private getActiveItem(context: ProcessingContext): FencedDivStackItem | undefined {
        const stack = context.fencedDivStack || [];
        return stack[stack.length - 1];
    }

    private isCursorOnFenceLine(line: Line, context: ProcessingContext): boolean {
        const cursorPos = context.view.state.selection?.main?.head;
        return cursorPos !== undefined && cursorPos >= line.from && cursorPos <= line.to;
    }

    private canOpenAtCurrentLine(context: ProcessingContext): boolean {
        return context.fencedDivCanOpenAtCurrentLine ?? true;
    }

    private isBeforeClosingFence(line: Line, context: ProcessingContext): boolean {
        if (line.number >= context.document.lines) {
            return false;
        }

        const nextLineText = context.document.line(line.number + 1).text;
        const closingFence = isFencedDivClosing(nextLineText);
        if (!closingFence) return false;

        const stack = context.fencedDivStack || [];
        if (stack.length === 0) return false;

        const top = stack[stack.length - 1];
        return closingFence.length >= top.openingFence.length;
    }
}
