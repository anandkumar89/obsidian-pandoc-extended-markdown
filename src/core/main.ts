// External libraries
import { Plugin, Notice, Editor, MarkdownView, WorkspaceLeaf, addIcon, Component, TFile, TFolder } from 'obsidian';
import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';

// Types
import {
    PandocExtendedMarkdownSettings,
    PandocExtendedMarkdownSettingTab,
    normalizeSettings,
    isSyntaxFeatureEnabled
} from './settings';
import { createProcessorConfig } from '../shared/types/processorConfig';

// Constants
import { MESSAGES, COMMANDS, UI_CONSTANTS, ICONS } from './constants';

// Patterns
import { ListPatterns } from '../shared/patterns';

// Internal modules
import { pandocExtendedMarkdownExtension } from '../live-preview/extension';
import { processReadingMode } from '../reading-mode/processor';
import { pluginStateManager } from './state/pluginStateManager';
import { LongformProjectManager } from './state/longformProjectManager';
import { ListPanelView, VIEW_TYPE_LIST_PANEL } from '../views/panels/ListPanelView';
import { CitationDetailView, VIEW_TYPE_CITATION_DETAIL } from '../views/panels/CitationDetailView';
import { FencedDivReferenceSuggest } from '../editor-extensions/suggestions/fencedDivReferenceSuggest';
import { PandocExporter } from '../shared/utils/pandocExporter';

export class PandocExtendedMarkdownPlugin extends Plugin {
    private listPanelRibbonIcon: HTMLElement | null = null;
    settings: PandocExtendedMarkdownSettings;

    async onload() {
        await this.loadSettings();
        
        // Register custom icons for views
        this.registerViewIcons();
        
        // Add settings tab
        this.addSettingTab(new PandocExtendedMarkdownSettingTab(this.app, this));
        
        // Initialize Longform Project Manager before extensions that depend on it
        LongformProjectManager.getInstance(this);

        // Register all extensions and processors
        this.setupExtensions();
        this.registerPostProcessor();
        
        // Set up mode change detection
        this.setupModeChangeDetection();
        
        // Check for project for the currently active file on startup
        this.app.workspace.onLayoutReady(async () => {
            const activeFile = this.app.workspace.getActiveFile();
            const pm = LongformProjectManager.getInstance(this);
            
            if (pm.getPinnedProjectPath()) {
                const folder = this.app.vault.getAbstractFileByPath(pm.getPinnedProjectPath()!);
                if (folder instanceof TFolder) await pm.scanProject(folder);
            } else if (pm.getPinnedFilePath()) {
                const file = this.app.vault.getAbstractFileByPath(pm.getPinnedFilePath()!);
                if (file instanceof TFile) await pm.checkAndLoadProjectForFile(file);
            }

            if (activeFile) {
                void pm.checkAndLoadProjectForFile(activeFile);
            } else if (pm.getPinnedProjectPath() || pm.getPinnedFilePath()) {
                const panel = this.getListPanelView();
                if (panel) void panel.updateView();
            }
        });
        
        // Register list panel view
        this.registerView(
            VIEW_TYPE_LIST_PANEL,
            (leaf) => new ListPanelView(leaf, this)
        );

        this.registerView(
            VIEW_TYPE_CITATION_DETAIL,
            (leaf) => new CitationDetailView(leaf)
        );
        
        // Register all commands
        this.registerCommands();

        this.updateListPanelAvailability();



        // Apply list panel availability once layout is ready
        this.app.workspace.onLayoutReady(() => {
            this.updateListPanelAvailability();
        });
    }

    private registerViewIcons(): void {
        addIcon(ICONS.CUSTOM_LABEL_ID, ICONS.CUSTOM_LABEL_SVG);
        addIcon(ICONS.LIST_PANEL_ID, ICONS.LIST_PANEL_SVG);
    }

    private setupExtensions(): void {
        this.registerEditorExtension(pandocExtendedMarkdownExtension(
            () => this.settings,
            () => {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                return activeView?.file?.path || null;
            },
            () => this.app,
            () => this as Component
        ));
        
        this.registerEditorSuggest(new FencedDivReferenceSuggest(this));
    }

