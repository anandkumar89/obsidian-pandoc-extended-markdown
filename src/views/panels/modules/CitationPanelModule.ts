import { MarkdownView, TFile } from 'obsidian';
import { BasePanelModule } from './BasePanelModule';
import { CSS_CLASSES, MESSAGES } from '../../../core/constants';
import { CitationEntry, extractCitations } from '../../../shared/extractors/citationExtractor';
import { handleError } from '../../../shared/utils/errorHandler';
import { LongformProjectManager } from '../../../core/state/longformProjectManager';
import { CitationDetailView, VIEW_TYPE_CITATION_DETAIL } from '../CitationDetailView';

interface CitationData {
    title?: string;
    journal?: string;
    year?: string;
    abstract?: string;
    creators?: string;
    itemId?: number;
    type?: string; // Zotero item type
    notFound?: boolean; // True if citekey not in Zotero
    attachments?: { path: string, name: string }[];
}

type SortingOrder = 'alphabetical' | 'occurrence';

export class CitationPanelModule extends BasePanelModule {
    id = 'citations';
    displayName = 'Citations';
    icon = 'quote';

    private showProjectCitations = false;
    private sortingOrder: SortingOrder = 'alphabetical';
    private localCitations: CitationEntry[] = [];
    private citationInfoMap: Map<string, CitationData> = new Map();

    protected cleanupModuleData(): void {
        this.localCitations = [];
        this.citationInfoMap.clear();
    }

    protected extractData(content: string): void {
        this.localCitations = extractCitations(content);
        const pm = LongformProjectManager.getInstance();
        
        // Sync map with global cache
        this.localCitations.forEach(c => {
            const meta = pm.getCitationMetadata(c.citekey);
            if (meta) this.citationInfoMap.set(c.citekey, meta);
        });
        
        void this.loadCitationInfo();
    }

    private async loadCitationInfo(): Promise<void> {
        const zoteroAPI = (window as any).zoteroAPI;
        if (!zoteroAPI) return;

        const citekeys = new Set<string>();
        this.localCitations.forEach(c => citekeys.add(c.citekey));
        
        const pm = LongformProjectManager.getInstance();
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile && pm.isFileInProject(activeFile.path)) {
            pm.getAllCitationCitekeys().forEach(k => citekeys.add(k));
        }


        const keysToFetch = Array.from(citekeys).filter(k => {
            if (this.citationInfoMap.has(k)) return false;
            const cached = pm.getCitationMetadata(k);
            if (cached) {
                this.citationInfoMap.set(k, cached);
                return false;
            }
            return true;
        });

        if (keysToFetch.length === 0) return;

