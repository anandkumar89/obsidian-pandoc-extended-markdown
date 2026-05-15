import { EditorPosition } from 'obsidian';

export interface EquationPanelItem {
    label: string; // The full tag content, e.g., eq:label
    content: string; // The full equation content including $$
    lineNumber: number;
    contentLineNumber: number;
    position: EditorPosition;
    contentPosition: EditorPosition;
    filePath?: string;
    mtime?: number;
}

export function extractEquations(content: string): EquationPanelItem[] {
    const items: EquationPanelItem[] = [];
    const lines = content.split('\n');
    let inEquation = false;
    let currentEquationLines: string[] = [];
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.trim() === '$$') {
            if (!inEquation) {
                inEquation = true;
                currentEquationLines = [line];
                startLine = i;
            } else {
                currentEquationLines.push(line);
                const fullContent = currentEquationLines.join('\n');
                
                // Extract tag: \tag{something} or % #eq:label
                const tagMatch = fullContent.match(/\\tag\{([^}]+)\}/) || fullContent.match(/%\s*#eq:([a-zA-Z0-9_-]+)/);
                if (tagMatch) {
                    items.push({
                        label: tagMatch[1],
                        content: fullContent,
                        lineNumber: startLine,
                        contentLineNumber: startLine,
                        position: { line: startLine, ch: 0 },
                        contentPosition: { line: startLine, ch: 0 }
                    });
                }
                
                inEquation = false;
            }
        } else if (inEquation) {
            currentEquationLines.push(line);
        }
    }
    
    return items;
}
