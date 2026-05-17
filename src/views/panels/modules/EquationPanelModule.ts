import { MarkdownView } from 'obsidian';
import { BasePanelModule } from './BasePanelModule';
import { CSS_CLASSES, MESSAGES } from '../../../core/constants';
import { EquationPanelItem, extractEquations } from '../../../shared/extractors/equationExtractor';
import { handleError } from '../../../shared/utils/errorHandler';
import { renderContentWithMath, setupLabelClickHandler } from '../utils/viewInteractions';
import { setupRenderedHoverPreview } from '../../../shared/utils/hoverPopovers';
import { highlightLine } from '../../editor/highlightUtils';
import { LongformProjectManager } from '../../../core/state/longformProjectManager';

export class EquationPanelModule extends BasePanelModule {
    id = 'equations';
    displayName = 'Equations';
    icon = 'sigma';

    private equationItems: EquationPanelItem[] = [];

    protected cleanupModuleData(): void {
        this.equationItems = [];
    }

    protected extractData(content: string): void {
        this.equationItems = extractEquations(content);
    }

    renderActions(actionsEl: HTMLElement, activeView: MarkdownView | null): void {
        // Global project/preview toggles are now in ListPanelView top bar.
    }

    protected renderContent(activeView: MarkdownView | null): void {
        const pm = LongformProjectManager.getInstance();
        const pinnedPath = pm.getPinnedProjectPath();
        const filePath = activeView?.file?.path || pinnedPath || '';
        const isInProject = pinnedPath || (filePath ? pm.isFileInProject(filePath) : false);

        let itemsToRender: EquationPanelItem[] = [];

        const showProject = this.plugin.settings.showProjectWideItems;

        if (isInProject && (showProject || !activeView)) {
            itemsToRender = pm.getProjectEquations(filePath);
        } else {
            itemsToRender = this.equationItems;
        }

        if (this.searchQuery) {
            itemsToRender = itemsToRender.filter(item => 
                item.label.toLowerCase().includes(this.searchQuery) ||
                item.content.toLowerCase().includes(this.searchQuery)
            );
        }

        this.renderEquationItemsList(activeView, itemsToRender);
    }

    protected showNoFileMessage(): void {
        if (!this.containerEl) return;

        this.containerEl.createEl('div', {
            text: MESSAGES.NO_ACTIVE_FILE,
            cls: CSS_CLASSES.FENCED_DIV_PANEL_EMPTY
        });
        this.equationItems = [];
    }

    private renderEquationItemsList(activeView: MarkdownView | null, items: EquationPanelItem[]): void {
        if (!this.containerEl) return;

        if (items.length === 0) {
            this.containerEl.createEl('div', {
                text: this.searchQuery ? 'No matching equations found' : 'No tagged equations found',
                cls: CSS_CLASSES.FENCED_DIV_PANEL_EMPTY
            });
            return;
        }

        const container = this.containerEl.createEl('div', {
            cls: 'pem-eq-panel-container'
        });

        for (const item of items) {
            this.renderEquationItem(container, item, activeView);
        }
    }

    private renderEquationItem(container: HTMLElement, item: EquationPanelItem, activeView: MarkdownView | null): void {
        const itemEl = container.createEl('div', { cls: 'pem-eq-panel-row' });

        // Row 1: tag label
        const tagEl = itemEl.createEl('div', { cls: 'pem-eq-tag' });
        const referenceLabel = `@eq:${item.label}`;
        tagEl.textContent = item.label;
        setupLabelClickHandler(tagEl, referenceLabel, this.abortController?.signal);

        // Row 2: rendered math preview — item.content already includes $$
        if (this.plugin.settings.showPanelPreviews) {
            const previewEl = itemEl.createEl('div', { cls: 'pem-eq-preview' });
            renderContentWithMath(previewEl, item.content, this.plugin.app, this.plugin, this.currentContext);
        }

        // Setup cmd+hover preview
        setupRenderedHoverPreview(itemEl, item.content, this.plugin.app, this.plugin, this.currentContext, undefined, this.abortController?.signal);

        this.setupContentClickHandler(itemEl, item, activeView);
    }

    private setupContentClickHandler(
        element: HTMLElement,
        item: EquationPanelItem,
        activeView: MarkdownView | null
    ): void {
        const clickHandler = () => {
            try {
                if (item.filePath && item.filePath !== activeView?.file?.path) {
                    const targetFile = this.plugin.app.vault.getAbstractFileByPath(item.filePath);
                    if (targetFile) {
                        const leaf = this.plugin.app.workspace.getLeaf(false);
                        void leaf.openFile(targetFile as any, { eState: { line: item.lineNumber } });
                        return;
                    }
                }

                if (!activeView?.editor) return;

                const leaves = this.plugin.app.workspace.getLeavesOfType('markdown');
                const targetLeaf = leaves.find((leaf) => leaf.view === activeView);
                if (targetLeaf) {
                    this.plugin.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
                }

                activeView.editor.setCursor(item.contentPosition);
                activeView.editor.scrollIntoView({
                    from: item.contentPosition,
                    to: item.contentPosition
                }, true);
                highlightLine(activeView, item.contentLineNumber);
            } catch (error) {
                handleError(error, 'Scroll to equation');
            }
        };

        element.addEventListener('click', clickHandler, { signal: this.abortController?.signal });
    }
}
