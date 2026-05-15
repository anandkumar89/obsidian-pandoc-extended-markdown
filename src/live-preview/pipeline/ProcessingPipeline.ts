// External libraries
import { EditorView, DecorationSet, Decoration } from '@codemirror/view';
import { RangeSetBuilder, Text } from '@codemirror/state';
import { App, Component } from 'obsidian';

// Types
import { 
    ProcessingContext, 
    StructuralProcessor, 
    InlineProcessor,
    ContentRegion,
    InlineMatch 
} from './types';
import { CodeRegion } from '../../shared/types/codeTypes';
import { PandocExtendedMarkdownSettings } from '../../core/settings';

// Utils
import { handleError } from '../../shared/utils/errorHandler';
import {
    detectCodeRegions,
    getMarkdownCodeFenceMarker,
    isLineInCodeRegion,
    isMarkdownCodeFenceClosing,
    isRangeInCodeRegion
} from './utils/codeDetection';
import { allowsFencedDivOpeningAfterLine } from './structural/fencedDiv/parser';

// Internal modules
import { PluginStateManager } from '../../core/state/pluginStateManager';
import { scanFencedDivs } from '../scanners/fencedDivScanner';
import { scanSections } from '../scanners/sectionScanner';

function isCodeRegionEndLine(
    line: { from: number; to: number },
    codeRegions: CodeRegion[]
): boolean {
    return codeRegions.some(region =>
        region.type === 'codeblock' &&
        line.from >= region.from &&
        line.to === region.to
    );
}

export class ProcessingPipeline {
    private structuralProcessors: StructuralProcessor[] = [];
    private inlineProcessors: InlineProcessor[] = [];
    private stateManager: PluginStateManager;
    private app: App | undefined;
    private component: Component | undefined;
    
    constructor(stateManager: PluginStateManager, app?: App, component?: Component) {
        this.stateManager = stateManager;
        this.app = app;
        this.component = component;
    }
    
    registerStructuralProcessor(processor: StructuralProcessor): void {
        this.structuralProcessors.push(processor);
        this.structuralProcessors.sort((a, b) => a.priority - b.priority);
    }
    
    registerInlineProcessor(processor: InlineProcessor): void {
        this.inlineProcessors.push(processor);
        this.inlineProcessors.sort((a, b) => a.priority - b.priority);
    }
    
    process(view: EditorView, settings: PandocExtendedMarkdownSettings): DecorationSet {
        const context = this.createContext(view, settings);
        this.processStructural(context);
        this.processInline(context);
        return this.buildDecorationSet(context);
    }
    
    private getDocumentPath(): string | null {
        const workspace = this.app?.workspace;
        const activeFile = workspace?.getActiveFile();
        return activeFile?.path || null;
    }
    
    private buildContext(
        view: EditorView,
        settings: PandocExtendedMarkdownSettings,
        fencedDivLabels: ReturnType<typeof scanFencedDivs>
    ): ProcessingContext {
        return {
            document: view.state.doc,
            view,
            settings,
            app: this.app,
            component: this.component,
            
            fencedDivLabels,
            
            contentRegions: [],
            structuralDecorations: [],
            inlineDecorations: [],
            
            fencedDivStack: [],
            fencedDivCanOpenAtCurrentLine: true
        };
    }
    
    private createContext(view: EditorView, settings: PandocExtendedMarkdownSettings): ProcessingContext {
        const doc = view.state.doc;
        const codeRegions = detectCodeRegions(doc, view.state);
        const fencedDivLabels = scanFencedDivs(doc, settings, codeRegions);
        
        const context = this.buildContext(view, settings, fencedDivLabels);
        context.filePath = this.getDocumentPath() || undefined;
        context.codeRegions = codeRegions;
        context.sectionNumbers = scanSections(doc, context.filePath);
        return context;
    }
    
