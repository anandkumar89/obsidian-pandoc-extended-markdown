import { ItemView, WorkspaceLeaf, MarkdownView, TFile } from 'obsidian';
import { CitationEntry } from '../../shared/extractors/citationExtractor';

export const VIEW_TYPE_CITATION_DETAIL = 'pem-citation-detail-view';

export interface CitationDetailData {
    citekey: string;
    info?: any;
    entries: CitationEntry[];
    activeView: MarkdownView;
}

export class CitationDetailView extends ItemView {
    private data: CitationDetailData | null = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE_CITATION_DETAIL;
    }

    getDisplayText(): string {
        return this.data ? `Citation: ${this.data.citekey}` : 'Citation Detail';
    }

    getIcon(): string {
        return 'quote-glyph';
    }

    async updateData(data: CitationDetailData) {
        this.data = data;
        await this.onOpen();
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('pem-citation-detail-sidebar');

        if (!this.data) {
            container.createEl('div', { text: 'Select a citation to view details', cls: 'pem-no-data' });
            return;
        }

        const { citekey, info, entries, activeView } = this.data;

        // Header
        const header = container.createEl('div', { cls: 'pem-popup-header' });
        header.createEl('div', { text: citekey, cls: 'pem-popup-citekey' });

        // Zotero Icon Button in Header (Right side)
        if (info && info.itemId) {
            const zoteroIconBtn = header.createEl('button', {
                cls: 'pem-zotero-icon-btn',
                attr: { 'aria-label': 'Open in Zotero' }
            });
            const { setIcon } = require('obsidian');
            setIcon(zoteroIconBtn, 'external-link');
            zoteroIconBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openInZotero(info.itemId);
            });
        }

        if (info) {
            if (info.title) container.createEl('div', { text: info.title, cls: 'pem-popup-title' });
            if (info.creators) container.createEl('div', { text: info.creators, cls: 'pem-popup-creators' });

            const meta = container.createEl('div', { cls: 'pem-popup-meta' });
            if (info.type) {
                const typeText = info.type.replace(/([A-Z])/g, ' $1').replace(/^./, (str: string) => str.toUpperCase());
                meta.createEl('span', { text: typeText, cls: 'pem-popup-type' });
            }
            if (info.journal) meta.createEl('span', { text: ` • ${info.journal}`, cls: 'pem-popup-journal' });
            if (info.year) meta.createEl('span', { text: ` (${info.year})`, cls: 'pem-popup-year' });

            if (info.abstract) {
                container.createEl('div', { text: 'Abstract', cls: 'pem-popup-section-title' });
                const abstractContainer = container.createEl('div', { cls: 'pem-abstract-collapsible' });
                const abstractEl = abstractContainer.createEl('div', { text: info.abstract, cls: 'pem-popup-abstract is-collapsed' });

                const toggleBtn = abstractContainer.createEl('button', { text: 'Show More', cls: 'pem-abstract-toggle' });
                toggleBtn.addEventListener('click', () => {
                    const isCollapsed = abstractEl.classList.contains('is-collapsed');
                    if (isCollapsed) {
                        abstractEl.classList.remove('is-collapsed');
                        toggleBtn.innerText = 'Show Less';
                    } else {
                        abstractEl.classList.add('is-collapsed');
                        toggleBtn.innerText = 'Show More';
                    }
                });
            }

            if (info.attachments && info.attachments.length > 0) {
                container.createEl('div', { text: 'Attachments', cls: 'pem-popup-section-title' });
                const attachList = container.createEl('div', { cls: 'pem-popup-attachments' });
                info.attachments.forEach((a: any) => {
                    const cleanPath = a.path?.replace('storage:', '') || '';
                    const aEl = attachList.createEl('div', { text: `📄 ${a.name}`, cls: 'pem-popup-attachment', attr: { title: cleanPath } });
                    aEl.addEventListener('click', async () => {
                        if (cleanPath) {
                            // Check if file is within vault
                            const vault = this.app.vault;
                            const adapter = vault.adapter as any;
                            const basePath = adapter.getBasePath ? adapter.getBasePath() : '';

                            if (basePath && cleanPath.startsWith(basePath)) {
                                const relativePath = cleanPath.substring(basePath.length).replace(/^[\\\/]/, '');
                                const file = vault.getAbstractFileByPath(relativePath);
                                if (file instanceof TFile) {
                                    this.app.workspace.getLeaf('tab').openFile(file);
                                    return;
                                }
                            }

                            // Fallback to system opener
                            const { shell } = require('electron');
                            if (shell) {
                                shell.openPath(cleanPath);
                            } else {
                                window.open('file://' + cleanPath);
                            }
                        }
                    });
                });
            }
        }

        // Occurrences list
        container.createEl('div', { text: 'Occurrences', cls: 'pem-popup-section-title' });
        const occurrencesEl = container.createEl('div', { cls: 'pem-popup-occurrences' });
        for (const entry of entries) {
            const occEl = occurrencesEl.createEl('div', { cls: 'pem-popup-occurrence' });
            const fileName = entry.filePath ? entry.filePath.split('/').pop()?.replace('.md', '') : 'Current';
            occEl.createEl('span', { text: `${fileName}:L${entry.lineNumber + 1}`, cls: 'pem-popup-location' });
            occEl.createEl('span', { text: entry.context || entry.fullText, cls: 'pem-popup-context' });

            occEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.jumpToCitation(entry, activeView);
            });
        }
    }

    private async openInZotero(itemId: number): Promise<void> {
        // Try Zotero protocol link first if we can get the item key
        // For now, fall back to zotlit annotation view
        const { workspace } = this.app;
        const leaf = workspace.getLeavesOfType('zotero-annotation-view')[0] || workspace.getLeaf(true);
        await leaf.setViewState({
            type: 'zotero-annotation-view',
            active: true,
            state: { itemId }
        });
    }

    private jumpToCitation(entry: CitationEntry, activeView: MarkdownView): void {
        // Logic from CitationPanelModule
        if (entry.filePath && entry.filePath !== activeView?.file?.path) {
            const targetFile = this.app.vault.getAbstractFileByPath(entry.filePath);
            if (targetFile) {
                const leaf = this.app.workspace.getLeaf(false);
                void leaf.openFile(targetFile as any, { eState: { line: entry.lineNumber } });
                return;
            }
        }

        if (!activeView?.editor) return;
        activeView.editor.setCursor({ line: entry.lineNumber, ch: 0 });
        activeView.editor.scrollIntoView({ from: { line: entry.lineNumber, ch: 0 }, to: { line: entry.lineNumber, ch: 0 } }, true);
    }
}
