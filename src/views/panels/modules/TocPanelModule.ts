import { MarkdownView, Menu, TFile, Notice, Modal, Setting, setIcon } from 'obsidian';
import { BasePanelModule } from './BasePanelModule';
import { MESSAGES, CSS_CLASSES } from '../../../core/constants';
import { SectionEntry } from '../../../shared/extractors/sectionExtractor';
import { extractSections, numberSections } from '../../../shared/extractors/sectionExtractor';
import { LongformProjectManager, SceneEntry } from '../../../core/state/longformProjectManager';
import { handleError } from '../../../shared/utils/errorHandler';
import { highlightLine } from '../../editor/highlightUtils';

export class TocPanelModule extends BasePanelModule {
    id = 'toc';
    displayName = 'Table of Contents';
    icon = 'list-tree';

    private sectionItems: SectionEntry[] = [];
    private entryElements: Map<string, HTMLElement> = new Map();
    private collapsedHeadings: Set<string> = new Set();

    constructor(plugin: PandocExtendedMarkdownPlugin) {
        super(plugin);

        // Listen for settings changes from the Export/Settings tab
        this.plugin.registerEvent(
            this.plugin.app.workspace.on('pem:settings-changed' as any, () => {
                const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView) this.onUpdate(activeView);
            })
        );
    }

    protected cleanupModuleData(): void {
        this.sectionItems = [];
        this.entryElements.clear();
    }

    protected extractData(content: string): void {
        this.sectionItems = extractSections(content);
    }

    renderActions(actionsEl: HTMLElement, activeView: MarkdownView | null): void {
        actionsEl.empty();
        const pm = LongformProjectManager.getInstance();
        const pinnedPath = pm.getPinnedProjectPath();
        const filePath = activeView?.file?.path || pinnedPath || '';
        const isInProject = pinnedPath || (filePath ? pm.isFileInProject(filePath) : false);

        let sectionsToUse = [...this.sectionItems];
        const showProject = this.plugin.settings.showProjectWideItems;
        if (isInProject && (showProject || !activeView)) {
            sectionsToUse = pm.getProjectSections(filePath);
        }

        const parentKeys: string[] = [];
        for (let i = 0; i < sectionsToUse.length; i++) {
            const section = sectionsToUse[i];
            const hasChildren = i < sectionsToUse.length - 1 && sectionsToUse[i + 1].level > section.level;
            if (hasChildren) {
                const key = `${section.filePath || filePath}:${section.lineNumber}`;
                parentKeys.push(key);
            }
        }

        if (parentKeys.length === 0) return; // No folding possible if no parent headings

        const collapseBtn = actionsEl.createDiv({
            cls: 'pem-panel-tab pem-collapse-all-toggle',
            attr: { 'aria-label': 'Collapse/Expand all headings' }
        });

        const allCollapsed = parentKeys.every(k => this.collapsedHeadings.has(k));
        setIcon(collapseBtn, allCollapsed ? 'unfold-vertical' : 'fold-vertical');
        if (allCollapsed) {
            collapseBtn.addClass('is-active');
        }

        collapseBtn.addEventListener('click', () => {
            if (allCollapsed) {
                // Expand all
                for (const key of parentKeys) {
                    this.collapsedHeadings.delete(key);
                }
            } else {
                // Collapse all
                for (const key of parentKeys) {
                    this.collapsedHeadings.add(key);
                }
            }
            this.onUpdate(activeView);
            this.renderActions(actionsEl, activeView);
        });
    }

    protected renderContent(activeView: MarkdownView | null): void {
        if (!this.containerEl) return;
        const pm = LongformProjectManager.getInstance();
        const pinnedPath = pm.getPinnedProjectPath();
        const filePath = activeView?.file?.path || pinnedPath || '';
        const isInProject = pinnedPath || (filePath ? pm.isFileInProject(filePath) : false);
        const projectPath = filePath ? pm.getProjectPath(filePath) : undefined;

        let sections: SectionEntry[];
        const showProject = this.plugin.settings.showProjectWideItems;

        if (isInProject && (showProject || !activeView)) {
            // Get all sections across the project
            sections = pm.getProjectSections(filePath);
        } else {
            sections = [...this.sectionItems];
            numberSections(sections);
        }

        if (this.searchQuery) {
            sections = sections.filter(s =>
                s.title.toLowerCase().includes(this.searchQuery) ||
                (s.number || '').toLowerCase().includes(this.searchQuery)
            );
        }

        if (sections.length === 0) {
            this.containerEl.createEl('div', {
                text: 'No headings found',
                cls: 'pem-toc-empty'
            });
            return;
        }

        const tocContainer = this.containerEl.createEl('div', { cls: 'pem-toc-container' });
        const viewMode = this.plugin.settings.tocViewMode;
        if (viewMode !== 'toc' && isInProject) {
            tocContainer.addClass('has-rail');
        }
        if (viewMode === 'rail-only' && isInProject) {
            tocContainer.addClass('is-rail-only');
        }

        // Filter out sections that are under a collapsed parent
        const visibleSections: { section: SectionEntry, originalIndex: number }[] = [];
        let collapseLevel: number | null = null;

        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            const entryKey = `${section.filePath || filePath}:${section.lineNumber}`;

            if (collapseLevel !== null) {
                if (section.level > collapseLevel) {
                    continue; // Skip child
                } else {
                    collapseLevel = null; // Back to parent level or higher
                }
            }

            visibleSections.push({ section, originalIndex: i });

            if (this.collapsedHeadings.has(entryKey)) {
                collapseLevel = section.level;
            }
        }

        // Group by file, respecting the scene order and levels
        const fileGroups: { filePath: string, sections: { section: SectionEntry, originalIndex: number }[], level: number, isFile: boolean }[] = [];

        if (isInProject && projectPath) {
            const scenes = pm.getProjectScenesByPath(projectPath);
            for (const scene of scenes) {
                const sceneSections = visibleSections.filter(s => (s.section.filePath || filePath) === scene.path);
                fileGroups.push({
                    filePath: scene.path,
                    sections: sceneSections,
                    level: scene.level,
                    isFile: scene.isFile
                });
            }
        } else {
            // Standard non-project view: group by physical file order in visibleSections
            let currentGroup: { filePath: string, sections: { section: SectionEntry, originalIndex: number }[], level: number, isFile: boolean } | null = null;
            for (const item of visibleSections) {
                const path = item.section.filePath || filePath || 'Unknown';
                if (!currentGroup || currentGroup.filePath !== path) {
                    currentGroup = { filePath: path, sections: [], level: 0, isFile: true };
                    fileGroups.push(currentGroup);
                }
                currentGroup.sections.push(item);
            }
        }

        for (const group of fileGroups) {
            if (viewMode !== 'rail-only' && group.sections.length === 0) {
                continue;
            }
            this.renderFileGroup(tocContainer, group, activeView, filePath || '', sections, group.level, group.isFile);
        }
    }

    private renderFileGroup(
        container: HTMLElement,
        group: { filePath: string, sections: { section: SectionEntry, originalIndex: number }[] },
        activeView: MarkdownView | null,
        currentViewPath: string,
        allSections: SectionEntry[],
        level: number = 0,
        isFile: boolean = true
    ): void {
        const pm = LongformProjectManager.getInstance();
        const isInProject = pm.isFileInProject(group.filePath);
        const projectPath = pm.getProjectPath(group.filePath);
        const fileName = group.filePath.split('/').pop()?.replace(/\.md$/, '') || 'Unknown';

        const groupEl = container.createDiv({ cls: 'pem-toc-file-group' });
        groupEl.dataset.path = group.filePath;

        const showProject = this.plugin.settings.showProjectWideItems;
        const viewMode = this.plugin.settings.tocViewMode;

        // ONLY apply indents to scenes in 'rail-only' mode!
        if (level > 0 && viewMode === 'rail-only') {
            groupEl.style.marginLeft = `${level * 12}px`;
            groupEl.style.borderLeft = '1px solid var(--background-modifier-border)';
        }

        if (isInProject && (showProject || !activeView) && viewMode !== 'toc') {
            const railContainer = groupEl.createDiv({ cls: 'pem-toc-rail-container' });
            const rail = railContainer.createDiv({
                cls: 'pem-toc-file-rail',
                attr: { draggable: 'true' }
            });

            // File name on rail (vertical or small)
            rail.createDiv({ cls: 'pem-toc-rail-name', text: fileName });

            // Drag and drop listeners
            rail.addEventListener('dragstart', (e) => {
                e.dataTransfer?.setData('text/plain', group.filePath);
                groupEl.addClass('is-dragging');
                // Track start X position to detect horizontal dragging left/right
                (rail as any)._startX = e.clientX;
            });

            rail.addEventListener('drag', (e) => {
                if (e.clientX !== 0) {
                    (rail as any)._lastX = e.clientX;
                }
            });

            rail.addEventListener('dragend', async (e) => {
                groupEl.removeClass('is-dragging');
                container.querySelectorAll('.pem-toc-drag-over').forEach(el => el.removeClass('pem-toc-drag-over'));

                const startX = (rail as any)._startX;
                const lastX = (rail as any)._lastX;
                if (startX !== undefined && lastX !== undefined && projectPath) {
                    const diffX = lastX - startX;
                    if (diffX > 40) {
                        // Dragged right -> Indent
                        await pm.changeSceneLevel(projectPath, group.filePath, +1);
                        this.onUpdate(activeView);
                    } else if (diffX < -40) {
                        // Dragged left -> Dedent
                        await pm.changeSceneLevel(projectPath, group.filePath, -1);
                        this.onUpdate(activeView);
                    }
                }
                delete (rail as any)._startX;
                delete (rail as any)._lastX;
            });

            groupEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                groupEl.addClass('pem-toc-drag-over');
            });

            groupEl.addEventListener('dragleave', () => {
                groupEl.removeClass('pem-toc-drag-over');
            });

            groupEl.addEventListener('drop', async (e) => {
                e.preventDefault();
                groupEl.removeClass('pem-toc-drag-over');
                const draggedPath = e.dataTransfer?.getData('text/plain');
                if (draggedPath && draggedPath !== group.filePath && projectPath) {
                    // Reorder in project
                    await pm.moveScene(projectPath, draggedPath, group.filePath, 'after');
                    this.onUpdate(activeView);
                }
            });

            // Context menu
            rail.addEventListener('contextmenu', (e) => {
                this.showSceneContextMenu(e, group.filePath, projectPath || undefined);
            });

            // Indent/Dedent/Move buttons on rail (rail-only mode)
            if (viewMode === 'rail-only') {
                const indentBtns = railContainer.createDiv({ cls: 'pem-rail-indent-btns' });

                const dedentBtn = indentBtns.createEl('button', { cls: 'pem-rail-indent-btn', title: 'Dedent (←)' });
                dedentBtn.textContent = '←';
                dedentBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (projectPath) { await pm.changeSceneLevel(projectPath, group.filePath, -1); this.onUpdate(activeView); }
                });

                const indentBtn = indentBtns.createEl('button', { cls: 'pem-rail-indent-btn', title: 'Indent (→)' });
                indentBtn.textContent = '→';
                indentBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (projectPath) { await pm.changeSceneLevel(projectPath, group.filePath, +1); this.onUpdate(activeView); }
                });

                const moveUpBtn = indentBtns.createEl('button', { cls: 'pem-rail-indent-btn', title: 'Move Up' });
                moveUpBtn.textContent = '↑';
                moveUpBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (projectPath) {
                        const scenes = pm.getProjectScenesByPath(projectPath);
                        const idx = scenes.findIndex(s => s.path === group.filePath);
                        if (idx > 0) { await pm.moveScene(projectPath, group.filePath, scenes[idx - 1].path, 'before'); this.onUpdate(activeView); }
                    }
                });

                const moveDownBtn = indentBtns.createEl('button', { cls: 'pem-rail-indent-btn', title: 'Move Down' });
                moveDownBtn.textContent = '↓';
                moveDownBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (projectPath) {
                        const scenes = pm.getProjectScenesByPath(projectPath);
                        const idx = scenes.findIndex(s => s.path === group.filePath);
                        if (idx !== -1 && idx < scenes.length - 1) { await pm.moveScene(projectPath, group.filePath, scenes[idx + 1].path, 'after'); this.onUpdate(activeView); }
                    }
                });
            }
        }

        const contentEl = groupEl.createDiv({ cls: 'pem-toc-file-content' });

        if (!isFile) {
            // Virtual grouping entry (folder)
            const folderEl = contentEl.createDiv({ cls: 'pem-toc-folder-entry' });
            folderEl.createSpan({ text: fileName, cls: 'pem-toc-folder-title' });
            return;
        }

        if (viewMode === 'rail-only' && isInProject) {
            // Only show file name as a single entry
            const sceneEl = contentEl.createDiv({ cls: 'pem-toc-scene-entry' });
            sceneEl.createSpan({ text: fileName, cls: 'pem-toc-scene-title' });

            // Keyboard navigation focus
            sceneEl.setAttribute('tabindex', '0');

            // Highlight if active
            const isActiveFile = activeView?.file?.path === group.filePath;
            if (isActiveFile) {
                sceneEl.addClass('is-selected');
            }

            // Single click selects the scene
            sceneEl.addEventListener('click', (e) => {
                e.stopPropagation();
                container.querySelectorAll('.pem-toc-scene-entry').forEach(el => el.removeClass('is-selected'));
                sceneEl.addClass('is-selected');
                sceneEl.focus();
            });

            // Double click opens the scene
            sceneEl.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                const file = this.plugin.app.vault.getAbstractFileByPath(group.filePath);
                if (file instanceof TFile) {
                    const leaf = this.plugin.app.workspace.getLeaf(false);
                    leaf.openFile(file);
                }
            });

            // Keyboard Tab / Shift+Tab support for indent/dedent
            sceneEl.addEventListener('keydown', async (e) => {
                if (e.key === 'Tab') {
                    e.preventDefault();
                    if (projectPath) {
                        const delta = e.shiftKey ? -1 : +1;
                        await pm.changeSceneLevel(projectPath, group.filePath, delta);
                        this.onUpdate(activeView);

                        // Keep focus on the newly rendered scene row
                        setTimeout(() => {
                            const newEl = container.querySelector(`[data-path="${group.filePath}"] .pem-toc-scene-entry`) as HTMLElement;
                            newEl?.focus();
                        }, 50);
                    }
                }
            });
            return;
        }

        for (const item of group.sections) {
            const { section, originalIndex } = item;
            const hasChildren = originalIndex < allSections.length - 1 && allSections[originalIndex + 1].level > section.level;
            this.renderTocEntry(contentEl, section, activeView, currentViewPath, hasChildren);
        }

    }

    private showSceneContextMenu(e: MouseEvent, filePath: string, projectPath?: string): void {
        e.preventDefault();
        if (!projectPath) return;

        const pm = LongformProjectManager.getInstance();
        const menu = new Menu();

        menu.addItem((item) => {
            item.setTitle('Add Scene Above')
                .setIcon('arrow-up')
                .onClick(async () => {
                    await pm.addNewFileToProject(projectPath, filePath, 'before');
                    this.onUpdate(this.plugin.app.workspace.getActiveViewOfType(MarkdownView));
                });
        });

        menu.addItem((item) => {
            item.setTitle('Add Scene Below')
                .setIcon('arrow-down')
                .onClick(async () => {
                    await pm.addNewFileToProject(projectPath, filePath, 'after');
                    this.onUpdate(this.plugin.app.workspace.getActiveViewOfType(MarkdownView));
                });
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle('Rename Scene')
                .setIcon('pencil')
                .onClick(() => { this.showRenameModal(filePath, projectPath); });
        });

        menu.addItem((item) => {
            item.setTitle('Indent →')
                .setIcon('indent')
                .onClick(async () => {
                    await pm.changeSceneLevel(projectPath, filePath, +1);
                    this.onUpdate(this.plugin.app.workspace.getActiveViewOfType(MarkdownView));
                });
        });

        menu.addItem((item) => {
            item.setTitle('Dedent ←')
                .setIcon('outdent')
                .onClick(async () => {
                    await pm.changeSceneLevel(projectPath, filePath, -1);
                    this.onUpdate(this.plugin.app.workspace.getActiveViewOfType(MarkdownView));
                });
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle('Remove from Project')
                .setIcon('minus-square')
                .onClick(async () => {
                    await pm.removeFileFromProject(projectPath, filePath);
                    new Notice(`Removed ${filePath.split('/').pop()} from project index.`);
                    this.onUpdate(this.plugin.app.workspace.getActiveViewOfType(MarkdownView));
                });
        });

        menu.addItem((item) => {
            item.setTitle('Delete Scene File')
                .setIcon('trash')
                .setWarning(true)
                .onClick(async () => {
                    if (confirm(`Are you sure you want to delete ${filePath}? This will permanently remove the file.`)) {
                        await pm.deleteFileFromProject(projectPath, filePath);
                        this.onUpdate(this.plugin.app.workspace.getActiveViewOfType(MarkdownView));
                    }
                });
        });

        menu.showAtMouseEvent(e);
    }

    private showRenameModal(filePath: string, projectPath: string): void {
        const pm = LongformProjectManager.getInstance();
        const currentName = filePath.split('/').pop()?.replace(/\.md$/, '') ?? '';

        class RenameModal extends Modal {
            private newName: string = currentName;
            constructor(app: any, private onConfirm: (name: string) => void) {
                super(app);
            }
            onOpen() {
                this.titleEl.setText('Rename Scene');
                new Setting(this.contentEl)
                    .setName('New scene name')
                    .addText(text => {
                        text.setValue(this.newName).onChange(v => { this.newName = v; });
                        text.inputEl.focus();
                        text.inputEl.select();
                        text.inputEl.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter') { this.close(); this.onConfirm(this.newName); }
                        });
                    });
                new Setting(this.contentEl)
                    .addButton(btn => btn.setButtonText('Rename').setCta().onClick(() => { this.close(); this.onConfirm(this.newName); }))
                    .addButton(btn => btn.setButtonText('Cancel').onClick(() => this.close()));
            }
            onClose() { this.contentEl.empty(); }
        }

        new RenameModal(this.plugin.app, async (newName) => {
            if (!newName || newName === currentName) return;
            await pm.renameScene(projectPath, filePath, newName);
            new Notice(`Scene renamed to "${newName}"`);
            this.onUpdate(this.plugin.app.workspace.getActiveViewOfType(MarkdownView));
        }).open();
    }

    private renderTocEntry(
        container: HTMLElement,
        section: SectionEntry,
        activeView: MarkdownView | null,
        currentFilePath?: string,
        hasChildren: boolean = false
    ): void {
        const entryKey = `${section.filePath || currentFilePath}:${section.lineNumber}`;
        const entryEl = container.createEl('div', {
            cls: `pem-toc-entry pem-toc-level-${section.level}`
        });
        this.entryElements.set(entryKey, entryEl);

        // Indent based on level
        entryEl.style.paddingLeft = `${(section.level - 1) * 16}px`;

        // Collapse toggle
        if (hasChildren) {
            const isCollapsed = this.collapsedHeadings.has(entryKey);
            const toggleEl = entryEl.createSpan({
                cls: `pem-toc-collapse-toggle ${isCollapsed ? 'is-collapsed' : ''}`,
                text: isCollapsed ? '▶' : '▼'
            });
            toggleEl.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isCollapsed) {
                    this.collapsedHeadings.delete(entryKey);
                } else {
                    this.collapsedHeadings.add(entryKey);
                }
                this.onUpdate(activeView);
            });
        } else {
            entryEl.createSpan({ cls: 'pem-toc-collapse-placeholder' });
        }

        const numberEl = entryEl.createEl('span', {
            cls: 'pem-toc-number',
            text: section.number || ''
        });

        const titleEl = entryEl.createEl('span', {
            cls: 'pem-toc-title',
            text: section.title
        });

        // Dim if in different file
        if (section.filePath && section.filePath !== currentFilePath) {
            entryEl.addClass('pem-toc-other-file');
        }

        // Click to navigate
        entryEl.addEventListener('click', () => {
            try {
                if (section.filePath && section.filePath !== currentFilePath) {
                    const targetFile = this.plugin.app.vault.getAbstractFileByPath(section.filePath);
                    if (targetFile) {
                        const leaf = this.plugin.app.workspace.getLeaf(false);
                        leaf.openFile(targetFile as any, { eState: { line: section.lineNumber } });
                        return;
                    }
                }

                if (!activeView?.editor) return;

                const leaves = this.plugin.app.workspace.getLeavesOfType('markdown');
                const targetLeaf = leaves.find((leaf) => leaf.view === activeView);
                if (targetLeaf) {
                    this.plugin.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
                }

                activeView.editor.setCursor({ line: section.lineNumber, ch: 0 });
                activeView.editor.scrollIntoView({
                    from: { line: section.lineNumber, ch: 0 },
                    to: { line: section.lineNumber, ch: 0 }
                }, true);
                highlightLine(activeView, section.lineNumber);
            } catch (error) {
                handleError(error, 'Navigate to section');
            }
        }, { signal: this.abortController?.signal });
    }

    /**
     * Highlights the entry corresponding to the given file and line.
     */
    public setActiveHeading(filePath: string, lineNumber: number): void {
        const entryKey = `${filePath}:${lineNumber}`;

        // Remove existing highlight
        this.containerEl?.querySelectorAll('.pem-toc-active').forEach(el =>
            el.removeClass('pem-toc-active')
        );

        const targetEl = this.entryElements.get(entryKey);
        if (targetEl) {
            targetEl.addClass('pem-toc-active');
            // Scroll into view if needed
            targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
}
