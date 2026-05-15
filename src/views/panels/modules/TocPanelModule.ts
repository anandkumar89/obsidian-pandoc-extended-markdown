import { MarkdownView } from 'obsidian';
import { BasePanelModule } from './BasePanelModule';
import { MESSAGES } from '../../../core/constants';
import { SectionEntry } from '../../../shared/extractors/sectionExtractor';
import { extractSections, numberSections } from '../../../shared/extractors/sectionExtractor';
import { LongformProjectManager } from '../../../core/state/longformProjectManager';
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

    protected renderContent(activeView: MarkdownView | null): void {
        if (!this.containerEl) return;
        const pm = LongformProjectManager.getInstance();
        const pinnedPath = pm.getPinnedProjectPath();
        const filePath = activeView?.file?.path || pinnedPath || '';
        const isInProject = pinnedPath || (filePath ? pm.isFileInProject(filePath) : false);

        let sections: SectionEntry[];

        if (isInProject && filePath) {
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

        let lastFilePath: string | null = null;
        for (const item of visibleSections) {
            const { section, originalIndex } = item;

            // Handle file breaks (only if in a project and enabled in settings)
            if (this.plugin.settings.showTOCFileBreaks && isInProject && section.filePath && section.filePath !== lastFilePath) {
                if (lastFilePath !== null) {
                    this.renderFileBreak(tocContainer, lastFilePath, filePath || '');
                }
                lastFilePath = section.filePath;
            }

            // Check if it has children to show collapse toggle
            const hasChildren = originalIndex < sections.length - 1 && sections[originalIndex + 1].level > section.level;
            
            this.renderTocEntry(tocContainer, section, activeView, filePath, hasChildren);
        }
    }

    private renderFileBreak(container: HTMLElement, prevFilePath: string, currentViewPath: string): void {
        const pm = LongformProjectManager.getInstance();
        const projectPath = pm.getProjectPath(prevFilePath);
        if (!projectPath) return;

        const breakEl = container.createDiv({ cls: 'pem-toc-file-break' });
        const addBtn = breakEl.createDiv({ 
            cls: 'pem-toc-file-add-btn',
            attr: { 'aria-label': 'Add new file here' }
        });
        addBtn.createSpan({ text: '⊕ Add File' });
        
        addBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await pm.addNewFileToProject(projectPath, prevFilePath);
        });
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