    private registerPostProcessor(): void {
        // Register markdown post-processor for reading mode
        this.registerMarkdownPostProcessor((element, context) => {
            // Create processor config from current settings
            const vault = this.app.vault as typeof this.app.vault & {
                getConfig(key: 'strictLineBreaks'): boolean;
            };
            const config = createProcessorConfig({ strictLineBreaks: vault.getConfig('strictLineBreaks') }, this.settings);
            processReadingMode(element, context, config, this.app);
        });
    }

    private setupModeChangeDetection(): void {
        const updateStates = () => {
            const leaves = this.app.workspace.getLeavesOfType("markdown");
            const hadChanges = pluginStateManager.scanAllLeaves(leaves);
            
            // Only force CodeMirror refresh if there were actual mode changes
            if (hadChanges) {
                // Small delay to ensure mode switch side effects settle before refreshing editors
                window.setTimeout(() => {
                    this.app.workspace.updateOptions();
                }, UI_CONSTANTS.MODE_REFRESH_DELAY_MS);
            }
        };
        
        // Initial scan
        updateStates();
        
        // Register workspace events for mode change detection
        this.registerEvent(this.app.workspace.on("layout-change", updateStates));
        this.registerEvent(this.app.workspace.on("active-leaf-change", updateStates));
        this.registerEvent(this.app.workspace.on("file-open", async (file) => {
            if (file) {
                await LongformProjectManager.getInstance().checkAndLoadProjectForFile(file);
            }
            updateStates();
        }));
    }

    private registerCommands(): void {
        // Add command to open list panel view
        this.addCommand({
            id: COMMANDS.OPEN_LIST_PANEL,
            name: 'Open list panel',
            callback: () => {
                void this.activateListPanelView();
            }
        });

        this.addCommand({
            id: COMMANDS.EXPORT_PANDOC,
            name: 'Export to Pandoc',
            editorCallback: (editor, view) => {
                const exporter = new PandocExporter(this.app, this.settings);
                void exporter.export(view.file!, 'standalone', this.settings.defaultExportFormat);
            }
        });


    }

    onunload() {
        // Clear all states on unload
        pluginStateManager.clearAllStates();
        
        // List panel views will auto-reinitialize when plugin reloads
        // Other cleanup is handled automatically by Obsidian
    }

    public getListPanelView(): ListPanelView | null {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_LIST_PANEL);
        if (leaves.length > 0 && leaves[0].view instanceof ListPanelView) {
            return leaves[0].view;
        }
        return null;
    }

    
    async activateListPanelView() {
        if (!this.settings.enableListPanel) {
            new Notice(MESSAGES.LIST_PANEL_DISABLED);
            return;
        }
        const { workspace } = this.app;
        
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_LIST_PANEL);
        
        if (leaves.length > 0) {
            // A leaf with our view already exists, use that
            leaf = leaves[0];
        } else {
            // Our view could not be found in the workspace, create a new leaf
            // in the right sidebar for it
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_LIST_PANEL, active: true });
            }
        }
        
        // "Reveal" the leaf in case it is in a collapsed sidebar
        if (leaf) {
            await workspace.revealLeaf(leaf);
        }
    }

    updateListPanelAvailability(): void {
        if (this.settings.enableListPanel) {
            this.ensureListPanelRibbonIcon();
        } else {
            this.removeListPanelRibbonIcon();
            this.closeListPanelViews();
        }
    }

    private ensureListPanelRibbonIcon(): void {
        if (this.listPanelRibbonIcon) return;
        this.listPanelRibbonIcon = this.addRibbonIcon(ICONS.LIST_PANEL_ID, 'Open list panel', () => {
            void this.activateListPanelView();
        });
    }

    private removeListPanelRibbonIcon(): void {
        if (!this.listPanelRibbonIcon) return;
        this.listPanelRibbonIcon.remove();
        this.listPanelRibbonIcon = null;
    }

    private closeListPanelViews(): void {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_LIST_PANEL);
        for (const leaf of leaves) {
            leaf.detach();
        }
    }
    
    async loadSettings() {
        const loadedSettings = await this.loadData() as Partial<PandocExtendedMarkdownSettings> | null;
        this.settings = normalizeSettings(loadedSettings ?? undefined);
    }

    async saveSettings() {
        this.settings = normalizeSettings(this.settings);
        await this.saveData(this.settings);
    }

}

export default PandocExtendedMarkdownPlugin;
