import { pluginStateManager } from '../../core/state/pluginStateManager';

import { ReadingModePipeline } from './ReadingModePipeline';
import { FencedDivReferenceInlineProcessor } from './inline/fencedDivReferenceInlineProcessor';
import { FencedDivBlockProcessor } from './processors/fencedDivBlockProcessor';
import { HeadingNumberProcessor } from './processors/headingNumberProcessor';
import { InlineTextEngineProcessor } from './processors/inlineTextProcessor';
import { ReadingModeContext } from './types';

export function createDefaultReadingModePipeline(): ReadingModePipeline {
    const pipeline = new ReadingModePipeline();
    const inlineProcessors = [
        new FencedDivReferenceInlineProcessor()
    ];

    pipeline.registerProcessor(new FencedDivBlockProcessor());
    pipeline.registerProcessor(new HeadingNumberProcessor());
    pipeline.registerProcessor(new InlineTextEngineProcessor(inlineProcessors));

    return pipeline;
}

export function createReadingModeContext(
    element: HTMLElement,
    postProcessorContext: ReadingModeContext['postProcessorContext'],
    config: ReadingModeContext['config'],
    app?: ReadingModeContext['app']
): ReadingModeContext {
    const sourcePath = postProcessorContext.sourcePath || 'unknown';
    const section = element.closest<HTMLElement>('.markdown-preview-section');
    const sectionInfo = postProcessorContext.getSectionInfo?.(element) ??
        (section ? postProcessorContext.getSectionInfo?.(section) : null) ??
        null;
    const counters = pluginStateManager.getDocumentCounters(sourcePath);

    return {
        element,
        postProcessorContext,
        section,
        sectionInfo,
        sourcePath,
        config,
        app,
        counters,
        validationLines: config.strictPandocMode && sectionInfo?.text
            ? sectionInfo.text.split('\n')
            : [],
        renderContext: {
            strictLineBreaks: config.strictLineBreaks
        }
    };
}
