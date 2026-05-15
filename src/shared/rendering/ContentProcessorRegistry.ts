import { FencedDivReference } from '../types/fencedDivTypes';

const PANDOC_CITATION_REFERENCE = /@([^\s,;)\]}]+)/g;
const TRAILING_REFERENCE_PUNCTUATION = /[.!?]+$/;

/**
 * Context for content processing containing all necessary data
 */
export interface ProcessingContext {
    fencedDivLabels?: Map<string, FencedDivReference>;
    footnotes?: Map<string, string>; // For footnote processor example
    fencedDivStack?: any[];
    fencedDivBoundaryLine?: number;
    fencedDivCanOpenAtCurrentLine?: boolean;
    equationLabels?: Map<string, any>;
}

/**
 * Interface for content processors that transform text
 */
export interface ContentProcessor {
    id: string;
    process(content: string, context: ProcessingContext): string;
}

/**
 * Registry for content processors that can be extended with new processors
 */
export class ContentProcessorRegistry {
    private static instance: ContentProcessorRegistry;
    private processors: Map<string, ContentProcessor> = new Map();
    
    private constructor() {
        this.registerDefaultProcessors();
    }
    
    static getInstance(): ContentProcessorRegistry {
        if (!ContentProcessorRegistry.instance) {
            ContentProcessorRegistry.instance = new ContentProcessorRegistry();
        }
        return ContentProcessorRegistry.instance;
    }
    
    registerProcessor(processor: ContentProcessor): void {
        this.processors.set(processor.id, processor);
    }
    
    unregisterProcessor(id: string): void {
        this.processors.delete(id);
    }
    
    processContent(content: string, context: ProcessingContext): string {
        let processedContent = content;
        for (const processor of this.processors.values()) {
            processedContent = processor.process(processedContent, context);
        }
        return processedContent;
    }
    
    private registerDefaultProcessors(): void {
        this.registerProcessor({
            id: 'fenced-div-references',
            process: (content: string, context: ProcessingContext): string => {
                if (!context.fencedDivLabels) return content;

                return content.replace(
                    PANDOC_CITATION_REFERENCE,
                    (match: string, rawLabel: string) => {
                        const label = resolveFencedDivLabel(rawLabel, context.fencedDivLabels!);
                        const reference = label ? context.fencedDivLabels!.get(label) : undefined;
                        return reference ? reference.displayName : match;
                    }
                );
            }
        });
    }
    
    clearProcessors(): void {
        this.processors.clear();
    }
    
    reset(): void {
        this.clearProcessors();
        this.registerDefaultProcessors();
    }
}

export function processContent(content: string, context: ProcessingContext): string {
    return ContentProcessorRegistry.getInstance().processContent(content, context);
}

function resolveFencedDivLabel(
    rawLabel: string,
    labels: Map<string, FencedDivReference>
): string | undefined {
    if (labels.has(rawLabel)) return rawLabel;

    const trimmedLabel = rawLabel.replace(TRAILING_REFERENCE_PUNCTUATION, '');
    if (trimmedLabel !== rawLabel && labels.has(trimmedLabel)) {
        return trimmedLabel;
    }

    return undefined;
}
