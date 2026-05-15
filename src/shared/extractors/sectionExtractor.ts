import { Text } from '@codemirror/state';
import { ListPatterns } from '../patterns';

export interface SectionEntry {
    level: number;         // 1-5 (H1-H5, H6 excluded)
    title: string;         // raw heading text
    lineNumber: number;    // 0-indexed
    filePath?: string;
    mtime?: number;
    // Populated by numbering engine:
    number?: string;       // e.g. "1", "1.2", "1.2.3"
    displayTitle?: string; // e.g. "1.2 Background"
}

/**
 * Extract headings from markdown content.
 * Skips H6 (reserved for paragraphs) and headings inside code blocks / fenced divs.
 */
export function extractSections(content: string): SectionEntry[] {
    return extractSectionsFromDoc(Text.of(content.split('\n')));
}

/**
 * Extract headings from a CodeMirror document.
 * Skips H6 (reserved for paragraphs) and headings inside code blocks / fenced divs.
 */
export function extractSectionsFromDoc(doc: Text): SectionEntry[] {
    const items: SectionEntry[] = [];
    let inCodeBlock = false;
    let codeFenceMarker = '';

    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const trimmed = line.text.trim();

        // Track code blocks
        if (!inCodeBlock) {
            const codeMatch = trimmed.match(/^(`{3,}|~{3,})/);
            if (codeMatch) {
                inCodeBlock = true;
                codeFenceMarker = codeMatch[1].charAt(0).repeat(codeMatch[1].length);
                continue;
            }
        } else {
            if (trimmed === codeFenceMarker || trimmed.startsWith(codeFenceMarker)) {
                inCodeBlock = false;
                codeFenceMarker = '';
            }
            continue;
        }

        // Match ATX headings: # to ##### (H1-H5)
        const headingMatch = line.text.match(ListPatterns.HEADING_WITH_CONTENT);
        if (headingMatch) {
            const hashes = headingMatch[1];
            const level = hashes.length;
            if (level <= 5) {
                const title = headingMatch[2].trim();
                items.push({
                    level,
                    title,
                    lineNumber: i - 1,
                });
            }
        }
    }

    return items;
}

/**
 * Number sections within a flat list of SectionEntry[].
 * Chapters (#) are numbered 1, 2, 3...
 * Sections (##) are numbered 1.1, 1.2, 2.1...
 * And so on up to level 5.
 * 
 * Mutates entries in place and returns them.
 */
export function numberSections(entries: SectionEntry[]): SectionEntry[] {
    // counters[0] = chapter count, counters[1] = section count, etc.
    const counters = [0, 0, 0, 0, 0];

    for (const entry of entries) {
        const idx = entry.level - 1; // level 1 → index 0

        // Increment this level
        counters[idx]++;

        // Reset all deeper levels
        for (let j = idx + 1; j < counters.length; j++) {
            counters[j] = 0;
        }

        // Build number string: only include levels that have been set
        const parts: number[] = [];
        for (let j = 0; j <= idx; j++) {
            parts.push(counters[j]);
        }
        entry.number = parts.join('.');
        entry.displayTitle = `${entry.number} ${entry.title}`;
    }

    return entries;
}
