import { MarkdownView, TFile, Setting, Notice } from 'obsidian';
import { BasePanelModule } from './BasePanelModule';
import { PandocExtendedMarkdownPlugin } from '../../../core/main';
import { ICONS } from '../../../core/constants';
import { PandocExporter, ExportType } from '../../../shared/utils/pandocExporter';
import { LongformProjectManager } from '../../../core/state/longformProjectManager';

export class ExportPanelModule extends BasePanelModule {
    id = 'export';
    displayName = 'Settings & Export';
    icon = ICONS.EXPORT_SVG;

    private exporter: PandocExporter;
    private projectManager: LongformProjectManager;
    private selectedFormat: string;
    private expandedExportProjectId: string | null = null;

    constructor(plugin: PandocExtendedMarkdownPlugin) {
        super(plugin);
        this.exporter = new PandocExporter(plugin.app, plugin.settings);
        this.projectManager = LongformProjectManager.getInstance();
        this.selectedFormat = this.plugin.settings.defaultExportFormat;
    }

    protected extractData(content: string): void {
        // No data extraction needed for this module
    }

    protected renderContent(activeView: MarkdownView | null): void {
        if (!this.containerEl) return;

        this.containerEl.empty();
        this.containerEl.addClass('pem-panel-export-container');

        // --- 1. Quick Toggles (Top) ---
        const quickTogglesSection = this.containerEl.createDiv('pem-panel-section');
        quickTogglesSection.createEl('div', { text: 'Quick Toggles', cls: 'pem-section-title' });
        
        new Setting(quickTogglesSection)
            .setName('Heading Numbering')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableHeadingNumbering)
                .onChange(async (value) => {
                    this.plugin.settings.enableHeadingNumbering = value;
                    await this.plugin.saveSettings();
                    await this.projectManager.forceReload();
                    this.renderContent(activeView);
                }));

        new Setting(quickTogglesSection)
            .setName('TOC File Separators')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showTOCFileBreaks)
                .onChange(async (value) => {
                    this.plugin.settings.showTOCFileBreaks = value;
                    await this.plugin.saveSettings();
                    this.plugin.app.workspace.trigger('pem:settings-changed');
                }));

        // --- 2. Longform Projects (Middle) ---
        const projectsSection = this.containerEl.createDiv('pem-panel-section');
        projectsSection.createEl('div', { text: 'Longform Projects', cls: 'pem-section-title' });
        const listContainer = projectsSection.createDiv('pem-panel-project-list');
        void this.renderProjectList(listContainer, activeView);

        // --- 3. Project Management Buttons (Below List) ---
        const mgmtContainer = projectsSection.createDiv('pem-project-mgmt-buttons');
        
        // Add Project Toggle (Show/Hide input)
        const addProjectBtn = mgmtContainer.createEl('button', { text: 'Add a project', cls: 'pem-mgmt-btn' });
        const rescanBtn = mgmtContainer.createEl('button', { text: 'Rescan Long', cls: 'pem-mgmt-btn' });

        const addInputContainer = projectsSection.createDiv('pem-add-input-container is-hidden');
        const addInput = addInputContainer.createEl('input', {
            cls: 'pem-project-path-input',
            attr: { type: 'text', placeholder: 'Path to Index.md...' }
        });
        const doAddBtn = addInputContainer.createEl('button', { text: 'Add', cls: 'mod-cta' });

        addProjectBtn.addEventListener('click', () => {
            addInputContainer.classList.toggle('is-hidden');
            if (!addInputContainer.classList.contains('is-hidden')) addInput.focus();
        });

        rescanBtn.addEventListener('click', async () => {
            await this.projectManager.forceReload();
            new Notice('Projects rescanned');
            this.renderContent(activeView);
        });

        doAddBtn.addEventListener('click', async () => {
            const path = addInput.value.trim();
            if (!path) return;
            const success = await this.projectManager.registerProject(path);
            if (success) {
                new Notice('Project added');
                addInput.value = '';
                addInputContainer.addClass('is-hidden');
                this.renderContent(activeView);
            } else {
                new Notice('Invalid project path');
            }
        });

        // --- 4. Pinned File or Recent Items (Bottom) ---
        const pinningSection = this.containerEl.createDiv('pem-panel-section');
        const pinnedFilePath = this.plugin.settings.pinnedFilePath;
        const activeFile = activeView?.file;
        
        if (pinnedFilePath) {
            pinningSection.createEl('div', { text: 'Pinned File', cls: 'pem-section-title' });
            this.renderFileRow(pinningSection, pinnedFilePath, activeView);
        } else if (activeFile) {
            pinningSection.createEl('div', { text: 'Active File', cls: 'pem-section-title' });
            this.renderFileRow(pinningSection, activeFile.path, activeView);
        } else {
            // Nothing pinned and no active file - show recents
            this.renderRecentItems(pinningSection, activeView);
        }
    }

    private renderFileRow(container: HTMLElement, filePath: string, activeView: MarkdownView | null): void {
        const pinnedFilePath = this.plugin.settings.pinnedFilePath;
        const fileRow = container.createDiv('pem-project-item pem-file-row');
        if (pinnedFilePath === filePath) fileRow.addClass('is-pinned');

        const info = fileRow.createDiv('pem-project-info');
        info.createDiv({ text: filePath.split('/').pop() || '', cls: 'pem-project-name' });
        info.createDiv({ text: filePath, cls: 'pem-project-path' });

        const actions = fileRow.createDiv('pem-project-actions');
        const { setIcon } = require('obsidian');

        // Pin/Unpin
        const isPinned = pinnedFilePath === filePath;
        const pinBtn = actions.createEl('button', {
            cls: isPinned ? 'pem-pin-btn is-active' : 'pem-pin-btn',
            title: isPinned ? 'Unpin file' : 'Pin file'
        });
        pinBtn.innerHTML = isPinned ? '📍' : '📌';
        pinBtn.addEventListener('click', async () => {
            if (isPinned) {
                this.plugin.settings.pinnedFilePath = null;
            } else {
                this.plugin.settings.pinnedFilePath = filePath;
                this.plugin.settings.pinnedProjectPath = null;
            }
            await this.plugin.saveSettings();
            this.plugin.app.workspace.trigger('pem:settings-changed');
            this.renderContent(activeView);
        });

        // Refresh
        const refreshBtn = actions.createEl('button', { cls: 'pem-action-icon', title: 'Refresh' });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.addEventListener('click', async () => {
            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.projectManager.ensureFileCached(file);
                new Notice('File cache refreshed');
            }
        });

        // Export
        const exportBtn = actions.createEl('button', { cls: 'pem-action-icon', title: 'Export' });
        setIcon(exportBtn, 'download');
        exportBtn.addEventListener('click', () => {
            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                void this.exporter.export(file, 'standalone', this.plugin.settings.defaultExportFormat);
            }
        });
    }

    private renderRecentItems(container: HTMLElement, activeView: MarkdownView | null): void {
        const recentFiles = (this.plugin.settings.recentFiles || []).slice(0, 5);
        
        if (recentFiles.length === 0) {
            container.createEl('div', { text: 'No recent files processed', cls: 'pem-no-data' });
            return;
        }

        container.createEl('div', { text: 'Recent Files (Last 5)', cls: 'pem-section-title' });
        const listContainer = container.createDiv('pem-panel-project-list');

        // Recent Files
        recentFiles.forEach(path => {
            const itemEl = listContainer.createDiv('pem-project-item pem-recent-item');
            const info = itemEl.createDiv('pem-project-info');
            info.createDiv({ text: `📄 ${path.split('/').pop() || path}`, cls: 'pem-project-name' });
            info.createDiv({ text: path, cls: 'pem-project-path' });
            
            itemEl.addEventListener('click', async () => {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    const leaf = this.app.workspace.getLeaf(false);
                    await leaf.openFile(file);
                } else {
                    new Notice('File no longer exists or was moved');
                }
            });
        });
    }

    private async renderProjectList(container: HTMLElement, activeView: MarkdownView | null): Promise<void> {
        const projects = await this.projectManager.findAllProjects();
        const pinnedPath = this.plugin.settings.pinnedProjectPath;

        if (projects.length === 0) {
            container.createEl('div', { text: 'No projects registered', cls: 'pem-no-data' });
            return;
        }

        for (const project of projects) {
            const isPinned = pinnedPath === project.path;
            const projectEl = container.createDiv('pem-project-item');
            if (isPinned) projectEl.addClass('is-pinned');

            const info = projectEl.createDiv('pem-project-info');
            info.createDiv({ text: project.name, cls: 'pem-project-name' });
            info.createDiv({ text: project.path, cls: 'pem-project-path' });

            const actions = projectEl.createDiv('pem-project-actions');
            const { setIcon } = require('obsidian');

            // Rebuild Icon
            const rebuildBtn = actions.createEl('button', { cls: 'pem-action-icon', title: 'Rebuild Index' });
            setIcon(rebuildBtn, 'refresh-cw');
            rebuildBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.projectManager.forceReload();
                new Notice(`Index rebuilt for ${project.name}`);
            });

            // Pin Icon (Exclusive)
            const pinBtn = actions.createEl('button', {
                cls: isPinned ? 'pem-pin-btn is-active' : 'pem-pin-btn',
                title: isPinned ? 'Unpin project' : 'Pin project'
            });
            pinBtn.innerHTML = isPinned ? '📍' : '📌';
            pinBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (isPinned) {
                    this.plugin.settings.pinnedProjectPath = null;
                } else {
                    this.plugin.settings.pinnedProjectPath = project.path;
                    this.plugin.settings.pinnedFilePath = null; // Exclusive
                }
                await this.plugin.saveSettings();
                this.plugin.app.workspace.trigger('pem:settings-changed');
                this.renderContent(activeView);
            });

            // Export Toggle Icon
            const isExpanded = this.expandedExportProjectId === project.path;
            const exportToggleBtn = actions.createEl('button', { cls: isExpanded ? 'pem-action-icon is-active' : 'pem-action-icon', title: 'Export Options' });
            setIcon(exportToggleBtn, 'download');
            exportToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.expandedExportProjectId = isExpanded ? null : project.path;
                this.renderContent(activeView);
            });

            // Remove Icon
            const removeBtn = actions.createEl('button', { cls: 'pem-action-icon', title: 'Remove Project' });
            setIcon(removeBtn, 'trash');
            removeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.projectManager.unregisterProject(project.path);
                this.renderContent(activeView);
            });

            // --- Inline Export Form ---
            if (isExpanded) {
                const exportForm = projectEl.createDiv('pem-inline-export-form');
                
                let localType: ExportType = 'article';
                let localFormat: string = 'pdf';

                new Setting(exportForm)
                    .setName('Type')
                    .addDropdown(d => d
                        .addOption('article', 'Article')
                        .addOption('report', 'Report')
                        .setValue(localType)
                        .onChange(v => localType = v as ExportType));

                new Setting(exportForm)
                    .setName('Format')
                    .addDropdown(d => d
                        .addOption('pdf', 'PDF')
                        .addOption('tex', 'LaTeX')
                        .addOption('html', 'HTML')
                        .setValue(localFormat)
                        .onChange(v => localFormat = v));

                const doExportBtn = exportForm.createEl('button', { text: 'Export Now', cls: 'mod-cta pem-do-export-btn' });
                doExportBtn.addEventListener('click', async () => {
                    const indexFile = this.plugin.app.vault.getAbstractFileByPath(`${project.path}/Index.md`);
                    if (indexFile instanceof TFile) {
                        void this.exporter.export(indexFile, localType, localFormat);
                        new Notice(`Exporting ${project.name}...`);
                    } else {
                        new Notice('Could not find Index.md for export');
                    }
                });
            }
        }
    }
}
