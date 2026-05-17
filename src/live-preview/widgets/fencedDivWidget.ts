import { EditorView } from '@codemirror/view';
import { App, Component } from 'obsidian';
import { CSS_CLASSES } from '../../core/constants';
import { BaseWidget } from './BaseWidget';

export class FencedDivHeaderWidget extends BaseWidget {
    constructor(
        public displayName: string,
        public label?: string,
        public inlineTitle?: string,
        view?: EditorView,
        pos?: number,
        private app?: App,
        private component?: Component
    ) {
        super(view, pos);
    }

    protected applyStyles(element: HTMLElement): void {
        element.className = CSS_CLASSES.FENCED_DIV_HEADER;
        if (this.label) {
            element.dataset.pandocDivId = this.label;
        }
    }

    protected setContent(element: HTMLElement): void {
        const blockName = this.displayName ? this.displayName.toLowerCase() : 'fenced-div';
        
        const titleElement = this.createElement('span', `pem-fenced-div-title ${blockName}-title`);
        
        // Render displayName as bold
        const nameSpan = titleElement.createSpan();
        nameSpan.innerHTML = `<strong>${this.displayName}</strong>`;
        
        // Render inline title if present, with math support
        if (this.inlineTitle) {
            titleElement.createSpan({ text: ' (' });
            const titleSpan = titleElement.createSpan();
            if (this.app && this.component && this.inlineTitle.includes('$')) {
                const { MarkdownRenderer } = require('obsidian');
                MarkdownRenderer.render(this.app, this.inlineTitle, titleSpan, '', this.component);
                // Remove the wrapping <p> if present
                const p = titleSpan.querySelector('p');
                if (p) {
                    titleSpan.innerHTML = p.innerHTML;
                }
            } else {
                titleSpan.textContent = this.inlineTitle;
            }
            titleElement.createSpan({ text: ')' });
        }
        
        element.appendChild(titleElement);
    }

    protected setupTooltip(element: HTMLElement): void {
        if (this.label) {
            this.addSimpleTooltip(element, `#${this.label}`);
        }
    }

    eq(other: FencedDivHeaderWidget): boolean {
        return other.displayName === this.displayName &&
               other.label === this.label &&
               other.inlineTitle === this.inlineTitle &&
               other.pos === this.pos;
    }
}

export class FencedDivClosingWidget extends BaseWidget {
    protected applyStyles(element: HTMLElement): void {
        element.className = CSS_CLASSES.FENCED_DIV_CLOSING;
    }

    protected setContent(element: HTMLElement): void {
        element.textContent = '';
    }

    protected setupTooltip(element: HTMLElement): void {
        this.addSimpleTooltip(element, 'End fenced div');
    }

    eq(other: FencedDivClosingWidget): boolean {
        return other.pos === this.pos;
    }
}

export class FencedDivReferenceWidget extends BaseWidget {
    constructor(
        public displayName: string,
        public label: string,
        private content?: string,
        view?: EditorView,
        pos?: number,
        private app?: App,
        private component?: Component,
        public isValid: boolean = true,
        public filePath: string = ''
    ) {
        super(view, pos);
    }

    protected applyStyles(element: HTMLElement): void {
        element.className = CSS_CLASSES.FENCED_DIV_REFERENCE;
        if (!this.isValid) {
            element.classList.add(CSS_CLASSES.REFERENCE_INVALID);
        }
        element.dataset.pandocDivRef = this.label;
    }

    protected setContent(element: HTMLElement): void {
        element.textContent = this.displayName;
    }

    protected setupTooltip(element: HTMLElement): void {
        if (!this.content) {
            return;
        }

        if (this.app && this.component) {
            this.addRenderedHoverPreview(
                element,
                this.content,
                this.app,
                this.component,
                undefined,
                CSS_CLASSES.HOVER_POPOVER_CONTENT
            );
        } else {
            this.addSimpleTooltip(element, this.content);
        }
    }

    protected setupClickHandler(element: HTMLElement): void {
        element.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.app) {
                // Try to find the reference in the global project index
                const { LongformProjectManager } = require('../../core/state/longformProjectManager');
                const pm = LongformProjectManager.getInstance();
                
                let globalRef = pm.getReference(this.label, this.filePath);
                if (!globalRef && this.label.startsWith('eq:')) {
                    const tagLabel = this.label.substring(3);
                    globalRef = pm.getEquationReference(tagLabel, this.filePath);
                }
                
                if (globalRef && globalRef.filePath) {
                    const targetFile = this.app.vault.getAbstractFileByPath(globalRef.filePath);
                    if (targetFile) {
                        const leaf = this.app.workspace.getLeaf(e.ctrlKey || e.metaKey);
                        leaf.openFile(targetFile as any, { eState: { line: globalRef.lineNumber } });
                        return;
                    }
                }
            }

            // Fallback: Just focus cursor if in editor
            if (this.view && this.pos !== undefined) {
                this.view.dispatch({
                    selection: { anchor: this.pos }
                });
                this.view.focus();
            }
        });
    }

    eq(other: FencedDivReferenceWidget): boolean {
        return other.displayName === this.displayName &&
               other.label === this.label &&
               other.content === this.content &&
               other.pos === this.pos &&
               other.filePath === this.filePath;
    }
}
