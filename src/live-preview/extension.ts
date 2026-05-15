import { Extension, RangeSetBuilder } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet } from '@codemirror/view';
import { editorLivePreviewField, App, Component } from 'obsidian';
import { PandocExtendedMarkdownSettings } from '../core/settings';
import { pluginStateManager } from '../core/state/pluginStateManager';

// Pipeline imports
import { ProcessingPipeline } from './pipeline/ProcessingPipeline';
import { FencedDivProcessor, HeadingProcessor } from './pipeline/structural';
import { FencedDivReferenceProcessor } from './pipeline/inline';

// Main view plugin for rendering Pandoc extended markdown
const pandocExtendedMarkdownPlugin = (
    getSettings: () => PandocExtendedMarkdownSettings, 
    getDocPath: () => string | null,
    getApp?: () => App | undefined,
    getComponent?: () => Component | undefined
) => ViewPlugin.fromClass(
    class PandocExtendedMarkdownView {
        decorations: DecorationSet;
        private pipeline: ProcessingPipeline;

        constructor(view: EditorView) {
            this.initializePipeline(getApp, getComponent);
            this.decorations = this.buildDecorations(view);
        }
        
        private initializePipeline(getApp?: () => App | undefined, getComponent?: () => Component | undefined): void {
            const app = getApp ? getApp() : undefined;
            const component = getComponent ? getComponent() : undefined;
            this.pipeline = new ProcessingPipeline(pluginStateManager, app, component);
            
            // Register structural processors
            this.pipeline.registerStructuralProcessor(new FencedDivProcessor());
            this.pipeline.registerStructuralProcessor(new HeadingProcessor());
            
            // Register inline processors
            this.pipeline.registerInlineProcessor(new FencedDivReferenceProcessor());
        }

        update(update: ViewUpdate) {
            // Check if live preview state changed
            const prevLivePreview = update.startState.field(editorLivePreviewField);
            const currLivePreview = update.state.field(editorLivePreviewField);
            const livePreviewChanged = prevLivePreview !== currLivePreview;
            
            if (update.docChanged || update.viewportChanged || update.selectionSet || livePreviewChanged) {
                this.decorations = this.buildDecorations(update.view);
            }
        }

        buildDecorations(view: EditorView): DecorationSet {
            // Check if we're in live preview mode
            const isLivePreview = view.state.field(editorLivePreviewField);
            if (!isLivePreview || !this.pipeline) {
                return new RangeSetBuilder<Decoration>().finish();
            }
            
            const settings = getSettings();
            return this.pipeline.process(view, settings);
        }
    },
    {
        decorations: v => v.decorations
    }
);

export function pandocExtendedMarkdownExtension(
    getSettings: () => PandocExtendedMarkdownSettings, 
    getDocPath: () => string | null,
    getApp?: () => App | undefined,
    getComponent?: () => Component | undefined
): Extension {
    return pandocExtendedMarkdownPlugin(getSettings, getDocPath, getApp, getComponent);
}
