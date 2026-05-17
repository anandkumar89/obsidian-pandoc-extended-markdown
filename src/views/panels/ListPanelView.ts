// External libraries
import { ItemView, WorkspaceLeaf, MarkdownView, HoverLinkSource, setIcon } from 'obsidian';

// Types
import { PanelModule, PanelTabInfo } from './modules/PanelTypes';

// Constants
import { UI_CONSTANTS, ICONS, CSS_CLASSES } from '../../core/constants';

// Utils
import { handleError } from '../../shared/utils/errorHandler';
import { isSyntaxFeatureEnabled, normalizeSettings } from '../../shared/types/settingsTypes';

import { FencedDivPanelModule } from './modules/FencedDivPanelModule';
import { EquationPanelModule } from './modules/EquationPanelModule';
import { FigurePanelModule } from './modules/FigurePanelModule';
import { TocPanelModule } from './modules/TocPanelModule';
import { ExportPanelModule } from './modules/ExportPanelModule';
import { CitationPanelModule } from './modules/CitationPanelModule';
import { PandocExtendedMarkdownPlugin } from '../../core/main';
import { LongformProjectManager } from '../../core/state/longformProjectManager';

export const VIEW_TYPE_LIST_PANEL = 'list-panel-view';

export class ListPanelView extends ItemView {
    private plugin: PandocExtendedMarkdownPlugin;
    private panels: PanelTabInfo[] = [];
    private activePanel: PanelModule | null = null;
    private updateTimer: number | null = null;
    private lastActiveMarkdownView: MarkdownView | null = null;
    private currentSearchQuery = '';
    private topBarEl: HTMLElement | null = null;
    private moduleActionsEl: HTMLElement | null = null;
    private toggleActionsEl: HTMLElement | null = null;
    private contentContainerEl: HTMLElement | null = null;
    hoverLinkSource: HoverLinkSource;
    
    constructor(leaf: WorkspaceLeaf, plugin: PandocExtendedMarkdownPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.plugin.settings = normalizeSettings(this.plugin.settings);
        
        this.hoverLinkSource = {
            display: 'List panel',
            defaultMod: true
        };
        
        this.initializePanels();
    }
    
    private initializePanels(): void {
        const availablePanels: PanelTabInfo[] = [];
        
        // TOC panel
        const tocModule = new TocPanelModule(this.plugin);
        availablePanels.push({
            id: tocModule.id,
            displayName: tocModule.displayName,
            icon: tocModule.icon,
            module: tocModule
        });

        // Fenced divs panel (Blocks)
        if (isSyntaxFeatureEnabled(this.plugin.settings, 'enableFencedDivs')) {
            const fencedDivModule = new FencedDivPanelModule(this.plugin);
            availablePanels.push({
                id: fencedDivModule.id,
                displayName: 'Blocks',
                icon: fencedDivModule.icon,
                module: fencedDivModule
            });
        }
        
        // Equations panel
        const equationModule = new EquationPanelModule(this.plugin);
        availablePanels.push({
            id: equationModule.id,
            displayName: equationModule.displayName,
            icon: equationModule.icon,
            module: equationModule
        });

        // Figures/Tables panel
        const figureModule = new FigurePanelModule(this.plugin);
        availablePanels.push({
            id: figureModule.id,
            displayName: 'Figures/Tables',
            icon: figureModule.icon,
            module: figureModule
        });

        // Export/Settings panel
        const exportModule = new ExportPanelModule(this.plugin);
        availablePanels.push({
            id: exportModule.id,
            displayName: exportModule.displayName,
            icon: exportModule.icon,
            module: exportModule
        });

        // Citations panel
        if (isSyntaxFeatureEnabled(this.plugin.settings, 'enableCitations')) {
            const citationModule = new CitationPanelModule(this.plugin);
            availablePanels.push({
                id: citationModule.id,
                displayName: citationModule.displayName,
                icon: citationModule.icon,
                module: citationModule
            });
        }
        
        // Use fixed order for the top bar
        const fixedOrder = ['toc', 'fenced-divs', 'equations', 'figures', 'citations', 'export'];
        this.panels = [];
        
        for (const panelId of fixedOrder) {
            const panel = availablePanels.find(p => p.id === panelId);
            if (panel) {
                this.panels.push(panel);
            }
        }
    }
    
    getViewType(): string {
        return VIEW_TYPE_LIST_PANEL;
    }
    
