import { MarkdownView } from 'obsidian';
import { BasePanelModule } from './BasePanelModule';
import { CSS_CLASSES, MESSAGES } from '../../../core/constants';
import { FigureEntry, extractFigures } from '../../../shared/extractors/figureExtractor';
import { handleError } from '../../../shared/utils/errorHandler';
import { renderContentWithMath, setupLabelClickHandler } from '../utils/viewInteractions';
import { setupRenderedHoverPreview } from '../../../shared/utils/hoverPopovers';
import { highlightLine } from '../../editor/highlightUtils';
import { LongformProjectManager } from '../../../core/state/longformProjectManager';

export class FigurePanelModule extends BasePanelModule {
    id = 'figures';
    displayName = 'Figures';
    icon = 'image';

    private figureItems: FigureEntry[] = [];

    protected cleanupModuleData(): void {
        this.figureItems = [];
    }

    protected extractData(content: string): void {
        this.figureItems = extractFigures(content);
    }

    renderActions(actionsEl: HTMLElement, activeView: MarkdownView | null): void {
        // Global project/preview toggles are now in ListPanelView top bar.
    }

    protected renderContent(activeView: MarkdownView | null): void {
        const pm = LongformProjectManager.getInstance();
        const pinnedProject = pm.getPinnedProjectPath();
        const pinnedFile = pm.getPinnedFilePath();
        const activeFile = activeView?.file?.path;

        const filePath = pinnedFile || activeFile || pinnedProject || '';
        const isInProject = pinnedProject || (filePath ? pm.isFileInProject(filePath) : false);

        let itemsToRender: FigureEntry[] = [];

        const showProject = this.plugin.settings.showProjectWideItems;

        if (pinnedProject || (activeFile && pm.isFileInProject(activeFile) && showProject)) {
            itemsToRender = pm.getProjectFigures(filePath);
        } else {
            const targetPath = pinnedFile || activeFile || '';
            if (activeView && activeFile === targetPath) {
                itemsToRender = this.figureItems;
            } else if (targetPath) {
                itemsToRender = pm.getFileFigures(targetPath);
            }
        }

        if (this.searchQuery) {
            itemsToRender = itemsToRender.filter(item => 
                (item.label || '').toLowerCase().includes(this.searchQuery) ||
                (item.title || '').toLowerCase().includes(this.searchQuery) ||
                (item.description || '').toLowerCase().includes(this.searchQuery) ||
                item.imagePath.toLowerCase().includes(this.searchQuery) ||
                (item.displayTitle || '').toLowerCase().includes(this.searchQuery)
            );
        }

        this.renderFigureItemsList(activeView, itemsToRender);
    }

    protected showNoFileMessage(): void {
        if (!this.containerEl) return;

        this.containerEl.createEl('div', {
            text: MESSAGES.NO_ACTIVE_FILE,
            cls: CSS_CLASSES.FENCED_DIV_PANEL_EMPTY
        });
        this.figureItems = [];
    }

    private renderFigureItemsList(activeView: MarkdownView | null, items: FigureEntry[]): void {
        if (!this.containerEl) return;

        if (items.length === 0) {
            this.containerEl.createEl('div', {
                text: this.searchQuery ? 'No matching figures found' : 'No labelled figures found',
                cls: CSS_CLASSES.FENCED_DIV_PANEL_EMPTY
            });
            return;
        }

        const container = this.containerEl.createEl('div', {
            cls: 'pem-figure-panel-container'
        });

        for (const item of items) {
            this.renderFigureItem(container, item, activeView);
        }
    }

    private renderFigureItem(container: HTMLElement, item: FigureEntry, activeView: MarkdownView | null): void {
        const itemEl = container.createEl('div', { cls: 'pem-figure-panel-row' });

        // Row 1: Header (Title and Label)
        const headerEl = itemEl.createEl('div', { cls: 'pem-figure-header' });
        
        const titleEl = headerEl.createEl('span', { cls: 'pem-figure-title' });
        titleEl.createEl('strong', { text: item.displayTitle || 'Figure' });
        if (item.title) {
            titleEl.createSpan({ text: ` (${item.title})`, cls: 'pem-figure-inline-title' });
        }

        if (item.label) {
            const labelEl = headerEl.createEl('span', { cls: 'pem-figure-label' });
            labelEl.textContent = `@${item.label}`;
            setupLabelClickHandler(labelEl, `@${item.label}`, this.abortController?.signal);
        }

        // Row 2: Path/Description
        const infoEl = itemEl.createEl('div', { cls: 'pem-figure-info' });
        infoEl.textContent = item.description || item.imagePath;

        // Setup cmd+hover preview
        const previewContent = `![${item.description || ''}](${item.imagePath})`;
        setupRenderedHoverPreview(itemEl, previewContent, this.plugin.app, this.plugin, this.currentContext, undefined, this.abortController?.signal);

        this.setupContentClickHandler(itemEl, item, activeView);
    }

    private setupContentClickHandler(
        element: HTMLElement,
        item: FigureEntry,
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

                activeView.editor.setCursor({ line: item.lineNumber, ch: 0 });
                activeView.editor.scrollIntoView({
                    from: { line: item.lineNumber, ch: 0 },
                    to: { line: item.lineNumber, ch: 0 }
                }, true);
                highlightLine(activeView, item.lineNumber);
            } catch (error) {
                handleError(error, 'Scroll to figure');
            }
        };

        element.addEventListener('click', clickHandler, { signal: this.abortController?.signal });
    }

    protected renderPinned(pinnedProject: string | null, pinnedFile: string | null): void {
        this.renderContent(null);
    }
}
