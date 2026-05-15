import { Decoration } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import { Text, Line } from '@codemirror/state';
import { App, Component } from 'obsidian';
import { PandocExtendedMarkdownSettings } from '../../core/settings';
import { FencedDivReference, FencedDivStackItem } from '../../shared/types/fencedDivTypes';

/**
 * Represents a region of content that needs inline processing
 */
type ListStructure = 'fenced-div';

export interface ContentRegion {
    from: number;
    to: number;
    type: 'fenced-div-content' | 'normal';
    parentStructure?: ListStructure;
    metadata?: {
        label?: string;
        [key: string]: unknown;
    };
}

/**
 * Unified context that flows through the entire processing pipeline
 */
export interface ProcessingContext {
    // Document-level data
    document: Text;
    view: EditorView;
    settings: PandocExtendedMarkdownSettings;
    app?: App;
    component?: Component;
    filePath?: string;
    
    fencedDivLabels?: Map<string, FencedDivReference>;
    
    // Processing metadata
    contentRegions: ContentRegion[];
    structuralDecorations: Array<{from: number, to: number, decoration: Decoration}>;
    inlineDecorations: Array<{from: number, to: number, decoration: Decoration}>;
    
    // State tracking
    fencedDivStack?: FencedDivStackItem[];
    fencedDivCanOpenAtCurrentLine?: boolean;
    fencedDivBoundaryLine?: number;
    sectionNumbers?: Map<number, string>;
    
    // Code regions to skip
    codeRegions?: Array<{from: number, to: number, type: string}>;
}

/**
 * Result from structural processing
 */
export interface StructuralResult {
    decorations: Array<{from: number, to: number, decoration: Decoration}>;
    contentRegion?: ContentRegion;
    skipFurtherProcessing?: boolean;
}

/**
 * Interface for processors that handle block-level structures
 */
export interface StructuralProcessor {
    name: string;
    priority: number; // Lower numbers process first
    
    canProcess(line: Line, context: ProcessingContext): boolean;
    process(line: Line, context: ProcessingContext): StructuralResult;
}

/**
 * Represents a match found by an inline processor
 */
export interface InlineMatch {
    from: number; // Relative to region start
    to: number;
    type: string;
    data: {
        text?: string;
        label?: string;
        number?: number;
        content?: string;
        [key: string]: unknown;
    };
}

/**
 * Interface for processors that handle inline content
 */
export interface InlineProcessor {
    name: string;
    priority: number; // Lower numbers process first
    supportedRegions: Set<string>; // Which content types to process
    
    findMatches(text: string, region: ContentRegion, context: ProcessingContext): InlineMatch[];
    createDecoration(match: InlineMatch, context: ProcessingContext): Decoration;
}