    getDisplayText(): string {
        return 'List panel';
    }
    
    getIcon(): string {
        return 'book-open';
    }
    
    async onOpen() {
        this.plugin.settings = normalizeSettings(this.plugin.settings);
        if (!this.plugin.settings.enableListPanel) {
            this.leaf.detach();
            return;
        }
        this.renderView();
        await this.updateView();
        
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.updateGlobalToggleStates();
                this.scheduleUpdate();
            })
        );
        
        this.registerEvent(
            this.app.workspace.on('editor-change', () => {
                this.scheduleUpdate();
            })
        );
        
        this.registerEvent(
            this.app.workspace.on('file-open', () => {
                this.updateGlobalToggleStates();
                this.scheduleUpdate();
            })
        );
        
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                this.scheduleUpdate();
            })
        );

        this.registerEvent(
            this.app.workspace.on('pem:settings-changed' as any, () => {
                this.updateGlobalToggleStates();
                this.scheduleUpdate();
            })
        );
        
        this.plugin.registerHoverLinkSource(VIEW_TYPE_LIST_PANEL, this.hoverLinkSource);
    }
    
    onClose(): Promise<void> {
        if (this.updateTimer) {
            window.clearTimeout(this.updateTimer);
        }
        
        for (const panel of this.panels) {
            panel.module.destroy();
        }
        
        this.contentEl.empty();
        return Promise.resolve();
    }
    
    private renderView(): void {
        this.contentEl.empty();
        
        const viewContainer = this.contentEl.createDiv({
            cls: CSS_CLASSES.LIST_PANEL_VIEW_CONTAINER
        });
        
        // Top bar: left wrapper holds tabs & contextual icons, right actions hold search & settings
        this.topBarEl = viewContainer.createDiv({ cls: 'pem-panel-top-bar' });

        // Left wrapper
        const leftWrapper = this.topBarEl.createDiv({ cls: 'pem-panel-left-wrapper' });

        // Tabs container (solid background)
        const tabsEl = leftWrapper.createDiv({ cls: 'pem-panel-tabs' });

        // Main modules
        const mainTabsOrder = ['toc', 'fenced-divs', 'equations', 'figures', 'citations'];
        for (const panelId of mainTabsOrder) {
            const panel = this.panels.find(p => p.id === panelId);
            if (!panel) continue;
            this.renderTabButton(tabsEl, panel);
        }

        // Contextual actions beside tabs, grouped and left-aligned
        const contextualEl = leftWrapper.createDiv({ cls: 'pem-panel-contextual-actions' });

        // Persistent toggles
        this.toggleActionsEl = contextualEl.createDiv({ cls: 'pem-panel-toggle-actions' });

        // Project-wide toggle (FOLDER/LAYERS)
        const projectToggleBtn = this.toggleActionsEl.createDiv({ 
            cls: 'pem-panel-tab pem-project-toggle',
            attr: { 'aria-label': 'Toggle project-wide items' }
        });
        setIcon(projectToggleBtn, 'layers');
        projectToggleBtn.addEventListener('click', async () => {
            this.plugin.settings.showProjectWideItems = !this.plugin.settings.showProjectWideItems;
            await this.plugin.saveSettings();
            void this.updateView();
            this.updateGlobalToggleStates();
        });

        // Preview toggle (LAYOUT-LIST)
        const previewToggleBtn = this.toggleActionsEl.createDiv({ 
            cls: 'pem-panel-tab pem-preview-toggle',
            attr: { 'aria-label': 'Toggle previews' }
        });
        setIcon(previewToggleBtn, 'layout-list');
        previewToggleBtn.addEventListener('click', async () => {
            this.plugin.settings.showPanelPreviews = !this.plugin.settings.showPanelPreviews;
            await this.plugin.saveSettings();
            void this.updateView();
            this.updateGlobalToggleStates();
        });

        // Per-panel dynamic actions (emptied on each tab switch)
        this.moduleActionsEl = contextualEl.createDiv({ cls: 'pem-panel-module-actions' });

        // Right actions: search and settings grouped and flushed right
        const rightActionsEl = this.topBarEl.createDiv({ cls: 'pem-panel-right-actions' });

        // Search toggle
        const searchToggleBtn = rightActionsEl.createDiv({ 
            cls: 'pem-panel-tab pem-search-toggle',
            attr: { 'aria-label': 'Search' }
        });
        setIcon(searchToggleBtn, 'search');
        
        // Export/Settings
        const exportPanel = this.panels.find(p => p.id === 'export');
        if (exportPanel) {
            this.renderTabButton(rightActionsEl, exportPanel);
        }

        this.updateGlobalToggleStates();

        // Search bar (toggleable)
        const searchBarEl = viewContainer.createDiv({ cls: 'pem-panel-search-bar is-hidden' });
        const searchContainer = searchBarEl.createDiv({ cls: 'pem-search-input-container' });
        
        const searchIconEl = searchContainer.createDiv({ cls: 'pem-search-icon-inner' });
        setIcon(searchIconEl, 'search');
        
        const searchInput = searchContainer.createEl('input', {
            cls: 'pem-panel-search-input',
            attr: {
                type: 'text',
                placeholder: 'Search...'
            }
        });
        
        searchToggleBtn.addEventListener('click', () => {
            searchBarEl.classList.toggle('is-hidden');
            if (!searchBarEl.classList.contains('is-hidden')) {
                searchInput.focus();
            }
        });

        // Hide when clicking away if empty
        this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
            if (!searchBarEl.contains(evt.target as Node) && 
                !searchToggleBtn.contains(evt.target as Node) && 
                searchInput.value === '') {
                searchBarEl.addClass('is-hidden');
            }
        });

        searchInput.addEventListener('input', () => {
            this.currentSearchQuery = searchInput.value;
            if (this.activePanel) {
                this.activePanel.setSearchQuery(this.currentSearchQuery);
                void this.updateView();
            }
        });

        this.contentContainerEl = viewContainer.createDiv({
            cls: CSS_CLASSES.LIST_PANEL_CONTENT_CONTAINER
        });
        
        if (this.panels.length > 0) {
            this.switchToPanel(this.panels[0]);
        }
    }
    
    /** Resolves the best available MarkdownView, preferring pinned sources. */
    private resolveActiveView(): MarkdownView | null {
        const pm = LongformProjectManager.getInstance();
        const active = this.app.workspace.getActiveViewOfType(MarkdownView);
        
        if (active?.file) {
            this.lastActiveMarkdownView = active;
        }

        // 1. Pinned standalone file — only follow that file
        const pinnedFilePath = pm.getPinnedFilePath();
        if (pinnedFilePath) {
            const leaves = this.app.workspace.getLeavesOfType('markdown');
            const leaf = leaves.find(l => (l.view as MarkdownView).file?.path === pinnedFilePath);
            if (leaf) return leaf.view as MarkdownView;
            return null;
        }

        // 2. Pinned project — only follow files in THAT project
        const pinnedProjectPath = pm.getPinnedProjectPath();
        if (pinnedProjectPath) {
            if (active?.file) {
                const projectPath = pm.getActualProjectPath(active.file.path);
                if (projectPath === pinnedProjectPath) {
                    return active;
                }
            }
            return null; // Show project context instead of unrelated file
        }

        // 3. Fallback — follow active editor
        return active || this.lastActiveMarkdownView;
    }

    private switchToPanel(panelInfo: PanelTabInfo): void {
        if (this.activePanel === panelInfo.module) {
            return;
        }
        
        if (this.activePanel) {
            this.activePanel.onDeactivate();
        }
        
        const allButtons = this.topBarEl?.querySelectorAll('.pem-panel-tab');
        allButtons?.forEach(btn => btn.removeClass('is-active'));
        
        const activeButton = this.topBarEl?.querySelector(`[data-panel-id="${panelInfo.id}"]`);
        activeButton?.addClass('is-active');
        
        this.activePanel = panelInfo.module;
        this.activePanel.setSearchQuery(this.currentSearchQuery);

        const resolvedView = this.resolveActiveView();

        // Render module-specific action buttons in the top bar
        if (this.moduleActionsEl) {
            this.moduleActionsEl.empty();
            if (this.activePanel.renderActions) {
                this.activePanel.renderActions(this.moduleActionsEl, resolvedView);
            }
        }
        
        if (this.contentContainerEl) {
            this.contentContainerEl.empty();
            this.activePanel.onActivate(this.contentContainerEl, resolvedView);
        }

        this.updateGlobalToggleStates();
    }
    
    private renderTabButton(container: HTMLElement, panel: PanelTabInfo): void {
        const tabBtn = container.createDiv({
            cls: 'pem-panel-tab',
            attr: {
                'aria-label': panel.displayName,
                'data-panel-id': panel.id
            }
        });
        
        
        
        if (panel.id === 'toc') {
            setIcon(tabBtn, 'list');
        } else if (panel.id === 'fenced-divs') {
            setIcon(tabBtn, 'box');
        } else if (panel.id === 'equations') {
            setIcon(tabBtn, 'sigma');
        } else if (panel.id === 'figures') {
            setIcon(tabBtn, 'image');
        } else if (panel.id === 'export') {
            setIcon(tabBtn, 'settings');
        } else if (panel.id === 'citations') {
            setIcon(tabBtn, 'quote');
        } else {
            setIcon(tabBtn, 'layout');
        }
        
        tabBtn.addEventListener('click', () => {
            this.switchToPanel(panel);
        });
    }

    private scheduleUpdate(): void {
        if (this.updateTimer) {
            window.clearTimeout(this.updateTimer);
        }
        
        this.updateTimer = window.setTimeout(() => {
            void this.updateView();
        }, UI_CONSTANTS.UPDATE_DEBOUNCE_MS);
    }

    updateView(): Promise<void> {
        return Promise.resolve().then(() => {
            try {
                const markdownView = this.resolveActiveView();
                
                if (this.activePanel && this.activePanel.shouldUpdate()) {
                    this.activePanel.onUpdate(markdownView);
                    
                    // Refresh module actions too
                    if (this.moduleActionsEl) {
                        this.moduleActionsEl.empty();
                        if (this.activePanel.renderActions) {
                            this.activePanel.renderActions(this.moduleActionsEl, markdownView);
                        }
                    }
                }
            } catch (error) {
                handleError(error, 'Update list panel view');
            }
        });
    }
    

    public syncActiveHeading(filePath: string, lineNumber: number): void {
        if (this.activePanel && this.activePanel.id === 'toc' && this.activePanel.setActiveHeading) {
            this.activePanel.setActiveHeading(filePath, lineNumber);
        }
    }

    private updateGlobalToggleStates(): void {
        if (!this.toggleActionsEl) return;
        
        const projectBtn = this.toggleActionsEl.querySelector('.pem-project-toggle');
        const previewBtn = this.toggleActionsEl.querySelector('.pem-preview-toggle');
        
        const activeId = this.activePanel?.id;

        // Hide entire toggle area on export/settings tab
        this.toggleActionsEl.toggleClass('is-hidden', activeId === 'export');

        if (projectBtn) {
            projectBtn.toggleClass('is-active', !!this.plugin.settings.showProjectWideItems);
            
            // Determine project context from actual state, NOT resolveActiveView()
            const pm = LongformProjectManager.getInstance();
            const pinnedProject = pm.getPinnedProjectPath();
            const pinnedFile = pm.getPinnedFilePath();
            
            // Check if the actual current editor file is in a project
            const activeFile = this.app.workspace.getActiveFile();
            const activeFileInProject = activeFile ? pm.isFileInProject(activeFile.path) : false;
            
            // Check if the pinned file belongs to a project
            const pinnedFileInProject = pinnedFile ? pm.isFileInProject(pinnedFile) : false;
            
            const isInProject = !!pinnedProject || activeFileInProject || pinnedFileInProject;
            
            projectBtn.toggleClass('is-hidden', !isInProject);
        }
        
        if (previewBtn) {
            previewBtn.toggleClass('is-active', !!this.plugin.settings.showPanelPreviews);
            
            // Preview toggle is visible for blocks, equations, figures
            const isPreviewSupported = activeId === 'fenced-divs' || activeId === 'equations' || activeId === 'figures';
            previewBtn.toggleClass('is-hidden', !isPreviewSupported);
        }
    }

    refreshPanels(): void {
        const activePanelId = this.activePanel?.id;
        
        for (const panel of this.panels) {
            if (panel.module === this.activePanel) {
                panel.module.onDeactivate();
            }
            panel.module.destroy();
        }
        
        this.panels = [];
        this.activePanel = null;
        
        this.initializePanels();
        this.renderView();
        
        if (activePanelId) {
            const panelToRestore = this.panels.find(p => p.id === activePanelId);
            if (panelToRestore) {
                this.switchToPanel(panelToRestore);
            }
        }
    }
}
