// External libraries
import { ItemView, WorkspaceLeaf, MarkdownView, HoverLinkSource, TFile } from 'obsidian';

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
                this.scheduleUpdate();
            })
        );
        
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
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
        
        // Top bar: tabs on left, search and settings on right
        this.topBarEl = viewContainer.createDiv({ cls: 'pem-panel-top-bar' });

        const tabsEl = this.topBarEl.createDiv({ cls: 'pem-panel-tabs' });

        // Main modules
        const mainTabsOrder = ['toc', 'fenced-divs', 'equations', 'figures', 'citations'];
        for (const panelId of mainTabsOrder) {
            const panel = this.panels.find(p => p.id === panelId);
            if (!panel) continue;
            this.renderTabButton(tabsEl, panel);
        }

        const rightActionsEl = this.topBarEl.createDiv({ cls: 'pem-panel-right-actions' });

        // Search toggle
        const searchToggleBtn = rightActionsEl.createDiv({ 
            cls: 'pem-panel-tab pem-search-toggle',
            attr: { 'aria-label': 'Search' }
        });
        const { setIcon } = require('obsidian');
        setIcon(searchToggleBtn, 'search');
        
        // Export/Settings
        const exportPanel = this.panels.find(p => p.id === 'export');
        if (exportPanel) {
            this.renderTabButton(rightActionsEl, exportPanel);
        }

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

        // Module actions container at the BOTTOM
        this.moduleActionsEl = viewContainer.createDiv({ cls: 'pem-module-actions-container' });
        
        if (this.panels.length > 0) {
            this.switchToPanel(this.panels[0]);
        }
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

        // Render module-specific action buttons in the top bar
        if (this.moduleActionsEl) {
            this.moduleActionsEl.empty();
            if (this.activePanel.renderActions) {
                this.activePanel.renderActions(this.moduleActionsEl, this.lastActiveMarkdownView);
            }
        }
        
        if (this.contentContainerEl) {
            this.contentContainerEl.empty();
            this.activePanel.onActivate(this.contentContainerEl, this.lastActiveMarkdownView);
        }
    }
    
    private renderTabButton(container: HTMLElement, panel: PanelTabInfo): void {
        const tabBtn = container.createDiv({
            cls: 'pem-panel-tab',
            attr: {
                'aria-label': panel.displayName,
                'data-panel-id': panel.id
            }
        });
        
        const { setIcon } = require('obsidian');
        
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
                let markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
                const pm = LongformProjectManager.getInstance();
                
                // If pinned file exists, use it instead of active view
                const pinnedFilePath = pm.getPinnedFilePath();
                if (pinnedFilePath) {
                    const file = this.app.vault.getAbstractFileByPath(pinnedFilePath);
                    if (file instanceof TFile) {
                        // We need a MarkdownView. If the file is open, we can find its view.
                        // If not, we might need a "mock" view or handle null in modules.
                        const leaves = this.app.workspace.getLeavesOfType('markdown');
                        const targetLeaf = leaves.find(l => (l.view as MarkdownView).file?.path === pinnedFilePath);
                        if (targetLeaf) {
                            markdownView = targetLeaf.view as MarkdownView;
                        } else {
                            // If not open, modules should handle null activeView by using the pinned project/file path
                            markdownView = null;
                        }
                    }
                } else if (markdownView && markdownView.file) {
                    this.lastActiveMarkdownView = markdownView;
                } else if (!markdownView) {
                    // Check if a project is pinned
                    if (pm.getPinnedProjectPath()) {
                        markdownView = this.lastActiveMarkdownView;
                    }
                }
                
                if (this.activePanel && this.activePanel.shouldUpdate()) {
                    this.activePanel.onUpdate(markdownView || null);
                    
                    // Refresh module actions too
                    if (this.moduleActionsEl) {
                        this.moduleActionsEl.empty();
                        if (this.activePanel.renderActions) {
                            this.activePanel.renderActions(this.moduleActionsEl, markdownView || null);
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
