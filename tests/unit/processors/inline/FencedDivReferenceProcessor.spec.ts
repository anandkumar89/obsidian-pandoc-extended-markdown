import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { FencedDivReferenceProcessor } from '../../../../src/live-preview/pipeline/inline/FencedDivReferenceProcessor';
import { ProcessingContext, ContentRegion } from '../../../../src/live-preview/pipeline/types';


describe('FencedDivReferenceProcessor', () => {
    let processor: FencedDivReferenceProcessor;
    let view: EditorView;
    let context: ProcessingContext;

    beforeEach(() => {
        processor = new FencedDivReferenceProcessor();
        const container = document.createElement('div');
        document.body.appendChild(container);

        view = new EditorView({
            state: EditorState.create({ doc: 'see @thm:label.' }),
            parent: container
        });

        context = {
            document: view.state.doc,
            view,
            settings: {
                strictPandocMode: false,
                enableFencedDivs: true
            } as any,
            contentRegions: [],
            structuralDecorations: [],
            inlineDecorations: [],
            fencedDivLabels: new Map([
                ['thm:label', {
                    label: 'thm:label',
                    displayName: 'Theorem',
                    lineNumber: 1,
                    classes: ['theorem'],
                    content: 'content'
                }]
            ])
        } as ProcessingContext;
    });

    afterEach(() => {
        if (view.dom?.parentNode) {
            view.dom.parentNode.removeChild(view.dom);
        }
    });

    it('finds Pandoc citation syntax for known fenced div labels', () => {
        const region: ContentRegion = {
            from: 0,
            to: view.state.doc.length,
            type: 'normal'
        };

        const matches = processor.findMatches('see @thm:label.', region, context);

        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({
            from: 4,
            to: 14,
            type: 'fenced-div-ref',
            data: { label: 'thm:label' }
        });
    });

    it('ignores unknown citation labels', () => {
        const region: ContentRegion = {
            from: 0,
            to: view.state.doc.length,
            type: 'normal'
        };

        const matches = processor.findMatches('see @missing.', region, context);

        expect(matches).toHaveLength(0);
    });

    it('creates a reference widget with the resolved fenced div name', () => {
        const decoration = processor.createDecoration({
            from: 4,
            to: 14,
            type: 'fenced-div-ref',
            data: { label: 'thm:label', region: { from: 0 } }
        }, context);

        const widget = decoration.spec?.widget;
        expect(widget?.constructor.name).toBe('FencedDivReferenceWidget');
        expect(widget?.displayName).toBe('Theorem');
    });

    it('supports normal and fenced-div content regions', () => {
        expect(processor.supportedRegions.has('normal')).toBe(true);
        expect(processor.supportedRegions.has('fenced-div-content')).toBe(true);
    });
});
