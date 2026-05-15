import { MarkdownView } from 'obsidian';

import { PandocExtendedMarkdownPlugin } from '../../../core/main';

export interface PanelModule {
    id: string;
    displayName: string;
    icon: string;
    isActive: boolean;
    
    onActivate(containerEl: HTMLElement, activeView: MarkdownView | null): void;
    onDeactivate(): void;
    onUpdate(activeView: MarkdownView | null): void;
    shouldUpdate(): boolean;
    destroy(): void;
    setSearchQuery(query: string): void;
    /** Optional: render module-specific action buttons into the top bar actions area */
    renderActions?(actionsEl: HTMLElement, activeView: MarkdownView | null): void;
    /** Optional: sync active heading from scroll position */
    setActiveHeading?(filePath: string, lineNumber: number): void;
}

export interface PanelModuleConstructor {
    new(plugin: PandocExtendedMarkdownPlugin): PanelModule;
}

export interface PanelTabInfo {
    id: string;
    displayName: string;
    icon: string;
    module: PanelModule;
}