    private processStructural(context: ProcessingContext): void {
        const doc = context.document;
        const numLines = doc.lines;
        const codeRegions = context.codeRegions || [];
        let fencedDivCanOpenAtCurrentLine = true;
        let fallbackCodeFenceMarker: string | undefined;
        
        for (let lineNum = 1; lineNum <= numLines; lineNum++) {
            const line = doc.line(lineNum);
            context.fencedDivCanOpenAtCurrentLine = fencedDivCanOpenAtCurrentLine;
            
            if (isLineInCodeRegion(lineNum, doc, codeRegions as CodeRegion[])) {
                fencedDivCanOpenAtCurrentLine = isCodeRegionEndLine(line, codeRegions as CodeRegion[]);
                continue;
            }

            if (fallbackCodeFenceMarker) {
                if (isMarkdownCodeFenceClosing(line.text, fallbackCodeFenceMarker)) {
                    fallbackCodeFenceMarker = undefined;
                    fencedDivCanOpenAtCurrentLine = true;
                } else {
                    fencedDivCanOpenAtCurrentLine = false;
                }
                continue;
            }

            const openingCodeFenceMarker = getMarkdownCodeFenceMarker(line.text);
            if (openingCodeFenceMarker) {
                fallbackCodeFenceMarker = openingCodeFenceMarker;
                fencedDivCanOpenAtCurrentLine = false;
                continue;
            }
            
            let processed = false;
            for (const processor of this.structuralProcessors) {
                if (processor.canProcess(line, context)) {
                    const result = processor.process(line, context);
                    context.structuralDecorations.push(...result.decorations);
                    if (result.contentRegion) {
                        context.contentRegions.push(result.contentRegion);
                    }
                    if (result.skipFurtherProcessing) {
                        processed = true;
                        break;
                    }
                }
            }
            
            if (!processed) {
                context.contentRegions.push({
                    from: line.from,
                    to: line.to,
                    type: 'normal'
                });
            }

            fencedDivCanOpenAtCurrentLine = allowsFencedDivOpeningAfterLine(line.text) ||
                context.fencedDivBoundaryLine === lineNum;
        }
    }
    
    private processInline(context: ProcessingContext): void {
        const docLength = context.document.length;
        const codeRegions = context.codeRegions || [];
        for (const region of context.contentRegions) {
            if (!this.isValidRegion(region, docLength)) continue;
            this.processRegion(region, context, docLength, codeRegions as CodeRegion[]);
        }
    }
    
    private isValidRegion(region: ContentRegion, docLength: number): boolean {
        return region.from < region.to && region.from >= 0 && region.to <= docLength;
    }
    
    private processRegion(
        region: ContentRegion, 
        context: ProcessingContext, 
        docLength: number,
        codeRegions: CodeRegion[]
    ): void {
        const text = context.document.sliceString(region.from, region.to);
        const allMatches = this.collectMatches(region, text, context, codeRegions);
        allMatches.sort((a, b) => a.match.from - b.match.from);
        this.processMatches(allMatches, region, context, docLength);
    }
    
    private collectMatches(
        region: ContentRegion,
        text: string,
        context: ProcessingContext,
        codeRegions: CodeRegion[]
    ): Array<{match: InlineMatch; processor: InlineProcessor}> {
        const allMatches: Array<{match: InlineMatch; processor: InlineProcessor}> = [];
        for (const processor of this.inlineProcessors) {
            if (!processor.supportedRegions.has(region.type)) continue;
            const matches = processor.findMatches(text, region, context);
            for (const match of matches) {
                if (this.isValidMatch(match, text, region, codeRegions)) {
                    allMatches.push({ match, processor });
                }
            }
        }
        return allMatches;
    }
    
    private isValidMatch(
        match: InlineMatch, 
        text: string, 
        region: ContentRegion,
        codeRegions: CodeRegion[]
    ): boolean {
        if (match.from < 0 || match.to > text.length || match.from > match.to) return false;
        const absoluteFrom = region.from + match.from;
        const absoluteTo = region.from + match.to;
        return !isRangeInCodeRegion(absoluteFrom, absoluteTo, codeRegions);
    }
    
    private processMatches(
        allMatches: Array<{match: InlineMatch; processor: InlineProcessor}>,
        region: ContentRegion,
        context: ProcessingContext,
        docLength: number
    ): void {
        let lastEnd = 0;
        for (const { match, processor } of allMatches) {
            if (match.from < lastEnd) continue;
            const decoration = processor.createDecoration(match, context);
            const absoluteFrom = region.from + match.from;
            const absoluteTo = region.from + match.to;
            if (absoluteFrom >= 0 && absoluteTo <= docLength && absoluteFrom <= absoluteTo) {
                context.inlineDecorations.push({
                    from: absoluteFrom,
                    to: absoluteTo,
                    decoration
                });
            }
            lastEnd = match.to;
        }
    }
    
    private buildDecorationSet(context: ProcessingContext): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const docLength = context.document.length;
        const allDecorations = [
            ...context.structuralDecorations,
            ...context.inlineDecorations
        ].sort((a, b) => a.from - b.from || a.to - b.to);
        
        for (const { from, to, decoration } of allDecorations) {
            if (from < 0 || to > docLength || from > to) continue;
            const safeFrom = Math.floor(from);
            const safeTo = Math.floor(to);
            try {
                builder.add(safeFrom, safeTo, decoration);
            } catch (e) {
                handleError(e, 'ProcessingPipeline.buildDecorationSet');
            }
        }
        return builder.finish();
    }
    
    clear(): void {
        this.structuralProcessors = [];
        this.inlineProcessors = [];
    }
    
    getProcessorCounts(): { structural: number; inline: number } {
        return {
            structural: this.structuralProcessors.length,
            inline: this.inlineProcessors.length
        };
    }
}
