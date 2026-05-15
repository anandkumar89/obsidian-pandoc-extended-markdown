import { Text } from '@codemirror/state';
import { extractSectionsFromDoc, numberSections } from '../../shared/extractors/sectionExtractor';
import { LongformProjectManager } from '../../core/state/longformProjectManager';

/**
 * Scans a document for headings and returns a map of line number to section number string.
 * If the file is part of a Longform project, it uses the global project-wide numbering.
 * Otherwise, it calculates local numbering for the file.
 */
export function scanSections(
    doc: Text,
    filePath?: string
): Map<number, string> {
    const sectionNumbers = new Map<number, string>();
    const pm = LongformProjectManager.getInstance();

    if (filePath && pm.isFileInProject(filePath)) {
        const projectSections = pm.getProjectSections(filePath);
        // Find sections that belong to this file
        for (const section of projectSections) {
            if (section.filePath === filePath && section.number) {
                sectionNumbers.set(section.lineNumber, section.number);
            }
        }
    } else {
        // Local numbering for independent file
        const sections = extractSectionsFromDoc(doc);
        numberSections(sections);
        for (const section of sections) {
            if (section.number) {
                sectionNumbers.set(section.lineNumber, section.number);
            }
        }
    }

    return sectionNumbers;
}
