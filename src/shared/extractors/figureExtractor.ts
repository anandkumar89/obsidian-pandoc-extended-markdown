export interface FigureEntry {
    label: string;         // e.g., "fig:myplot" or "tab:mytable"
    description: string;   // Optional description / alt text
    title: string;         // Optional title
    imagePath: string;     // The image path or wiki-link target
    lineNumber: number;    // 0-indexed
    filePath?: string;
    mtime?: number;
    isTable?: boolean;
    // Populated by numbering engine:
    number?: number;       // e.g., 1, 2, 3
    displayTitle?: string; // e.g., "Figure 1" or "Table 1"
    subfigures?: FigureEntry[]; // For subfigures grouped under one main figure
    isSubfigure?: boolean;
}

/**
 * Extract labelled figures and tables from markdown content.
 * 
 * Supported formats:
 *   Wiki-link:   ![[image.jpg|fig:label|desc:description]]
 *   Markdown:    ![fig:label|title:test|desc:description](image.png)
 */
export function extractFigures(content: string): FigureEntry[] {
    const items: FigureEntry[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Wiki-link format: ![[path|fig:label|desc:...]]
        const wikiMatch = line.match(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
        if (wikiMatch) {
            const imagePath = wikiMatch[1];
            const params = wikiMatch[2] || '';
            const entry = parseParams(params, imagePath, i);
            if (entry) {
                items.push(entry);
                continue;
            }
        }

        // Markdown link format: ![fig:label|title:...|desc:...](path)
        const mdMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)/);
        if (mdMatch) {
            const altText = mdMatch[1];
            const imagePath = mdMatch[2];
            const entry = parseParams(altText, imagePath, i);
            if (entry) {
                items.push(entry);
                continue;
            }
        }
    }

    return items;
}

function parseParams(paramString: string, imagePath: string, lineNumber: number): FigureEntry | null {
    if (!paramString) return null;

    // Split on | and look for fig:, tab:, tbl:, desc:, title:
    const parts = paramString.split('|').map(p => p.trim());
    let label = '';
    let description = '';
    let title = '';
    let isTable = false;

    for (const part of parts) {
        if (part.startsWith('fig:')) {
            label = part;
        } else if (part.startsWith('tab:') || part.startsWith('tbl:')) {
            label = part;
            isTable = true;
        } else if (part.startsWith('desc:')) {
            description = part.substring(5).trim();
        } else if (part.startsWith('title:')) {
            title = part.substring(6).trim();
        }
    }

    if (!label) return null;

    return {
        label,
        description,
        title,
        imagePath,
        lineNumber,
        isTable
    };
}

/**
 * Number figures and tables sequentially.
 */
export function numberFigures(entries: FigureEntry[]): FigureEntry[] {
    let figCounter = 0;
    let tabCounter = 0;

    for (const entry of entries) {
        if (entry.isTable) {
            tabCounter++;
            entry.number = tabCounter;
            entry.displayTitle = `Table ${tabCounter}`;
        } else {
            figCounter++;
            entry.number = figCounter;
            entry.displayTitle = `Figure ${figCounter}`;
            
            if (entry.subfigures && entry.subfigures.length > 0) {
                let subCounter = 0;
                for (const subfig of entry.subfigures) {
                    subCounter++;
                    subfig.number = subCounter;
                    subfig.displayTitle = `Figure ${figCounter}.${subCounter}`;
                }
            }
        }
    }
    return entries;
}
