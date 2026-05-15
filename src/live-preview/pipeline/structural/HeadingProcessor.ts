import { Decoration } from '@codemirror/view';
import { Line } from '@codemirror/state';
import { ListPatterns } from '../../../shared/patterns';
import { isSyntaxFeatureEnabled } from '../../../shared/types/settingsTypes';
import { ProcessingContext, StructuralResult, StructuralProcessor } from '../types';
import { HeadingNumberWidget } from '../../widgets/HeadingNumberWidget';

export class HeadingProcessor implements StructuralProcessor {
    name = 'heading';
    priority = 10; // High priority to catch headings early

    canProcess(line: Line, context: ProcessingContext): boolean {
        if (!isSyntaxFeatureEnabled(context.settings, 'enableHeadingNumbering')) {
            return false;
        }

        const match = line.text.match(ListPatterns.HEADING_WITH_CONTENT);
        return !!match && match[1].length <= 5;
    }

    process(line: Line, context: ProcessingContext): StructuralResult {
        const match = line.text.match(ListPatterns.HEADING_WITH_CONTENT);
        if (!match || match[1].length > 5) {
            return { decorations: [] };
        }

        const hashLength = match[1].length + 1; // hashes + space
        const decorations: Array<{ from: number; to: number; decoration: Decoration }> = [];

        // Get the computed number for this line
        const sectionNumber = context.sectionNumbers?.get(line.number - 1);

        if (sectionNumber && !this.isCursorOnHeading(line, context)) {
            // Add a widget decoration to show the number
            // We place it right after the hashes and space
            decorations.push({
                from: line.from + hashLength,
                to: line.from + hashLength,
                decoration: Decoration.widget({
                    widget: new HeadingNumberWidget(sectionNumber),
                    side: 1
                })
            });
        }

        return {
            decorations,
            skipFurtherProcessing: false // Allow other processors to see the heading if needed
        };
    }

    private isCursorOnHeading(line: Line, context: ProcessingContext): boolean {
        const cursorPos = context.view.state.selection?.main?.head;
        return cursorPos !== undefined && cursorPos >= line.from && cursorPos <= line.to;
    }
}
