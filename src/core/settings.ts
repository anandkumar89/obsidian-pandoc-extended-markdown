// External libraries
import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { LongformProjectManager } from './state/longformProjectManager';

// Types
import {
    PandocExtendedMarkdownSettings,
    DEFAULT_SETTINGS,
    normalizeSettings,
    isSyntaxFeatureEnabled,
    SyntaxFeatureSettingKey
} from '../shared/types/settingsTypes';

import { PANEL_SETTINGS, SETTINGS_UI } from './constants';
import type { ListPanelView } from '../views/panels/ListPanelView';
import { VIEW_TYPE_LIST_PANEL } from '../views/panels/ListPanelView';


export type { PandocExtendedMarkdownSettings };
export {
    DEFAULT_SETTINGS,
    normalizeSettings,
    isSyntaxFeatureEnabled
};

interface PanelOrderButtons {
    moveUp: HTMLButtonElement;
    moveDown: HTMLButtonElement;
    moveTop: HTMLButtonElement;
    moveBottom: HTMLButtonElement;
    reset: HTMLButtonElement;
}
export class PandocExtendedMarkdownSettingTab extends PluginSettingTab {
    plugin: Plugin & {
        settings: PandocExtendedMarkdownSettings;
        saveSettings: () => Promise<void>;
        updateListPanelAvailability: () => void;
    };

    constructor(app: App, plugin: Plugin & {
        settings: PandocExtendedMarkdownSettings;
        saveSettings: () => Promise<void>;
        updateListPanelAvailability: () => void;
    }) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        this.plugin.settings = normalizeSettings(this.plugin.settings);

