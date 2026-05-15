export interface CitationEntry {
    citekey: string;
    lineNumber: number;
    filePath?: string;
    fullText: string; // The full citation text including @
    context?: string;  // The surrounding text [ ... ]
}

/**
 * Extract Pandoc-style citations from markdown content.
 * Matches @citekey and grouped citations like [@citekey1; @citekey2].
 */
export function extractCitations(content: string): CitationEntry[] {
    const items: CitationEntry[] = [];
    const lines = content.split('\n');

    // Pattern for citekeys: @ followed by alphanumeric, underscores, dashes, colons, or periods
    // Pandoc citekeys can be quite flexible.
    const citekeyRegex = /@([a-zA-Z0-9_\-\.:]+)/g;

    // Pattern for citation blocks: [ ... @key ... ]
    const blockRegex = /\[([^\]]*@[^\]]*)\]/g;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // First, find all blocks to handle prefix/suffix context
        let blockMatch;
        const processedRanges: [number, number][] = [];

        while ((blockMatch = blockRegex.exec(line)) !== null) {
            const blockContent = blockMatch[1];
            const blockStart = blockMatch.index;
            const blockEnd = blockStart + blockMatch[0].length;
            processedRanges.push([blockStart, blockEnd]);

            // Find all citekeys within this block
            let keyMatch;
            const subRegex = new RegExp(citekeyRegex.source, 'g');
            while ((keyMatch = subRegex.exec(blockContent)) !== null) {
                const citekey = keyMatch[1];
                // Exclude internal references
                if (citekey.startsWith('eq:') || citekey.startsWith('fig:')) continue;

                items.push({
                    citekey: citekey,
                    lineNumber: i,
                    fullText: keyMatch[0],
                    context: blockMatch[0]
                });
            }
        }

        // Then find any "narrative" citations not inside brackets
        let keyMatch;
        const narrativeRegex = new RegExp(citekeyRegex.source, 'g');
        while ((keyMatch = narrativeRegex.exec(line)) !== null) {
            const start = keyMatch.index;
            const end = start + keyMatch[0].length;

            // Check if this match was already processed inside a block
            const isInsideBlock = processedRanges.some(([bStart, bEnd]) => start >= bStart && end <= bEnd);
            if (!isInsideBlock) {
                const citekey = keyMatch[1];
                // Exclude internal references
                if (citekey.startsWith('eq:') || citekey.startsWith('fig:')) continue;

                items.push({
                    citekey: citekey,
                    lineNumber: i,
                    fullText: keyMatch[0],
                    context: keyMatch[0] // Narrative citation is its own context
                });
            }
        }
    }

    return items;
}
