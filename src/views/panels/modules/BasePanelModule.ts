import { MarkdownView } from 'obsidian';
import { PanelModule } from './PanelTypes';
import { PandocExtendedMarkdownPlugin } from '../../../core/main';
import { MESSAGES } from '../../../core/constants';
import { ProcessingContext } from '../../../shared/rendering/ContentProcessorRegistry';
import { FencedDivReference } from '../../../shared/types/fencedDivTypes';
import { extractFencedDivs } from '../../../shared/extractors/fencedDivExtractor';
import { isSyntaxFeatureEnabled } from '../../../shared/types/settingsTypes';
import { LongformProjectManager } from '../../../core/state/longformProjectManager';

export abstract class BasePanelModule implements PanelModule {
    abstract id: string;
    abstract displayName: string;
    abstract icon: string;

    isActive = false;

    protected plugin: PandocExtendedMarkdownPlugin;
    protected containerEl: HTMLElement | null = null;
    protected lastActiveMarkdownView: MarkdownView | null = null;
    protected abortController: AbortController | null = null;
    protected currentContext: ProcessingContext = {};

    protected searchQuery = '';

    constructor(plugin: PandocExtendedMarkdownPlugin) {
        this.plugin = plugin;
    }

    setSearchQuery(query: string): void {
        this.searchQuery = query.toLowerCase().trim();
        if (this.isActive && this.lastActiveMarkdownView) {
            this.updateContent(this.lastActiveMarkdownView);
        }
    }

    onActivate(containerEl: HTMLElement, activeView: MarkdownView | null): void {
        this.isActive = true;
        this.containerEl = containerEl;
        this.lastActiveMarkdownView = activeView;
        this.abortController = new AbortController();
        this.updateContent(activeView);
    }

    onDeactivate(): void {
        this.isActive = false;
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        if (this.containerEl) {
            this.containerEl.empty();
            this.containerEl = null;
        }
        this.cleanupModuleData();
    }

    onUpdate(activeView: MarkdownView | null): void {
        if (!this.isActive || !this.containerEl) return;

        if (activeView && activeView.file) {
            this.lastActiveMarkdownView = activeView;
        } else if (!activeView) {
            activeView = this.lastActiveMarkdownView;
        }

        this.updateContent(activeView);
    }

    shouldUpdate(): boolean {
        return this.isActive;
    }

    destroy(): void {
        this.onDeactivate();
        this.lastActiveMarkdownView = null;
    }

    protected updateContent(activeView: MarkdownView | null): void {
        if (!this.containerEl) return;

        this.containerEl.empty();

        const pm = LongformProjectManager.getInstance();
        const pinnedProject = pm.getPinnedProjectPath();
        const pinnedFile = pm.getPinnedFilePath();

        if (pinnedProject || pinnedFile) {
            this.renderPinned(pinnedProject, pinnedFile);
            return;
        }

        if (!activeView || !activeView.file) {
            void this.showNoFileMessage();
            return;
        }

        const content = activeView.editor ? activeView.editor.getValue() : '';
        this.extractData(content);
        this.buildRenderingContext(content);
        this.renderContent(activeView);
    }

    protected async showNoFileMessage(): Promise<void> {
        if (!this.containerEl) return;

        this.containerEl.empty();
        
        const welcomeEl = this.containerEl.createDiv('pem-panel-welcome');
        welcomeEl.createEl('h3', { text: 'Academic Markdown' });
        welcomeEl.createEl('p', { text: MESSAGES.NO_ACTIVE_FILE, cls: 'pem-no-data-msg' });

        const pm = LongformProjectManager.getInstance();
        const projects = await pm.findAllProjects();
        const recentFiles = pm.getRecentFiles();

        if (projects.length > 0) {
            welcomeEl.createEl('div', { text: 'Registered Projects', cls: 'pem-section-title pem-mt-medium' });
            const list = welcomeEl.createDiv('pem-panel-project-list');
            for (const p of projects) {
                const item = list.createDiv('pem-project-item');
                const info = item.createDiv('pem-project-info');
                info.createDiv({ text: `📁 ${p.name}`, cls: 'pem-project-name' });
                info.createDiv({ text: p.path, cls: 'pem-project-path' });
                
                item.addEventListener('click', () => {
                    pm.setPinnedProject(p.path);
                    // refresh will be triggered by event
                });
            }
        }

        if (recentFiles.length > 0) {
            welcomeEl.createEl('div', { text: 'Recent Files', cls: 'pem-section-title pem-mt-medium' });
            const list = welcomeEl.createDiv('pem-panel-project-list');
            for (const path of recentFiles.slice(0, 5)) {
                const item = list.createDiv('pem-project-item');
                const info = item.createDiv('pem-project-info');
                info.createDiv({ text: `📄 ${path.split('/').pop() || path}`, cls: 'pem-project-name' });
                info.createDiv({ text: path, cls: 'pem-project-path' });
                
                item.addEventListener('click', async () => {
                    const file = this.plugin.app.vault.getAbstractFileByPath(path);
                    if (file instanceof TFile) {
                        const leaf = this.plugin.app.workspace.getLeaf(false);
                        await leaf.openFile(file);
                    }
                });
            }
        }
    }

    protected buildRenderingContext(content: string): void {
        const fencedDivLabels = new Map<string, FencedDivReference>();
        if (isSyntaxFeatureEnabled(this.plugin.settings, 'enableFencedDivs')) {
            const fencedDivs = extractFencedDivs(content, this.plugin.settings);
            fencedDivs.forEach(item => {
                if (!item.label || fencedDivLabels.has(item.label)) {
                    return;
                }

                fencedDivLabels.set(item.label, {
                    label: item.label,
                    displayName: item.title || 'Div',
                    lineNumber: item.lineNumber + 1,
                    classes: item.classes,
                    content: item.content
                });
            });
        }

        this.currentContext = {
            fencedDivLabels
        };
    }

    protected abstract extractData(content: string): void;
    protected abstract renderContent(activeView: MarkdownView | null): void;
    protected abstract renderPinned(pinnedProject: string | null, pinnedFile: string | null): void;

    protected cleanupModuleData(): void { }
}