        this.renderSyntaxFeatureSettings(containerEl);
        this.renderProjectSettings(containerEl);
        this.renderSidebarSettings(containerEl);
        this.renderPandocExportSettings(containerEl);
    }

    private renderProjectSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Longform Projects')
            .setDesc('Manage your Longform projects. The plugin automatically discovers projects with "longform" frontmatter.')
            .setHeading();

        new Setting(containerEl)
            .setName('Global Project Scan')
            .setDesc('Scan the entire vault for Longform projects and update the project list.')
            .addButton(btn => btn
                .setButtonText('Scan Now')
                .setCta()
                .onClick(async () => {
                    const pm = LongformProjectManager.getInstance();
                    await pm.discoverLongformProjects();
                    new Notice('Project scan complete.');
                    this.display(); // Refresh settings tab
                }));

        const projectPaths = this.plugin.settings.knownProjectPaths || [];
        if (projectPaths.length === 0) {
            containerEl.createDiv({ text: 'No projects discovered yet.', cls: 'pem-settings-empty-msg' });
        } else {
            projectPaths.forEach(path => {
                const setting = new Setting(containerEl)
                    .setName(path.split('/').pop() || path)
                    .setDesc(path);
                
                setting.addButton(btn => btn
                    .setButtonText('Remove')
                    .setWarning()
                    .onClick(async () => {
                        const pm = LongformProjectManager.getInstance();
                        await pm.unregisterProject(path);
                        new Notice('Project removed.');
                        this.display();
                    }));
            });
        }
    }


    private renderSyntaxFeatureSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(SETTINGS_UI.SYNTAX_FEATURES.NAME)
            .setDesc(SETTINGS_UI.SYNTAX_FEATURES.DESCRIPTION)
            .setHeading();

        this.createFeatureToggle(
            containerEl,
            SETTINGS_UI.FENCED_DIVS.NAME,
            SETTINGS_UI.FENCED_DIVS.DESCRIPTION,
            'enableFencedDivs'
        );

        this.createFeatureToggle(
            containerEl,
            SETTINGS_UI.HEADING_NUMBERING.NAME,
            SETTINGS_UI.HEADING_NUMBERING.DESCRIPTION,
            'enableHeadingNumbering'
        );
        
        this.createFeatureToggle(
            containerEl,
            SETTINGS_UI.CITATIONS.NAME,
            SETTINGS_UI.CITATIONS.DESCRIPTION,
            'enableCitations'
        );

        new Setting(containerEl)
            .setName('Unnumbered Block Classes')
            .setDesc('Comma-separated list of fenced div classes that should NOT be numbered (e.g., proof, exercise).')
            .addText(text => text
                .setPlaceholder('proof, exercise')
                .setValue(this.plugin.settings.unnumberedClasses.join(', '))
                .onChange(async (value) => {
                    this.plugin.settings.unnumberedClasses = value
                        .split(',')
                        .map(s => s.trim())
                        .filter(s => s.length > 0);
                    await this.plugin.saveSettings();
                }));
    }

    private renderSidebarSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(SETTINGS_UI.PANEL_FEATURES.NAME)
            .setDesc(SETTINGS_UI.PANEL_FEATURES.DESCRIPTION)
            .setHeading();

        new Setting(containerEl)
            .setName(SETTINGS_UI.LIST_PANEL.NAME)
            .setDesc(SETTINGS_UI.LIST_PANEL.DESCRIPTION)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableListPanel)
                .onChange(async (value) => {
                    this.plugin.settings.enableListPanel = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateListPanelAvailability();
                }));
    }

    private renderPandocExportSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(SETTINGS_UI.PANDOC_SETTINGS.NAME)
            .setDesc(SETTINGS_UI.PANDOC_SETTINGS.DESCRIPTION)
            .setHeading();

        new Setting(containerEl)
            .setName(SETTINGS_UI.PANDOC_SETTINGS.PATH_NAME)
            .setDesc(SETTINGS_UI.PANDOC_SETTINGS.PATH_DESC)
            .addText(text => text
                .setPlaceholder('pandoc')
                .setValue(this.plugin.settings.pandocPath)
                .onChange(async (value) => {
                    this.plugin.settings.pandocPath = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(SETTINGS_UI.PANDOC_SETTINGS.OUTPUT_NAME)
            .setDesc(SETTINGS_UI.PANDOC_SETTINGS.OUTPUT_DESC)
            .addText(text => text
                .setPlaceholder('Exports')
                .setValue(this.plugin.settings.exportOutputDirectory)
                .onChange(async (value) => {
                    this.plugin.settings.exportOutputDirectory = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(SETTINGS_UI.PANDOC_SETTINGS.FORMAT_NAME)
            .setDesc(SETTINGS_UI.PANDOC_SETTINGS.FORMAT_DESC)
            .addDropdown(dropdown => dropdown
                .addOption('pdf', 'PDF')
                .addOption('docx', 'Word (.docx)')
                .addOption('html', 'HTML')
                .addOption('epub', 'EPUB')
                .addOption('latex', 'LaTeX')
                .setValue(this.plugin.settings.defaultExportFormat)
                .onChange(async (value) => {
                    this.plugin.settings.defaultExportFormat = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Hard Refresh Citation Cache')
            .setDesc('Clear all cached citation metadata from Zotero. Use this if citation details are outdated.')
            .addButton(btn => btn
                .setButtonText('Refresh Cache')
                .setWarning()
                .onClick(async () => {
                    const pm = LongformProjectManager.getInstance();
                    await pm.clearCitationCache();
                    new Notice('Citation cache cleared. Details will reload on next panel open.');
                }));
    }

    private createFeatureToggle(
        containerEl: HTMLElement,
        name: string,
        description: string,
        settingKey: SyntaxFeatureSettingKey
    ): void {
        new Setting(containerEl)
            .setName(name)
            .setDesc(description)
            .addToggle(toggle => toggle
                .setValue(isSyntaxFeatureEnabled(this.plugin.settings, settingKey))
                .onChange(async (value) => {
                    this.plugin.settings[settingKey] = value;
                    await this.plugin.saveSettings();
                    this.app.workspace.updateOptions();
                    this.refreshListPanels();
                }));
    }


    private refreshListPanels(): void {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_LIST_PANEL);
        for (const leaf of leaves) {
            const view = leaf.view as ListPanelView;
            if (view && view.refreshPanels) {
                view.refreshPanels();
            }
        }
    }
}
