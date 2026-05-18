import { MarkdownView, TFile, setIcon } from 'obsidian';
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

    private sortingOrder: SortingOrder = 'alphabetical';
    private localCitations: CitationEntry[] = [];
    private citationInfoMap: Map<string, CitationData> = new Map();

    protected cleanupModuleData(): void {
        this.localCitations = [];
        this.citationInfoMap.clear();
    }

    protected extractData(content: string): void {
        const pm = LongformProjectManager.getInstance();
        const pinnedProject = pm.getPinnedProjectPath();
        const pinnedFile = pm.getPinnedFilePath();
        const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        const activeFile = activeView?.file?.path;

        if (pinnedFile) {
            if (activeView && activeFile === pinnedFile) {
                this.localCitations = extractCitations(content);
            } else {
                this.localCitations = pm.getFileCitations(pinnedFile);
            }
        } else {
            this.localCitations = extractCitations(content);
        }

        // Sync map with global cache for all citekeys (local + project-wide)
        const citekeys = new Set<string>();
        this.localCitations.forEach(c => citekeys.add(c.citekey));

        const filePath = pinnedFile || activeFile || pinnedProject || '';
        const isInProject = pinnedProject || (filePath ? pm.isFileInProject(filePath) : false);
        if (isInProject) {
            pm.getProjectCitations(filePath).forEach(c => citekeys.add(c.citekey));
        }

        citekeys.forEach(k => {
            const meta = pm.getCitationMetadata(k);
            if (meta) this.citationInfoMap.set(k, meta);
        });

        void this.loadCitationInfo();
    }

    private async loadCitationInfo(): Promise<void> {
        const zoteroAPI = (window as any).zoteroAPI;
        if (!zoteroAPI) return;

        const citekeys = new Set<string>();
        this.localCitations.forEach(c => citekeys.add(c.citekey));

        const pm = LongformProjectManager.getInstance();
        const pinnedProject = pm.getPinnedProjectPath();
        const pinnedFile = pm.getPinnedFilePath();
        const activeFile = this.plugin.app.workspace.getActiveFile()?.path;

        const filePath = pinnedFile || activeFile || pinnedProject || '';
        const isInProject = pinnedProject || (filePath ? pm.isFileInProject(filePath) : false);
        if (isInProject) {
            pm.getProjectCitations(filePath).forEach(c => citekeys.add(c.citekey));
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
            const ids: [number, number][] = Object.values(itemIds).map((id: any) => [id, 1]);
            if (ids.length === 0) {
                // Mark all keysToFetch as notFound if no item IDs could be resolved
                for (const key of keysToFetch) {
                    this.citationInfoMap.set(key, { notFound: true });
                }
                const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView) void this.updateContent(activeView);
                return;
            }
            
            const items = await zoteroAPI.getDocItems(ids);
            
            // Get Zotero Data Dir for attachment resolution
            const zotlit = (this.plugin.app as any).plugins.getPlugin('zotlit');
            const zoteroDataDir = zotlit?.settings?.zoteroDataDir || (require('os').homedir() + '/Zotero');
            const pathUtils = require('path');

            // Build a reverse mapping of itemId -> citekey from the itemIds object
            const itemIdToCitekey = new Map<number, string>();
            for (const [key, id] of Object.entries(itemIds)) {
                itemIdToCitekey.set(id as number, key);
            }

            // Map back by citekey
            const fetchedCitekeys = new Set<string>();
            for (const item of items) {
                if (!item) continue;
                
                const citekey = (item.citekey as string) || itemIdToCitekey.get(item.itemID);
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
        const sortBtn = actionsEl.createDiv({
            cls: 'pem-panel-tab',
            attr: { 'aria-label': this.sortingOrder === 'alphabetical' ? 'Sort by occurrence' : 'Sort alphabetically' }
        });
        setIcon(sortBtn, this.sortingOrder === 'alphabetical' ? 'sort-asc' : 'sort-desc');
        sortBtn.addEventListener('click', () => {
            this.sortingOrder = this.sortingOrder === 'alphabetical' ? 'occurrence' : 'alphabetical';
            if (activeView) void this.updateContent(activeView);
            actionsEl.empty();
            this.renderActions(actionsEl, activeView);
        });
    }

    protected renderContent(activeView: MarkdownView | null): void {
        const pm = LongformProjectManager.getInstance();
        const pinnedProject = pm.getPinnedProjectPath();
        const pinnedFile = pm.getPinnedFilePath();
        const activeFile = activeView?.file?.path;

        const filePath = pinnedFile || activeFile || pinnedProject || '';
        const isInProject = pinnedProject || (filePath ? pm.isFileInProject(filePath) : false);

        let citekeys: string[] = [];

        if (isInProject) {
            citekeys = Array.from(new Set(pm.getProjectCitations(filePath).map(c => c.citekey)));
        } else {
            const targetPath = pinnedFile || activeFile || '';
            let citationsList: CitationEntry[] = [];
            if (activeView && activeFile === targetPath) {
                citationsList = this.localCitations;
            } else if (targetPath) {
                citationsList = pm.getFileCitations(targetPath);
            }
            citekeys = Array.from(new Set(citationsList.map(c => c.citekey)));
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
                const occurrences = isInProject
                    ? pm.getProjectCitations(filePath).filter(c => c.citekey === k)
                    : (activeView && activeFile === (pinnedFile || activeFile)
                        ? this.localCitations.filter(c => c.citekey === k)
                        : pm.getFileCitations(pinnedFile || activeFile || '').filter(c => c.citekey === k));
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
            const occurrences = isInProject
                ? pm.getProjectCitations(filePath).filter(c => c.citekey === citekey)
                : (activeView && activeFile === (pinnedFile || activeFile)
                    ? this.localCitations.filter(c => c.citekey === citekey)
                    : pm.getFileCitations(pinnedFile || activeFile || '').filter(c => c.citekey === citekey));
            
            this.renderCitationItem(container, citekey, occurrences, activeView);
        }
    }

    private renderCitationItem(container: HTMLElement, citekey: string, entries: CitationEntry[], activeView: MarkdownView | null): void {
        const info = this.citationInfoMap.get(citekey);
        const itemEl = container.createEl('div', { cls: 'pem-citation-item pem-compact-inline' });
        
        const mainInfoEl = itemEl.createEl('div', { cls: 'pem-citation-main-info' });
        
        // Inline layout: [Icon] [Citekey]: [Title] ([Year])
        
        // Icon
        const iconEl = mainInfoEl.createSpan({ cls: 'pem-citation-type-icon' });
        this.renderIcon(iconEl, info?.type);

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

    private renderIcon(el: HTMLElement, type?: string): void {
        if (type === 'journalArticle') {
            el.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
  <polyline points="14 2 14 8 20 8"></polyline>
  <line x1="16" y1="13" x2="8" y2="13"></line>
  <line x1="16" y1="17" x2="8" y2="17"></line>
  <polyline points="10 9 9 9 8 9"></polyline>
</svg>`;
        } else if (type === 'book') {
            el.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="rgba(37, 99, 235, 0.12)" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M7 3h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7" fill="none" opacity="0.7"></path>
  <path d="M4 19.5v-13A2.5 2.5 0 0 1 6.5 4H18v15H6.5a2.5 2.5 0 0 0-2.5 2.5Z"></path>
  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H18"></path>
</svg>`;
        } else if (type === 'conferencePaper') {
            el.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="rgba(194, 120, 71, 0.12)" stroke="#c27847" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6 6l12 0l2 4l-16 0z"></path>
  <path d="M10 10l0 10l4 0l0-10"></path>
  <line x1="6" y1="20" x2="18" y2="20"></line>
  <line x1="13" y1="6" x2="15" y2="3" stroke="#4b5563" stroke-width="1.5"></line>
</svg>`;
        } else if (type === 'thesis') {
            el.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 10L12 5l10 5-10 5z" stroke="#4b5563" stroke-width="2" fill="rgba(75, 85, 99, 0.12)"></path>
  <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5" stroke="#4b5563" stroke-width="2" fill="rgba(75, 85, 99, 0.12)"></path>
  <path d="M12 10c0 1-1.5 3-1.5 5v2" stroke="#ea580c" stroke-width="2"></path>
  <circle cx="10.5" cy="17" r="1.5" fill="#ea580c" stroke="#ea580c" stroke-width="1"></circle>
</svg>`;
        } else {
            const iconName = this.getZoteroIcon(type);
            setIcon(el, iconName);
        }
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
            workspace.setActiveLeaf(leaf, { focus: true });
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

    protected renderPinned(pinnedProject: string | null, pinnedFile: string | null): void {
        const pm = LongformProjectManager.getInstance();
        const filePath = pinnedFile || pinnedProject || '';
        const isInProject = pinnedProject || (filePath ? pm.isFileInProject(filePath) : false);

        if (isInProject) {
            this.localCitations = pm.getProjectCitations(filePath);
        } else if (pinnedFile) {
            this.localCitations = pm.getFileCitations(pinnedFile);
        } else {
            this.localCitations = [];
        }

        const citekeys = new Set<string>();
        this.localCitations.forEach(c => citekeys.add(c.citekey));
        citekeys.forEach(k => {
            const meta = pm.getCitationMetadata(k);
            if (meta) this.citationInfoMap.set(k, meta);
        });

        void this.loadCitationInfo();
        this.renderContent(null);
    }
}
