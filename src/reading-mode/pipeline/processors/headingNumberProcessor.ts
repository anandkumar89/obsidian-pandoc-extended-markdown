import { LongformProjectManager } from '../../../core/state/longformProjectManager';
import { numberSections } from '../../../shared/extractors/sectionExtractor';
import { BlockDomProcessor, ReadingModeContext } from '../types';
import { TFile } from 'obsidian';

export class HeadingNumberProcessor implements BlockDomProcessor {
    name = 'heading-numbers';
    phase = 'block' as const;
    priority = 10; // Process headings early

    isEnabled(context: ReadingModeContext): boolean {
        return context.config.enableHeadingNumbering !== false;
    }

    process(context: ReadingModeContext): void {
        const { element, postProcessorContext } = context;
        
        // Find all headings in the element (Obsidian often passes a single block)
        const headings = element.querySelectorAll('h1, h2, h3, h4, h5');
        if (headings.length === 0 && !['H1', 'H2', 'H3', 'H4', 'H5'].includes(element.tagName)) {
            return;
        }

        const headingEls = ['H1', 'H2', 'H3', 'H4', 'H5'].includes(element.tagName) 
            ? [element as HTMLElement] 
            : Array.from(headings) as HTMLElement[];

        let sectionNumbers: Map<number, string> | null = null;

        for (const headingEl of headingEls) {
            // Avoid double numbering
            if (headingEl.hasClass('pem-numbered')) continue;

            const sectionInfo = postProcessorContext.getSectionInfo(headingEl);
            if (!sectionInfo) continue;

            const lineNum = sectionInfo.lineStart;

            if (!sectionNumbers) {
                sectionNumbers = this.getSectionNumbers(context);
            }

            const number = sectionNumbers.get(lineNum);
            if (number) {
                const numberSpan = document.createElement('span');
                numberSpan.className = 'pem-heading-number';
                numberSpan.textContent = number + ' ';
                headingEl.prepend(numberSpan);
                headingEl.addClass('pem-numbered');
            }
        }
    }

    private getSectionNumbers(context: ReadingModeContext): Map<number, string> {
        const { sourcePath, config } = context;
        const pm = LongformProjectManager.getInstance();
        const sectionNumbers = new Map<number, string>();

        if (sourcePath && pm.isFileInProject(sourcePath)) {
            const projectSections = pm.getProjectSections(sourcePath);
            for (const section of projectSections) {
                if (section.filePath === sourcePath && section.number) {
                    sectionNumbers.set(section.lineNumber, section.number);
                }
            }
        } else if (sourcePath) {
            // For independent files, we need the full content to number headings correctly
            // Post-processor doesn't easily give full content unless we read it
            // However, we can try to use a cache or extract from the whole document if available
            // In Reading Mode, we might not have the full content in the context easily.
            // Let's see if we can get it from the app.
            const file = context.app?.vault.getAbstractFileByPath(sourcePath);
            if (file instanceof TFile) {
                // This is a bit tricky in reading mode without async.
                // But for now, we'll try to use the cache if it exists.
                const sections = pm.getFileSections(sourcePath);
                if (sections.length > 0) {
                    numberSections(sections);
                    for (const section of sections) {
                        if (section.number) sectionNumbers.set(section.lineNumber, section.number);
                    }
                }
            }
        }

        return sectionNumbers;
    }
}