        try {
            const itemIds = await zoteroAPI.getItemIDsFromCitekey(keysToFetch);
            
            // Fetch detailed info
            // IDLibID is [number, number] (itemID, libraryID). 
            // We'll default to library 1 for now as getItemIDsFromCitekey doesn't provide it.
            const ids: [number, number][] = Object.values(itemIds).map(id => [id, 1]);
            if (ids.length === 0) return;
            
            const items = await zoteroAPI.getDocItems(ids);
            
            // Get Zotero Data Dir for attachment resolution
            const zotlit = (this.plugin.app as any).plugins.getPlugin('zotlit');
            const zoteroDataDir = zotlit?.settings?.zoteroDataDir || (require('os').homedir() + '/Zotero');
            const pathUtils = require('path');

            // Map back by citekey
            const fetchedCitekeys = new Set<string>();
            for (const item of items) {
                if (!item) continue;
                
                const citekey = item.citekey as string;
                if (!citekey) continue;
                fetchedCitekeys.add(citekey);
                
                const creators = item.creators 
                    ? (item.creators as any[]).map((c: any) => c.lastName || c.name || [c.firstName, c.lastName].filter(Boolean).join(' ')).join(', ')
                    : '';

                const abstract = Array.isArray(item.abstractNote) ? item.abstractNote[0] : item.abstractNote;

                const data: CitationData = {
                    title: item.title as string,
                    journal: (item.publicationTitle || item.proceedingsTitle || item.university) as string,
                    year: item.date ? (typeof item.date === 'string' ? item.date.split('-')[0] : '') : undefined,
                    abstract: abstract as string,
                    creators,
                    itemId: item.itemID as number,
                    type: item.itemType as string
                };

                // Fetch attachments
                if (data.itemId && (item as any).libraryID !== undefined) {
                    try {
                        const attachments = await zoteroAPI.getAttachments(data.itemId, (item as any).libraryID);
                        if (attachments && Array.isArray(attachments)) {
                            const linkedBaseDir = zotlit?.settings?.linkedAttachmentBaseDir;
                            data.attachments = attachments.map((a: any) => {
                                let filename = a.path || '';
                                if (filename.startsWith('storage:')) {
                                    filename = filename.replace('storage:', '');
                                }
                                
                                let fullPath = filename;
                                // linkMode 0 is "Imported file" (stored in Zotero)
                                if (a.linkMode === 0 && a.key) {
                                    fullPath = pathUtils.join(zoteroDataDir, 'storage', a.key, filename);
                                } else if (a.linkMode === 1 && a.path?.startsWith('attachments:')) {
                                    const relPath = a.path.replace('attachments:', '');
                                    if (linkedBaseDir) {
                                        fullPath = pathUtils.join(linkedBaseDir, relPath);
                                    }
                                }
                                return {
                                    path: fullPath,
                                    name: filename || 'Attachment'
                                };
                            });
                        }
                    } catch (err) {
                        console.warn(`[PandocExtendedMarkdown] Failed to fetch attachments for ${citekey}:`, err);
                    }
                }

                this.citationInfoMap.set(citekey, data);
                pm.setCitationMetadata(citekey, data);
            }

            // Mark missing citekeys
            for (const key of keysToFetch) {
                if (!fetchedCitekeys.has(key)) {
                    this.citationInfoMap.set(key, { notFound: true });
                }
            }
            
            // Re-render if we got new data
            const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) void this.updateContent(activeView);
        } catch (e) {
            console.error('[PandocExtendedMarkdown] Failed to fetch citation info:', e);
        }
    }

    renderActions(actionsEl: HTMLElement, activeView: MarkdownView | null): void {
        const filePath = activeView?.file?.path;
        const pm = LongformProjectManager.getInstance();
        const isInProject = filePath ? pm.isFileInProject(filePath) : false;

        if (!isInProject) return;

        const projectBtn = actionsEl.createEl('button', {
            cls: `pem-toggle-btn ${this.showProjectCitations ? 'is-active' : ''}`,
            attr: { 'aria-label': 'Show all project citations' }
        });
        projectBtn.createSpan({ text: '📁', cls: 'pem-toggle-icon' });
        projectBtn.addEventListener('click', () => {
            this.showProjectCitations = !this.showProjectCitations;
            if (activeView) void this.updateContent(activeView);
            actionsEl.empty();
            this.renderActions(actionsEl, activeView);
        });

        const sortBtn = actionsEl.createEl('button', {
            cls: 'pem-toggle-btn',
            attr: { 'aria-label': this.sortingOrder === 'alphabetical' ? 'Sort by occurrence' : 'Sort alphabetically' }
        });
        sortBtn.createSpan({ text: this.sortingOrder === 'alphabetical' ? 'AZ' : '123', cls: 'pem-toggle-icon' });
        sortBtn.addEventListener('click', () => {
            this.sortingOrder = this.sortingOrder === 'alphabetical' ? 'occurrence' : 'alphabetical';
            if (activeView) void this.updateContent(activeView);
            actionsEl.empty();
            this.renderActions(actionsEl, activeView);
        });

        const refreshBtn = actionsEl.createEl('button', {
            cls: 'pem-toggle-btn',
            attr: { 'aria-label': 'Refresh citation info' }
        });
        refreshBtn.createSpan({ text: '↻', cls: 'pem-toggle-icon' });
        refreshBtn.addEventListener('click', () => {
            this.citationInfoMap.clear();
            void this.loadCitationInfo();
        });
    }

    protected renderContent(activeView: MarkdownView | null): void {
        const filePath = activeView?.file?.path;
        const pm = LongformProjectManager.getInstance();
        const pinnedPath = pm.getPinnedProjectPath();
        const isInProject = pinnedPath || (filePath ? pm.isFileInProject(filePath) : false);

        let citekeys: string[] = [];
        if (isInProject && (this.showProjectCitations || !filePath)) {
            citekeys = pm.getAllCitationCitekeys();
        } else {
            citekeys = Array.from(new Set(this.localCitations.map(c => c.citekey)));
        }

        // Apply search filter
        if (this.searchQuery) {
            citekeys = citekeys.filter(k => 
                k.toLowerCase().includes(this.searchQuery) ||
                this.citationInfoMap.get(k)?.title?.toLowerCase().includes(this.searchQuery)
            );
        }

        // Apply sorting
        if (this.sortingOrder === 'alphabetical') {
            citekeys.sort((a, b) => a.localeCompare(b));
        } else {
            // Sort by first occurrence
            const firstOcc = new Map<string, number>();
            citekeys.forEach(k => {
                const occurrences = isInProject && (this.showProjectCitations || !filePath)
                    ? pm.getCitationOccurrences(k)
                    : this.localCitations.filter(c => c.citekey === k);
                if (occurrences.length > 0) {
                    firstOcc.set(k, occurrences[0].lineNumber);
                } else {
                    firstOcc.set(k, Infinity);
                }
            });
            citekeys.sort((a, b) => (firstOcc.get(a) || 0) - (firstOcc.get(b) || 0));
        }

        if (citekeys.length === 0) {
            this.containerEl?.createEl('div', {
                text: this.searchQuery ? 'No matching citations found' : MESSAGES.NO_CITATIONS,
                cls: CSS_CLASSES.FENCED_DIV_PANEL_EMPTY
            });
            return;
        }

        const container = this.containerEl?.createEl('div', { cls: 'pem-citation-panel-container' });
        if (!container) return;

        for (const citekey of citekeys) {
            const occurrences = isInProject && (this.showProjectCitations || !filePath)
                ? pm.getCitationOccurrences(citekey)
                : this.localCitations.filter(c => c.citekey === citekey);
            
            this.renderCitationItem(container, citekey, occurrences, activeView);
        }
    }

    private renderCitationItem(container: HTMLElement, citekey: string, entries: CitationEntry[], activeView: MarkdownView | null): void {
        const info = this.citationInfoMap.get(citekey);
        const itemEl = container.createEl('div', { cls: 'pem-citation-item pem-compact-inline' });
        
        const mainInfoEl = itemEl.createEl('div', { cls: 'pem-citation-main-info' });
        
        // Inline layout: [Icon] [Citekey]: [Title] ([Year])
        
        // Icon
        const iconName = this.getZoteroIcon(info?.type);
        const iconEl = mainInfoEl.createSpan({ cls: 'pem-citation-type-icon' });
        this.renderIcon(iconEl, iconName);

        const textEl = mainInfoEl.createSpan({ cls: 'pem-citation-text' });
        textEl.createSpan({ text: citekey, cls: 'pem-citation-citekey' });

        if (info) {
            if (info.notFound) {
                textEl.createSpan({ text: ': Paper not in Zotero library', cls: 'pem-citation-not-found' });
            } else {
                if (info.title) {
                    textEl.createSpan({ text: `: ${info.title}`, cls: 'pem-citation-title' });
                }
                if (info.year) {
                    textEl.createSpan({ text: ` (${info.year})`, cls: 'pem-citation-year' });
                }
            }
        }

        // Main click: open details in other sidebar
        itemEl.addEventListener('click', (e) => {
            e.stopPropagation();
            void this.activateCitationDetailView(citekey, entries, activeView);
        });
    }

    private renderIcon(el: HTMLElement, iconName: string): void {
        const { setIcon } = require('obsidian');
        setIcon(el, iconName);
    }

    private getZoteroIcon(type?: string): string {
        if (!type) return 'quote';
        switch (type) {
            case 'journalArticle': return 'file-text';
            case 'book': return 'book';
            case 'conferencePaper': return 'presentation';
            case 'thesis': return 'graduation-cap';
            case 'encyclopediaArticle': return 'book-open';
            case 'webpage': return 'globe';
            case 'report': return 'clipboard-list';
            case 'attachment': return 'paperclip';
            default: return 'quote';
        }
    }

    private async activateCitationDetailView(citekey: string, entries: CitationEntry[], activeView: MarkdownView): Promise<void> {
        const { workspace } = this.plugin.app;
        
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_CITATION_DETAIL)[0];
        if (!leaf) {
            // Find opposite sidebar
            const currentLeaf = workspace.getMostRecentLeaf();
            const isLeft = currentLeaf?.getRoot() === workspace.leftSplit;
            leaf = isLeft ? workspace.getRightLeaf(false) : workspace.getLeftLeaf(false);
            
            await leaf.setViewState({ type: VIEW_TYPE_CITATION_DETAIL, active: true });
        }

        if (leaf.view instanceof CitationDetailView) {
            await leaf.view.updateData({
                citekey,
                info: this.citationInfoMap.get(citekey),
                entries,
                activeView
            });
            workspace.revealLeaf(leaf);
        }
    }

    private async openZotLitAnnotation(itemId: number): Promise<void> {
        const { workspace } = this.plugin.app;
        const leaf = workspace.getLeavesOfType('zotero-annotation-view')[0] || workspace.getLeaf(true);
        await leaf.setViewState({
            type: 'zotero-annotation-view',
            active: true,
            state: { itemId }
        });
    }

    private jumpToCitation(entry: CitationEntry, activeView: MarkdownView): void {
        try {
            if (entry.filePath && entry.filePath !== activeView?.file?.path) {
                const targetFile = this.plugin.app.vault.getAbstractFileByPath(entry.filePath);
                if (targetFile instanceof TFile) {
                    const leaf = this.plugin.app.workspace.getLeaf(false);
                    void leaf.openFile(targetFile, { eState: { line: entry.lineNumber } });
                    return;
                }
            }

            if (!activeView?.editor) return;
            activeView.editor.setCursor({ line: entry.lineNumber, ch: 0 });
            activeView.editor.scrollIntoView({ from: { line: entry.lineNumber, ch: 0 }, to: { line: entry.lineNumber, ch: 0 } }, true);
            highlightLine(activeView, entry.lineNumber);
        } catch (error) {
            handleError(error, 'Jump to citation');
        }
    }
}
