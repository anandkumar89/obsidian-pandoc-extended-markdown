import { Notice, MarkdownRenderer, Component, App } from 'obsidian';

import { processContent, ProcessingContext } from '../../../shared/rendering/ContentProcessorRegistry';
import { MESSAGES } from '../../../core/constants';
import { withAsyncErrorBoundary } from '../../../shared/utils/errorHandler';

export function setupLabelClickHandler(
    element: HTMLElement, 
    rawLabel: string,
    abortSignal?: AbortSignal
): void {
    const clickHandler = () => {
        void withAsyncErrorBoundary(async () => {
            await navigator.clipboard.writeText(rawLabel);
            new Notice(MESSAGES.LABEL_COPIED);
        }, undefined, 'copy label to clipboard');
    };
    
    element.addEventListener('click', clickHandler, { signal: abortSignal });
}

export function renderContentWithMath(
    element: HTMLElement, 
    truncatedContent: string,
    app: App,
    component: Component,
    context?: ProcessingContext
): void {
    // Process content to replace references if context is provided
    let contentToRender = truncatedContent;
    if (context) {
        contentToRender = processContent(truncatedContent, context);
    }
    
    // Use MarkdownRenderer for proper math and markdown rendering
    void MarkdownRenderer.render(
        app,
        contentToRender,
        element,
        '',
        component
    );
}
