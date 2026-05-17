/**
 * Settings and state-related type definitions for the Pandoc Extended Markdown plugin.
 */
import { FencedDivReference } from './fencedDivTypes';

export type ViewMode = "reading" | "live" | "source";

export interface DocumentCounters {
    fencedDivLabels: Map<string, FencedDivReference>; // Maps fenced div ids to display metadata
}

export interface ViewState {
    mode: ViewMode;
    filePath: string | null;
}

export interface ModeChangeEvent {
    leafId: string;
    previousMode: ViewMode | null;
    currentMode: ViewMode;
    previousPath: string | null;
    currentPath: string | null;
}

export interface PandocExtendedMarkdownSettings {
    enableFencedDivs?: boolean;
    enableHeadingNumbering?: boolean;
    enableCitations?: boolean;
    enableListPanel: boolean;
    // Pandoc Export Settings
    pandocPath: string;
    exportOutputDirectory: string;
    defaultExportFormat: string;
    unnumberedClasses: string[];
    tocViewMode: 'toc' | 'toc-rail' | 'rail-only';
    pinnedProjectPath: string | null;
    pinnedFilePath: string | null;
    knownProjectPaths: string[];
    recentFiles: string[];
    recentProjects: string[];
    showProjectWideItems: boolean;
    showPanelPreviews: boolean;
}

export const DEFAULT_SETTINGS: PandocExtendedMarkdownSettings = {
    enableFencedDivs: true,
    enableHeadingNumbering: true,
    enableCitations: true,
    enableListPanel: true,
    pandocPath: '/usr/local/bin/pandoc',
    exportOutputDirectory: 'Exports',
    defaultExportFormat: 'pdf',
    unnumberedClasses: ['proof'],
    tocViewMode: 'toc-rail',
    pinnedProjectPath: null,
    pinnedFilePath: null,
    knownProjectPaths: [],
    recentFiles: [],
    recentProjects: [],
    showProjectWideItems: false,
    showPanelPreviews: true
};

export type SyntaxFeatureSettingKey = 'enableFencedDivs' | 'enableHeadingNumbering' | 'enableCitations';

export function isSyntaxFeatureEnabled(
    settings: Partial<PandocExtendedMarkdownSettings>,
    key: SyntaxFeatureSettingKey
): boolean {
    return settings[key] ?? DEFAULT_SETTINGS[key] ?? false;
}

export function normalizeSettings(
    settings?: Partial<PandocExtendedMarkdownSettings>
): PandocExtendedMarkdownSettings {
    const sourceSettings = settings ?? {};
    return {
        enableFencedDivs: isSyntaxFeatureEnabled(sourceSettings, 'enableFencedDivs'),
        enableHeadingNumbering: isSyntaxFeatureEnabled(sourceSettings, 'enableHeadingNumbering'),
        enableCitations: isSyntaxFeatureEnabled(sourceSettings, 'enableCitations'),
        enableListPanel: sourceSettings.enableListPanel ?? DEFAULT_SETTINGS.enableListPanel,
        pandocPath: sourceSettings.pandocPath ?? DEFAULT_SETTINGS.pandocPath,
        exportOutputDirectory: sourceSettings.exportOutputDirectory ?? DEFAULT_SETTINGS.exportOutputDirectory,
        defaultExportFormat: sourceSettings.defaultExportFormat ?? DEFAULT_SETTINGS.defaultExportFormat,
        unnumberedClasses: sourceSettings.unnumberedClasses ?? [...DEFAULT_SETTINGS.unnumberedClasses],
        tocViewMode: sourceSettings.tocViewMode ?? DEFAULT_SETTINGS.tocViewMode,
        pinnedProjectPath: sourceSettings.pinnedProjectPath ?? DEFAULT_SETTINGS.pinnedProjectPath,
        pinnedFilePath: sourceSettings.pinnedFilePath ?? DEFAULT_SETTINGS.pinnedFilePath,
        knownProjectPaths: sourceSettings.knownProjectPaths ?? [...DEFAULT_SETTINGS.knownProjectPaths],
        recentFiles: sourceSettings.recentFiles ?? [...DEFAULT_SETTINGS.recentFiles],
        recentProjects: sourceSettings.recentProjects ?? [...DEFAULT_SETTINGS.recentProjects],
        showProjectWideItems: sourceSettings.showProjectWideItems ?? DEFAULT_SETTINGS.showProjectWideItems,
        showPanelPreviews: sourceSettings.showPanelPreviews ?? DEFAULT_SETTINGS.showPanelPreviews
    };
}
