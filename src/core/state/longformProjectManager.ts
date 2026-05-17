import { App, TFile, TFolder, parseYaml, normalizePath } from 'obsidian';
import { FencedDivReference } from '../../shared/types/fencedDivTypes';
import { extractFencedDivs } from '../../shared/extractors/fencedDivExtractor';
import { extractEquations, EquationPanelItem } from '../../shared/extractors/equationExtractor';
import { extractSections, numberSections, SectionEntry } from '../../shared/extractors/sectionExtractor';
import { extractFigures, numberFigures, FigureEntry } from '../../shared/extractors/figureExtractor';
import { extractCitations, CitationEntry } from '../../shared/extractors/citationExtractor';
import { PandocExtendedMarkdownSettings } from '../settings';

import type { PandocExtendedMarkdownPlugin } from '../main';

export interface FencedDivProjectEntry extends FencedDivReference {
    filePath: string;
    projectIndex: number; // sequential number within its class across project
    displayTitle: string; // e.g., "Theorem 1" or "Theorem 1 (Title)"
    mtime?: number;
}

export interface SceneEntry {
    path: string;
    level: number;
    isFile: boolean;
}

export interface UnifiedReference {
    label: string;
    displayName: string;
    previewText: string;
    lineNumber: number;
    filePath: string;
    type: 'div' | 'equation' | 'figure';
}

export class LongformProjectManager {
    private plugin: PandocExtendedMarkdownPlugin;
    private app: App;
    private settings: PandocExtendedMarkdownSettings;

    // Maps a directory path to its Longform project scene list (ordered file paths with levels)
    private projectScenes: Map<string, SceneEntry[]> = new Map();

    // Maps a filePath to the directory path of its project
    private fileToProject: Map<string, string> = new Map();

    // Caches Fenced Divs by filePath
    // Caches Fenced Divs by filePath
    private fileDivCache: Map<string, FencedDivProjectEntry[]> = new Map();
    private fileEquationCache: Map<string, EquationPanelItem[]> = new Map();
    private fileSectionCache: Map<string, SectionEntry[]> = new Map();
    private fileFigureCache: Map<string, FigureEntry[]> = new Map();
    private fileCitationCache: Map<string, CitationEntry[]> = new Map();
    private scannedProjects: Set<string> = new Set();
    private saveTimeout: Map<string, any> = new Map();
    private scanningProjects: Set<string> = new Set();
    private lastScanTime: Map<string, number> = new Map();
    private projectIndexMtime: Map<string, number> = new Map();
    private foldersChecked: Set<string> = new Set();
    private nonProjectFolders: Set<string> = new Set();

    // Global maps
    private labelIndices: Map<string, Map<string, FencedDivProjectEntry>> = new Map();
    private equationIndices: Map<string, Map<string, EquationPanelItem>> = new Map();
    private figureIndices: Map<string, Map<string, FigureEntry>> = new Map();
    private vaultFilePaths: Set<string> = new Set();
    private globalCitationIndex: Map<string, CitationEntry[]> = new Map();
    private citationMetadataCache: Map<string, any> = new Map();
    private cacheFilePath: string;

    private static instance: LongformProjectManager;

    private constructor(plugin: PandocExtendedMarkdownPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.settings = plugin.settings;
        const configDir = this.app?.vault ? this.app.vault.configDir : '.obsidian';
        this.cacheFilePath = normalizePath((configDir || '.obsidian') + '/plugins/academic-pandoc-markdown/citekey-cache.json');
        this.vaultCachePath = normalizePath((configDir || '.obsidian') + '/plugins/academic-pandoc-markdown/vault-index.json');
    }

    public static getInstance(plugin?: PandocExtendedMarkdownPlugin): LongformProjectManager {
        if (!LongformProjectManager.instance) {
            if (plugin) {
                LongformProjectManager.instance = new LongformProjectManager(plugin);
            } else {
                const dummyPlugin = {
                    app: {
                        vault: {
                            configDir: '.obsidian',
                            getAbstractFileByPath: () => null,
                            on: () => {},
                            trigger: () => {}
                        },
                        workspace: {
                            onLayoutReady: () => {},
                            on: () => {}
                        }
                    },
                    settings: {}
                } as any;
                LongformProjectManager.instance = new LongformProjectManager(dummyPlugin);
            }
        }
        return LongformProjectManager.instance;
    }

    public async initialize(): Promise<void> {
        // Load the global citation cache first and await it to prevent race conditions on startup
        await this.loadGlobalCitationCache();

        // Ensure active file is cached on startup and load known projects
        this.app.workspace.onLayoutReady(async () => {
            const paths = this.settings.knownProjectPaths || [];

            // Also include pinned project if not in list
            const allPaths = [...new Set([...paths, this.settings.pinnedProjectPath].filter(Boolean) as string[])];

            for (const path of allPaths) {
                const folder = this.app.vault.getAbstractFileByPath(path);
                if (folder instanceof TFolder) {
                    await this.scanProject(folder);
                }
            }

            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                void this.ensureFileCached(activeFile);
            }
            setTimeout(async () => {
                const loaded = await this.loadVaultCache();
                if (loaded) {
                    this.recalculateVaultNumbering();
                } else {
                    await this.rebuildVaultIndex();
                }
            }, 1000);
        });

        // Listen for metadata changes to catch Index.md updates or scene modifications
        this.app.metadataCache.on('changed', async (file: TFile) => {
            if (file.name.toLowerCase() === 'index.md') {
                if (file.parent instanceof TFolder) {
                    await this.scanProject(file.parent);
                }
            } else {
                // Always update cache for the file to support local heading numbering etc.
                await this.updateFileCache(file);        //??
                if (this.fileToProject.has(file.path)) {
                    this.recalculateNumbering(this.fileToProject.get(file.path)!);
                } else {
                    this.vaultFilePaths.add(file.path);
                    this.recalculateVaultNumbering();
                    this.debouncedVaultSave();
                }
            }
        });

        this.app.vault.on('delete', (file: TFile) => {
            if (this.vaultFilePaths.has(file.path)) {
                this.vaultFilePaths.delete(file.path);
                this.recalculateVaultNumbering();
                this.debouncedVaultSave();
            }
            if (this.fileToProject.has(file.path)) {
                const projectPath = this.fileToProject.get(file.path)!;
                this.fileToProject.delete(file.path);
                this.recalculateNumbering(projectPath);
                this.debouncedSave(projectPath);
            }
            this.fileDivCache.delete(file.path);
            this.fileEquationCache.delete(file.path);
            this.fileCitationCache.delete(file.path);
        });

        this.app.vault.on('create', (file: TFile) => {
            if (file.name.toLowerCase() === 'index.md') {
                if (file.parent instanceof TFolder) {
                    this.nonProjectFolders.delete(file.parent.path);
                    void this.scanProject(file.parent);
                }
            }
        });

        this.app.vault.on('rename', (file: TFile, oldPath: string) => {
            if (this.fileToProject.has(oldPath)) {
                const projectPath = this.fileToProject.get(oldPath)!;
                const cache = this.fileDivCache.get(oldPath);
                if (cache) {
                    cache.forEach(item => item.filePath = file.path);
                    this.fileDivCache.set(file.path, cache);
                }
                const eqCache = this.fileEquationCache.get(oldPath);
                if (eqCache) {
                    eqCache.forEach(item => item.filePath = file.path);
                    this.fileEquationCache.set(file.path, eqCache);
                }
                const citeCache = this.fileCitationCache.get(oldPath);
                if (citeCache) {
                    citeCache.forEach(item => item.filePath = file.path);
                    this.fileCitationCache.set(file.path, citeCache);
                }
                this.fileToProject.set(file.path, projectPath);
                this.fileDivCache.delete(oldPath);
                this.fileEquationCache.delete(oldPath);
                this.fileCitationCache.delete(oldPath);
                this.fileToProject.delete(oldPath);
                this.debouncedSave(projectPath);
            } else if (this.vaultFilePaths.has(oldPath)) {
                this.vaultFilePaths.delete(oldPath);
                this.vaultFilePaths.add(file.path);
                const cache = this.fileDivCache.get(oldPath);
                if (cache) { cache.forEach(item => item.filePath = file.path); this.fileDivCache.set(file.path, cache); }
                const eqCache = this.fileEquationCache.get(oldPath);
                if (eqCache) { eqCache.forEach(item => item.filePath = file.path); this.fileEquationCache.set(file.path, eqCache); }
                const citeCache = this.fileCitationCache.get(oldPath);
                if (citeCache) { citeCache.forEach(item => item.filePath = file.path); this.fileCitationCache.set(file.path, citeCache); }
                this.fileDivCache.delete(oldPath);
                this.fileEquationCache.delete(oldPath);
                this.fileCitationCache.delete(oldPath);
                this.recalculateVaultNumbering();
                this.debouncedVaultSave();
            }

            if (file.name.toLowerCase() === 'index.md') {
                if (file.parent instanceof TFolder) {
                    this.nonProjectFolders.delete(file.parent.path);
                    void this.scanProject(file.parent);
                }
            }
        });
    }


    public isFileInAnyProject(filePath: string): boolean {
        return this.fileToProject.has(filePath);
    }

    public getBucketForFile(filePath: string): string {
        const projectPath = this.fileToProject.get(filePath);
        if (projectPath) return projectPath;
        return 'VAULT';
    }

    public async rebuildVaultIndex(): Promise<void> {
        console.log('[PandocExtendedMarkdown] Rebuilding Vault Index...');
        this.vaultFilePaths.clear();

        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
            if (this.isFileInAnyProject(file.path)) continue;
            this.vaultFilePaths.add(file.path);
            await this.updateFileCache(file, false);
        }

        this.recalculateVaultNumbering();
        console.log('[PandocExtendedMarkdown] Vault Index rebuild complete.');
    }

    private recalculateVaultNumbering(): void {
        const labelIndex = new Map<string, FencedDivProjectEntry>();
        const equationIndex = new Map<string, EquationPanelItem>();
        const figureIndex = new Map<string, FigureEntry>();

        for (const path of this.vaultFilePaths) {
            const entries = this.fileDivCache.get(path) || [];
            const fileFigures = [...(this.fileFigureCache.get(path) || [])];
            const subfiguresMap = new Map<FigureEntry, FencedDivProjectEntry>();

            for (const entry of entries) {
                const primaryClass = entry.classes[0] || 'div';
                const isUnnumbered = this.settings.unnumberedClasses.some(c =>
                    entry.classes.map(cls => cls.toLowerCase()).includes(c.toLowerCase())
                ) || entry.classes.includes('unnumbered');

                if (isUnnumbered) {
                    entry.projectIndex = 0;
                    entry.displayTitle = entry.displayName;
                } else if (primaryClass === 'subfigures') {
                    const subfigures = extractFigures(entry.content || '');
                    subfigures.forEach(sub => { sub.isSubfigure = true; sub.filePath = entry.filePath; });
                    const figEntry: FigureEntry = {
                        label: entry.label || '', description: entry.content || '',
                        title: entry.inlineTitle || 'Figure', imagePath: '',
                        lineNumber: entry.lineNumber, filePath: entry.filePath,
                        mtime: entry.mtime, subfigures: subfigures
                    };
                    fileFigures.push(figEntry);
                    subfiguresMap.set(figEntry, entry);
                } else {
                    entry.projectIndex = 0;
                    if (entry.label) {
                        entry.displayTitle = `${entry.displayName} (${entry.label})`;
                    } else if (entry.inlineTitle) {
                        entry.displayTitle = `${entry.displayName} (${entry.inlineTitle})`;
                    } else {
                        entry.displayTitle = entry.displayName;
                    }
                }

                if (entry.label && primaryClass !== 'subfigures') {
                    labelIndex.set(entry.label, entry);
                }
            }

            fileFigures.sort((a, b) => a.lineNumber - b.lineNumber);

            // Number headings and figures *per-file*
            const sectionEntries = this.fileSectionCache.get(path) || [];
            numberSections(sectionEntries);
            numberFigures(fileFigures);

            for (const fig of fileFigures) {
                const divEntry = subfiguresMap.get(fig);
                if (divEntry) {
                    divEntry.projectIndex = fig.number || 0;
                    divEntry.displayTitle = fig.displayTitle || `Figure ${fig.number}`;
                    divEntry.displayName = 'Figure';
                    if (divEntry.label) labelIndex.set(divEntry.label, divEntry);
                }
                if (fig.label) figureIndex.set(fig.label, fig);
                if (fig.subfigures) {
                    for (const subfig of fig.subfigures) {
                        if (subfig.label) figureIndex.set(subfig.label, subfig);
                    }
                }
            }

            const eqEntries = this.fileEquationCache.get(path) || [];
            for (const eq of eqEntries) {
                equationIndex.set(eq.label, eq);
            }

            const citeEntries = this.fileCitationCache.get(path) || [];
            for (const cite of citeEntries) {
                const existing = this.globalCitationIndex.get(cite.citekey) || [];
                existing.push(cite);
                this.globalCitationIndex.set(cite.citekey, existing);
            }
        }

        this.labelIndices.set('VAULT', labelIndex);
        this.equationIndices.set('VAULT', equationIndex);
        this.figureIndices.set('VAULT', figureIndex);
    }

    public async checkAndLoadProjectForFile(file: TFile): Promise<void> {
        // If already known as a project file, skip detection
        if (this.fileToProject.has(file.path)) return;

        // If parent folder is already known as non-project, skip detection
        if (file.parent && this.nonProjectFolders.has(file.parent.path)) {
            await this.ensureFileCached(file);
            return;
        }

        // If pinned, ensure pinned project is loaded
        if (this.settings.pinnedProjectPath) {
            const pinnedFolder = this.app.vault.getAbstractFileByPath(this.settings.pinnedProjectPath);
            if (pinnedFolder instanceof TFolder) {
                await this.scanProject(pinnedFolder);
            }
        }

        if (this.fileToProject.has(file.path)) return;

        let parent = file.parent;
        const foldersInPath: string[] = [];

        while (parent) {
            if (this.nonProjectFolders.has(parent.path)) break;
            if (this.scannedProjects.has(parent.path)) {
                // If we hit a known project folder while traversing up, this file might be in it
                // but not listed in Index.md. If it's not in fileToProject, it's not a scene.
                break;
            }

            foldersInPath.push(parent.path);
            const indexFile = parent.children.find(c => c instanceof TFile && (c.name.toLowerCase() === 'index.md' || c.name === 'longform.json')) as TFile | undefined;
            if (indexFile) {
                console.log(`[PandocExtendedMarkdown] Found Index.md at ${indexFile.path}, scanning project...`);
                await this.scanProject(parent);
                return;
            }
            parent = parent.parent;
        }

        // If we reached here, no project was found in the hierarchy
        console.log(`[PandocExtendedMarkdown] No Index.md found in parent hierarchy for ${file.path}`);
        foldersInPath.forEach(path => this.nonProjectFolders.add(path));

        // Ensure the file is at least cached locally
        await this.ensureFileCached(file);
    }

    /** Scans the entire vault for Index.md or files with longform frontmatter to discover projects. */
    public async discoverProjects(): Promise<void> {
        console.log('[PandocExtendedMarkdown] Discovering projects in vault...');
        const files = this.app.vault.getMarkdownFiles();
        const projectFolders = new Set<TFolder>();

        for (const file of files) {
            if (file.name.toLowerCase() === 'index.md') {
                if (file.parent instanceof TFolder) {
                    projectFolders.add(file.parent);
                }
            } else {
                // Check frontmatter for longform key
                const cache = this.app.metadataCache.getFileCache(file);
                if (cache?.frontmatter?.longform) {
                    if (file.parent instanceof TFolder) {
                        projectFolders.add(file.parent);
                    }
                }
            }
        }

        for (const folder of projectFolders) {
            await this.scanProject(folder);
        }
        console.log(`[PandocExtendedMarkdown] Discovery complete. Found ${projectFolders.size} projects.`);
    }

    public async ensureFileCached(file: TFile): Promise<void> {
        if (!this.fileSectionCache.has(file.path)) {
            await this.updateFileCache(file, false);
        }
    }

    public async scanProject(folder: TFolder): Promise<void> {
        if (this.scanningProjects.has(folder.path)) return;

        const now = Date.now();
        const lastScan = this.lastScanTime.get(folder.path) || 0;
        if (now - lastScan < 1000) return; // Debounce scans within 1 second

        this.scanningProjects.add(folder.path);
        this.lastScanTime.set(folder.path, now);

        try {
            await this._scanProjectInternal(folder);
        } finally {
            this.scanningProjects.delete(folder.path);
        }
    }

    private async _scanProjectInternal(folder: TFolder): Promise<void> {
        let indexFile = folder.children.find(c => c instanceof TFile && (c.name.toLowerCase() === 'index.md' || c.name === 'longform.json')) as TFile | undefined;

        if (!indexFile) {
            for (const child of folder.children) {
                if (child instanceof TFile && child.extension === 'md') {
                    const cache = this.app.metadataCache.getFileCache(child);
                    if (cache?.frontmatter?.longform) {
                        indexFile = child;
                        break;
                    }
                }
            }
        }

        if (!indexFile) return;

        const cacheLoaded = await this.loadProjectCache(folder);
        const cachedIndexMtime = this.projectIndexMtime.get(folder.path);
        let sceneEntries: SceneEntry[] = this.projectScenes.get(folder.path) || [];
        let structureUpToDate = cacheLoaded && sceneEntries.length > 0 && cachedIndexMtime === indexFile.stat.mtime;

        if (structureUpToDate) {
            console.log(`[PandocExtendedMarkdown] Project structure is up-to-date for ${folder.path}`);
            // Still need to populate fileToProject mapping in memory
            for (const s of sceneEntries) {
                if (s.isFile) this.fileToProject.set(s.path, folder.path);
            }
        } else {
            // 2. Cache is stale or missing, parse Index.md
            let frontmatter: any = null;

            // Try direct read first for most up-to-date nesting
            try {
                const content = await this.app.vault.read(indexFile);
                const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
                if (match) {
                    const yaml = parseYaml(match[1]);
                    if (yaml?.longform) frontmatter = yaml;
                }
            } catch (e) {
                console.error(`[PandocExtendedMarkdown] Error reading Index.md for ${folder.path}:`, e);
            }

            // Fallback to metadata cache if direct read failed or didn't find frontmatter
            if (!frontmatter || !frontmatter.longform) {
                const cache = this.app.metadataCache.getFileCache(indexFile);
                if (cache?.frontmatter?.longform) {
                    frontmatter = cache.frontmatter;
                }
            }

            if (!frontmatter || !frontmatter.longform) {
                console.warn(`[PandocExtendedMarkdown] No longform metadata found in ${indexFile.path}`);
                return;
            }

            const rawScenes = frontmatter.longform.scenes;
            console.log(`[PandocExtendedMarkdown] Raw scenes type: ${typeof rawScenes}, isArray: ${Array.isArray(rawScenes)}`, rawScenes);
            const scenes = this.flattenScenes(rawScenes);
            console.log(`[PandocExtendedMarkdown] Flattened scenes (${scenes.length}):`, scenes);
            this.projectIndexMtime.set(folder.path, indexFile.stat.mtime);

            sceneEntries = [];
            const allFiles = this.getAllFilesUnder(folder);

            for (const scene of scenes) {
                let sceneFile = allFiles.find(f => f.basename === scene.path);
                if (!sceneFile) {
                    const normalizedScene = scene.path.toLowerCase().replace(/\\/g, '/');
                    sceneFile = allFiles.find(f => {
                        const relativePath = f.path.substring(folder.path.length + 1).toLowerCase();
                        return relativePath === normalizedScene || relativePath === normalizedScene + '.md';
                    });
                }

                if (sceneFile) {
                    sceneEntries.push({ path: sceneFile.path, level: scene.level, isFile: true });
                    this.fileToProject.set(sceneFile.path, folder.path);
                } else {
                    sceneEntries.push({ path: scene.path, level: scene.level, isFile: false });
                }
            }
            this.projectScenes.set(folder.path, sceneEntries);
        }

        this.scannedProjects.add(folder.path);

        console.log(`[PandocExtendedMarkdown] Validating ${sceneEntries.length} scenes in ${folder.path}:`, sceneEntries);

        // Scan all scene files for fenced divs
        for (const entry of sceneEntries) {
            const path = entry.path;
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                // Check mtime against multiple caches to be sure
                const cachedSections = this.fileSectionCache.get(path);
                const cachedDivs = this.fileDivCache.get(path);
                const mtime = cachedSections?.[0]?.mtime || (cachedDivs?.[0] as any)?.mtime;

                if (mtime === file.stat.mtime) {
                    continue;
                }
                await this.updateFileCache(file, false);
            }
        }

        this.recalculateNumbering(folder.path);
        this.trackRecent(folder.path, true);
        console.log(`[PandocExtendedMarkdown] Project scan complete. Global labels: ${this.globalLabelIndex.size}, Equations: ${this.globalEquationIndex.size}`);
    }

    private async updateFileCache(file: TFile, recalculate: boolean = true): Promise<void> {
        const content = await this.app.vault.cachedRead(file);
        const extracted = extractFencedDivs(content, this.settings);
        const extractedEquations = extractEquations(content);
        const extractedSections = extractSections(content);
        const extractedFigures = extractFigures(content);
        const extractedCitations = extractCitations(content);

        const entries: FencedDivProjectEntry[] = extracted.map(e => ({
            label: e.label,
            displayName: e.classes[0] ? e.classes[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) : 'Div',
            lineNumber: e.lineNumber,
            classes: e.classes,
            content: e.content,
            inlineTitle: e.inlineTitle,
            filePath: file.path,
            projectIndex: 0,
            displayTitle: e.title || (e.classes[0] ? e.classes[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) : 'Div'),
            mtime: file.stat.mtime
        }));

        const eqEntries: EquationPanelItem[] = extractedEquations.map(e => ({
            ...e,
            filePath: file.path,
            mtime: file.stat.mtime
        }));

        const sectionEntries: SectionEntry[] = extractedSections.map(s => ({
            ...s,
            filePath: file.path,
            mtime: file.stat.mtime
        }));

        const figureEntries: FigureEntry[] = extractedFigures.map(f => ({
            ...f,
            filePath: file.path,
            mtime: file.stat.mtime
        }));

        const citationEntries: CitationEntry[] = extractedCitations.map(c => ({
            ...c,
            filePath: file.path,
            mtime: file.stat.mtime
        } as any));

        this.fileDivCache.set(file.path, entries);
        this.fileEquationCache.set(file.path, eqEntries);
        this.fileSectionCache.set(file.path, sectionEntries);
        this.fileFigureCache.set(file.path, figureEntries);
        this.fileCitationCache.set(file.path, citationEntries);

        if (recalculate) {
            const projectPath = this.fileToProject.get(file.path);
            if (projectPath) {
                this.recalculateNumbering(projectPath);
                this.debouncedSave(projectPath);
            }
        }
        this.trackRecent(file.path, false);
    }

    public getProjectScenesByPath(projectPath: string): SceneEntry[] {
        return this.projectScenes.get(projectPath) || [];
    }

    private recalculateNumbering(projectPath: string): void {
        const scenes = this.projectScenes.get(projectPath);
        if (!scenes) return;

        const classCounters: Record<string, number> = {};

        const labelIndex = new Map<string, FencedDivProjectEntry>();
        const equationIndex = new Map<string, EquationPanelItem>();
        const figureIndex = new Map<string, FigureEntry>();
        this.globalCitationIndex.clear();

        const allSections: SectionEntry[] = [];
        const allFigures: FigureEntry[] = [];

        // Map to sync back figure numbers to FencedDivProjectEntry for subfigures
        const subfiguresMap = new Map<FigureEntry, FencedDivProjectEntry>();

        for (const entry of scenes) {
            const path = entry.path;
            const entries = this.fileDivCache.get(path) || [];
            const fileFigures = [...(this.fileFigureCache.get(path) || [])];

            for (const entry of entries) {
                const primaryClass = entry.classes[0] || 'div';

                // Check if this class should be unnumbered (via settings or ad-hoc 'unnumbered' class)
                const isUnnumbered = this.settings.unnumberedClasses.some(c =>
                    entry.classes.map(cls => cls.toLowerCase()).includes(c.toLowerCase())
                ) || entry.classes.includes('unnumbered');

                if (isUnnumbered) {
                    entry.projectIndex = 0;
                    entry.displayTitle = entry.displayName;
                } else if (primaryClass === 'subfigures') {
                    const subfigures = extractFigures(entry.content || '');
                    subfigures.forEach(sub => {
                        sub.isSubfigure = true;
                        sub.filePath = entry.filePath;
                    });
                    const figEntry: FigureEntry = {
                        label: entry.label || '',
                        description: entry.content || '',
                        title: entry.inlineTitle || 'Figure',
                        imagePath: '',
                        lineNumber: entry.lineNumber,
                        filePath: entry.filePath,
                        mtime: entry.mtime,
                        subfigures: subfigures
                    };
                    fileFigures.push(figEntry);
                    subfiguresMap.set(figEntry, entry);
                } else {
                    if (!classCounters[primaryClass]) classCounters[primaryClass] = 0;
                    classCounters[primaryClass]++;

                    entry.projectIndex = classCounters[primaryClass];
                    entry.displayTitle = `${entry.displayName} ${entry.projectIndex}`;
                }

                if (entry.label && primaryClass !== 'subfigures') {
                    labelIndex.set(entry.label, entry);
                }
            }

            // Sort interleaved figures by line number
            fileFigures.sort((a, b) => a.lineNumber - b.lineNumber);
            allFigures.push(...fileFigures);

            const eqEntries = this.fileEquationCache.get(path) || [];
            for (const eq of eqEntries) {
                equationIndex.set(eq.label, eq);
            }

            const citeEntries = this.fileCitationCache.get(path) || [];
            for (const cite of citeEntries) {
                const existing = this.globalCitationIndex.get(cite.citekey) || [];
                existing.push(cite);
                this.globalCitationIndex.set(cite.citekey, existing);
            }

            const sectionEntries = this.fileSectionCache.get(path) || [];
            allSections.push(...sectionEntries);
        }

        numberSections(allSections);
        numberFigures(allFigures);

        // Index figures globally and sync back to subfigure fenced divs
        for (const fig of allFigures) {
            const divEntry = subfiguresMap.get(fig);
            if (divEntry) {
                divEntry.projectIndex = fig.number || 0;
                divEntry.displayTitle = fig.displayTitle || `Figure ${fig.number}`;
                divEntry.displayName = 'Figure';

                if (divEntry.label) {
                    labelIndex.set(divEntry.label, divEntry);
                }
            }
            if (fig.label) {
                figureIndex.set(fig.label, fig);
            }

            if (fig.subfigures) {
                for (const subfig of fig.subfigures) {
                    if (subfig.label) {
                        figureIndex.set(subfig.label, subfig);
                    }
                }
            }
        }

        this.labelIndices.set(projectPath, labelIndex);
        this.equationIndices.set(projectPath, equationIndex);
        this.figureIndices.set(projectPath, figureIndex);
    }

    private getAllFilesUnder(folder: TFolder): TFile[] {
        const files: TFile[] = [];
        for (const child of folder.children) {
            if (child instanceof TFile) {
                files.push(child);
            } else if (child instanceof TFolder) {
                files.push(...this.getAllFilesUnder(child));
            }
        }
        return files;
    }

    private flattenScenes(scenes: any, level: number = 0): { path: string, level: number }[] {
        if (!scenes) return [];

        // Base case: a plain string = a scene file at this level
        if (typeof scenes === 'string') return [{ path: scenes, level }];

        // Longform folder object: { title: "FolderName", scenes: [...] }
        if (!Array.isArray(scenes) && typeof scenes === 'object' && scenes !== null) {
            const results: { path: string, level: number }[] = [];
            if (scenes.title) {
                results.push({ path: scenes.title, level });
                results.push(...this.flattenScenes(scenes.scenes ?? [], level + 1));
            } else if (scenes.scenes) {
                results.push(...this.flattenScenes(scenes.scenes, level));
            } else {
                // Generic key-value object map: { FolderName: [...children] }
                for (const key of Object.keys(scenes)) {
                    const val = (scenes as any)[key];
                    results.push({ path: key, level });
                    if (Array.isArray(val) && val.length > 0) {
                        results.push(...this.flattenScenes(val, level + 1));
                    } else if (val && typeof val === 'object') {
                        results.push(...this.flattenScenes(val, level + 1));
                    }
                }
            }
            return results;
        }

        if (!Array.isArray(scenes)) return [];

        const result: { path: string, level: number }[] = [];

        for (const item of scenes) {
            if (typeof item === 'string') {
                // Plain scene filename
                result.push({ path: item, level });
            } else if (Array.isArray(item)) {
                // Longform nested array format:
                //   [ "FolderName", "child1", "child2", [...grandchildren] ]
                // The first string element is the folder/group name.
                // Remaining elements are its children at level+1.
                const [first, ...rest] = item;
                if (typeof first === 'string' && rest.length > 0) {
                    // First element is the folder label
                    result.push({ path: first, level });
                    result.push(...this.flattenScenes(rest, level + 1));
                } else if (typeof first === 'string') {
                    // Single-element nested array — treat as a file at this level
                    result.push({ path: first, level });
                } else {
                    // All items are non-string — recurse at same level
                    result.push(...this.flattenScenes(item, level));
                }
            } else if (typeof item === 'object' && item !== null) {
                // Object with title/scenes keys (Longform folder object)
                if (item.title) {
                    result.push({ path: item.title, level });
                    result.push(...this.flattenScenes(item.scenes ?? [], level + 1));
                } else if (item.scenes) {
                    result.push(...this.flattenScenes(item.scenes, level));
                } else {
                    // Generic map object
                    for (const key of Object.keys(item)) {
                        const val = (item as any)[key];
                        result.push({ path: key, level });
                        if (val && (Array.isArray(val) || typeof val === 'object')) {
                            result.push(...this.flattenScenes(val, level + 1));
                        }
                    }
                }
            }
        }

        return result;
    }

    public getReference(label: string, filePath: string): FencedDivProjectEntry | undefined {
        const bucket = this.getBucketForFile(filePath);
        return this.labelIndices.get(bucket)?.get(label);
    }

    public getAllReferences(filePath: string): UnifiedReference[] {
        const bucket = this.getBucketForFile(filePath);
        const refs: UnifiedReference[] = [];

        // 1. Fenced Divs
        const divs = this.labelIndices.get(bucket);
        if (divs) {
            for (const div of divs.values()) {
                refs.push({
                    label: div.label,
                    displayName: div.displayTitle || div.displayName,
                    previewText: div.content || '',
                    lineNumber: div.lineNumber,
                    filePath: div.filePath,
                    type: 'div'
                });
            }
        }

        // 2. Equations
        const eqs = this.equationIndices.get(bucket);
        if (eqs) {
            for (const eq of eqs.values()) {
                const fullLabel = `eq:${eq.label}`;
                refs.push({
                    label: fullLabel,
                    displayName: `(${fullLabel})`,
                    previewText: eq.content || '',
                    lineNumber: eq.lineNumber,
                    filePath: eq.filePath || '',
                    type: 'equation'
                });
            }
        }

        // 3. Figures
        const figs = this.figureIndices.get(bucket);
        if (figs) {
            for (const fig of figs.values()) {
                refs.push({
                    label: fig.label,
                    displayName: fig.displayTitle || fig.label,
                    previewText: fig.description || fig.imagePath || '',
                    lineNumber: fig.lineNumber,
                    filePath: fig.filePath || '',
                    type: 'figure'
                });
            }
        }

        return refs;
    }

    public getFileEntries(filePath: string): FencedDivProjectEntry[] {
        return this.fileDivCache.get(filePath) || [];
    }

    public resolveProjectPath(filePath: string): string | undefined {
        if (this.settings.pinnedProjectPath) {
            return this.settings.pinnedProjectPath;
        }
        if (this.settings.pinnedFilePath) {
            // If a file is pinned, we might still want its project data if it's in a project
            return this.fileToProject.get(this.settings.pinnedFilePath);
        }
        return this.fileToProject.get(filePath);
    }

    public getFencedDivsForProject(projectPath: string): FencedDivProjectEntry[] {
        const scenes = this.projectScenes.get(projectPath);
        if (!scenes) return [];

        const allDivs: FencedDivProjectEntry[] = [];
        for (const entry of scenes) {
            const path = entry.path;
            const divs = this.fileDivCache.get(path);
            if (divs) allDivs.push(...divs);
        }
        return allDivs;
    }

    public getProjectFencedDivs(filePath: string): FencedDivProjectEntry[] {
        const projectPath = this.resolveProjectPath(filePath);
        if (!projectPath) return [];
        return this.getFencedDivsForProject(projectPath);
    }

    public getFileEquations(filePath: string): EquationPanelItem[] {
        return this.fileEquationCache.get(filePath) || [];
    }

    public getProjectEquations(filePath: string): EquationPanelItem[] {
        const projectPath = this.resolveProjectPath(filePath);
        if (!projectPath) return [];

        const scenes = this.projectScenes.get(projectPath);
        if (!scenes) return [];

        const allEntries: EquationPanelItem[] = [];
        for (const entry of scenes) {
            const path = entry.path;
            const entries = this.fileEquationCache.get(path);
            if (entries) {
                allEntries.push(...entries);
            }
        }
        return allEntries;
    }

    public getEquationReference(label: string, filePath: string): EquationPanelItem | undefined {
        const bucket = this.getBucketForFile(filePath);
        return this.equationIndices.get(bucket)?.get(label);
    }

    // Section getters
    public getFileSections(filePath: string): SectionEntry[] {
        return this.fileSectionCache.get(filePath) || [];
    }

    public getProjectSections(filePath: string): SectionEntry[] {
        const projectPath = this.resolveProjectPath(filePath);
        if (!projectPath) return [];

        const scenes = this.projectScenes.get(projectPath);
        if (!scenes) return [];

        const allEntries: SectionEntry[] = [];
        for (const entry of scenes) {
            const path = entry.path;
            const entries = this.fileSectionCache.get(path);
            if (entries) {
                allEntries.push(...entries);
            }
        }
        return allEntries;
    }

    public getProjectPath(filePath: string): string | undefined {
        return this.resolveProjectPath(filePath);
    }

    public getActualProjectPath(filePath: string): string | undefined {
        return this.fileToProject.get(filePath);
    }

    // Figure getters
    public getFileFigures(filePath: string): FigureEntry[] {
        return this.fileFigureCache.get(filePath) || [];
    }

    public getProjectFigures(filePath: string): FigureEntry[] {
        const projectPath = this.resolveProjectPath(filePath);
        if (!projectPath) return [];
        const scenes = this.projectScenes.get(projectPath);
        if (!scenes) return [];
        const allEntries: FigureEntry[] = [];
        for (const entry of scenes) {
            const path = entry.path;
            const entries = this.fileFigureCache.get(path);
            if (entries) allEntries.push(...entries);
        }
        return allEntries;
    }

    public getFigureReference(label: string, filePath: string): FigureEntry | undefined {
        const bucket = this.getBucketForFile(filePath);
        return this.figureIndices.get(bucket)?.get(label);
    }

    public getProjectCitations(filePath: string): CitationEntry[] {
        const projectPath = this.resolveProjectPath(filePath);
        if (!projectPath) return this.fileCitationCache.get(filePath) || [];

        const scenes = this.projectScenes.get(projectPath);
        if (!scenes) return this.fileCitationCache.get(filePath) || [];

        const allEntries: CitationEntry[] = [];
        for (const entry of scenes) {
            const path = entry.path;
            const entries = this.fileCitationCache.get(path);
            if (entries) {
                allEntries.push(...entries);
            }
        }
        return allEntries;
    }

    public getFileCitations(filePath: string): CitationEntry[] {
        return this.fileCitationCache.get(filePath) || [];
    }

    public getCitationOccurrences(citekey: string): CitationEntry[] {
        return this.globalCitationIndex.get(citekey) || [];
    }

    public getAllCitationCitekeys(): string[] {
        return Array.from(this.globalCitationIndex.keys());
    }

    public async rescanProject(projectPath: string): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(projectPath);
        if (!(folder instanceof TFolder)) return;

        console.log(`[PandocExtendedMarkdown] Force rescanning structure for ${projectPath}...`);
        this.projectIndexMtime.delete(folder.path);
        this.lastScanTime.delete(folder.path);
        await this.scanProject(folder);
    }

    public async reindexProject(projectPath: string): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(projectPath);
        if (!(folder instanceof TFolder)) return;

        console.log(`[PandocExtendedMarkdown] Force reindexing content for ${projectPath}...`);
        // 1. Rescan Index first
        await this.rescanProject(folder.path);

        // 2. Force re-index of every file
        const scenes = this.projectScenes.get(folder.path) || [];
        for (const entry of scenes) {
            if (entry.isFile) {
                const file = this.app.vault.getAbstractFileByPath(entry.path);
                if (file instanceof TFile) {
                    await this.updateFileCache(file, false);
                }
            }
        }
        this.recalculateNumbering(folder.path);
        void this.persistProjectCache(folder.path);
    }

    // Force reload — clears all caches and re-scans
    public async forceReload(): Promise<void> {
        console.log('[PandocExtendedMarkdown] Force reloading all projects...');

        // Discover any new projects first
        await this.discoverLongformProjects();

        const projectPaths = new Set(this.settings.knownProjectPaths);

        this.scannedProjects.clear();
        this.fileDivCache.clear();
        this.fileEquationCache.clear();
        this.fileSectionCache.clear();
        this.fileFigureCache.clear();
        this.fileCitationCache.clear();
        this.labelIndices.clear();
        this.equationIndices.clear();
        this.figureIndices.clear();
        this.vaultFilePaths.clear();
        this.globalCitationIndex.clear();
        this.fileToProject.clear();
        this.projectScenes.clear();
        this.lastScanTime.clear();
        this.projectIndexMtime.clear();

        for (const projectPath of projectPaths) {
            const folder = this.app.vault.getAbstractFileByPath(projectPath);
            if (folder instanceof TFolder) {
                await this.scanProject(folder);
            }
        }

        // Also try the active file
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            await this.checkAndLoadProjectForFile(activeFile);
        }
        console.log('[PandocExtendedMarkdown] Force reload complete.');
    }

    public async discoverLongformProjects(): Promise<void> {
        const mdFiles = this.app.vault.getMarkdownFiles();
        let foundNew = false;

        for (const file of mdFiles) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter?.longform) {
                const folder = file.parent;
                if (folder && !this.settings.knownProjectPaths.includes(folder.path)) {
                    console.log(`[PandocExtendedMarkdown] Discovered Longform project at ${folder.path} via ${file.path}`);
                    this.settings.knownProjectPaths.push(folder.path);
                    foundNew = true;
                }
            }
        }

        if (foundNew) {
            await this.plugin.saveSettings();
        }
    }

    public async findAllProjects(): Promise<{ name: string, path: string }[]> {
        const projects: { name: string, path: string }[] = [];
        const paths = this.settings.knownProjectPaths || [];

        for (const path of paths) {
            const folder = this.app.vault.getAbstractFileByPath(path);
            if (folder instanceof TFolder) {
                projects.push({
                    name: folder.name,
                    path: folder.path
                });
            }
        }

        return projects;
    }

    public async registerProject(path: string): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(path);
        const folder = file instanceof TFile ? file.parent : (file instanceof TFolder ? file : null);
        if (!folder) return false;

        // Verify it's a longform project by checking Index.md or any file with longform frontmatter
        let indexFile = folder.children.find(c => c instanceof TFile && (c.name.toLowerCase() === 'index.md' || c.name === 'longform.json')) as TFile | undefined;

        if (!indexFile) {
            // Check all markdown files in the folder for 'longform' key
            for (const child of folder.children) {
                if (child instanceof TFile && child.extension === 'md') {
                    const cache = this.app.metadataCache.getFileCache(child);
                    if (cache?.frontmatter?.longform) {
                        indexFile = child;
                        break;
                    }
                }
            }
        }

        if (!indexFile) return false;

        if (!this.settings.knownProjectPaths.includes(folder.path)) {
            this.settings.knownProjectPaths.push(folder.path);
            await this.plugin.saveSettings();
        }

        await this.scanProject(folder);
        return true;
    }

    public async unregisterProject(path: string): Promise<void> {
        this.settings.knownProjectPaths = this.settings.knownProjectPaths.filter(p => p !== path);
        if (this.settings.pinnedProjectPath === path) {
            this.settings.pinnedProjectPath = null;
        }
        await this.plugin.saveSettings();
        this.clearProjectCache(path);
    }

    public getPinnedProjectPath(): string | null {
        return this.settings.pinnedProjectPath;
    }

    public getPinnedFilePath(): string | null {
        return this.settings.pinnedFilePath;
    }

    public setPinnedProject(path: string | null) {
        this.settings.pinnedProjectPath = path;
        if (path) this.settings.pinnedFilePath = null; // Exclusive
        void this.plugin.saveSettings();
        this.app.workspace.trigger('pem:settings-changed');

        if (path) {
            const name = path.split('/').pop() || path;
            new Notice(`Pinned project: ${name}\nSidebar now follows this project.`);
        } else {
            new Notice('Project unpinned.\nSidebar now follows active editor.');
        }
    }

    public setPinnedFile(path: string | null) {
        this.settings.pinnedFilePath = path;
        if (path) this.settings.pinnedProjectPath = null; // Exclusive
        void this.plugin.saveSettings();
        this.app.workspace.trigger('pem:settings-changed');

        if (path) {
            const name = path.split('/').pop() || path;
            new Notice(`Pinned file: ${name}\nSidebar now follows this file.`);
        } else {
            new Notice('File unpinned.\nSidebar now follows active editor.');
        }
    }


    private vaultSaveTimeout: any = null;
    private vaultCachePath: string;

    private debouncedVaultSave() {
        if (this.vaultSaveTimeout) {
            clearTimeout(this.vaultSaveTimeout);
        }
        this.vaultSaveTimeout = setTimeout(() => {
            void this.persistVaultCache();
        }, 5000);
    }

    private async persistVaultCache() {
        const cacheData: any = {
            files: {},
            equations: {},
            sections: {},
            figures: {},
            citations: {}
        };

        for (const path of this.vaultFilePaths) {
            cacheData.files[path] = this.fileDivCache.get(path) || [];
            cacheData.equations[path] = this.fileEquationCache.get(path) || [];
            cacheData.sections[path] = this.fileSectionCache.get(path) || [];
            cacheData.figures[path] = this.fileFigureCache.get(path) || [];
            cacheData.citations[path] = this.fileCitationCache.get(path) || [];
        }

        try {
            const parentDir = this.vaultCachePath.split('/').slice(0, -1).join('/');
            if (!(await this.app.vault.adapter.exists(parentDir))) {
                await this.app.vault.adapter.mkdir(parentDir);
            }
            await this.app.vault.adapter.write(this.vaultCachePath, JSON.stringify(cacheData, null, 2));
            console.log('[PandocExtendedMarkdown] Persisted vault cache.');
        } catch (e) {
            console.error('[PandocExtendedMarkdown] Failed to persist vault cache:', e);
        }
    }

    private async loadVaultCache(): Promise<boolean> {
        if (!(await this.app.vault.adapter.exists(this.vaultCachePath))) return false;

        try {
            const content = await this.app.vault.adapter.read(this.vaultCachePath);
            const data = JSON.parse(content);

            if (data.files) {
                for (const path in data.files) {
                    this.fileDivCache.set(path, data.files[path]);
                    this.vaultFilePaths.add(path);
                }
            }
            if (data.equations) {
                for (const path in data.equations) {
                    this.fileEquationCache.set(path, data.equations[path]);
                }
            }
            if (data.sections) {
                for (const path in data.sections) {
                    this.fileSectionCache.set(path, data.sections[path]);
                }
            }
            if (data.figures) {
                for (const path in data.figures) {
                    this.fileFigureCache.set(path, data.figures[path]);
                }
            }
            if (data.citations) {
                for (const path in data.citations) {
                    this.fileCitationCache.set(path, data.citations[path]);
                }
            }
            console.log('[PandocExtendedMarkdown] Loaded vault cache.');
            return true;
        } catch (e) {
            console.error('[PandocExtendedMarkdown] Failed to load vault cache:', e);
            return false;
        }
    }

    public getRecentFiles(): string[] {
        return this.settings.recentFiles || [];
    }

    public getRecentProjects(): string[] {
        return this.settings.recentProjects || [];
    }

    private debouncedSave(projectPath: string) {
        if (this.saveTimeout.has(projectPath)) {
            clearTimeout(this.saveTimeout.get(projectPath));
        }
        this.saveTimeout.set(projectPath, window.setTimeout(() => {
            void this.persistProjectCache(projectPath);
        }, 5000));
    }

    private async persistProjectCache(projectPath: string) {
        const folder = this.app.vault.getAbstractFileByPath(projectPath);
        if (!(folder instanceof TFolder)) return;

        const scenes = this.projectScenes.get(projectPath) || [];
        const cacheData: any = {
            files: {},
            equations: {},
            sections: {},
            figures: {},
            citations: {}
        };

        for (const path of scenes) {
            cacheData.files[path] = this.fileDivCache.get(path) || [];
            cacheData.equations[path] = this.fileEquationCache.get(path) || [];
            cacheData.sections[path] = this.fileSectionCache.get(path) || [];
            cacheData.figures[path] = this.fileFigureCache.get(path) || [];
            cacheData.citations[path] = this.fileCitationCache.get(path) || [];
        }

        cacheData.scenes = this.projectScenes.get(projectPath) || [];
        cacheData.indexMtime = this.projectIndexMtime.get(projectPath) || 0;

        const cacheFile = `${projectPath}/.pem-cache.json`;
        try {
            await this.app.vault.adapter.write(cacheFile, JSON.stringify(cacheData, null, 2));
            console.log(`[PandocExtendedMarkdown] Persisted cache for project ${projectPath}`);
        } catch (e) {
            console.error(`[PandocExtendedMarkdown] Failed to persist cache for ${projectPath}:`, e);
        }
    }

    private async loadProjectCache(folder: TFolder): Promise<boolean> {
        const cacheFile = `${folder.path}/.pem-cache.json`;
        if (!(await this.app.vault.adapter.exists(cacheFile))) return false;

        try {
            const content = await this.app.vault.adapter.read(cacheFile);
            const data = JSON.parse(content);

            if (data.files) {
                for (const path in data.files) {
                    this.fileDivCache.set(path, data.files[path]);
                }
            }
            if (data.equations) {
                for (const path in data.equations) {
                    this.fileEquationCache.set(path, data.equations[path]);
                }
            }
            if (data.sections) {
                for (const path in data.sections) {
                    this.fileSectionCache.set(path, data.sections[path]);
                }
            }
            if (data.figures) {
                for (const path in data.figures) {
                    this.fileFigureCache.set(path, data.figures[path]);
                }
            }
            if (data.scenes) {
                this.projectScenes.set(folder.path, data.scenes);
            }
            if (data.indexMtime) {
                this.projectIndexMtime.set(folder.path, data.indexMtime);
            }
            if (data.citations) {
                for (const path in data.citations) {
                    this.fileCitationCache.set(path, data.citations[path]);
                }
            }
            console.log(`[PandocExtendedMarkdown] Loaded project cache from ${cacheFile}`);
            return true;
        } catch (e) {
            console.error(`[PandocExtendedMarkdown] Failed to load cache from ${cacheFile}:`, e);
            return false;
        }
    }


    // --- Global Citation Metadata Cache ---

    public getCitationMetadata(citekey: string): any | undefined {
        return this.citationMetadataCache.get(citekey);
    }

    public setCitationMetadata(citekey: string, metadata: any): void {
        this.citationMetadataCache.set(citekey, metadata);
        void this.saveGlobalCitationCache();
    }

    public async clearCitationCache(): Promise<void> {
        this.citationMetadataCache.clear();
        if (await this.app.vault.adapter.exists(this.cacheFilePath)) {
            await this.app.vault.adapter.remove(this.cacheFilePath);
        }
    }

    public async loadGlobalCitationCache(): Promise<void> {
        try {
            if (await this.app.vault.adapter.exists(this.cacheFilePath)) {
                const content = await this.app.vault.adapter.read(this.cacheFilePath);
                const data = JSON.parse(content);
                for (const key in data) {
                    this.citationMetadataCache.set(key, data[key]);
                }
            }
        } catch (e) {
            console.warn('[PandocExtendedMarkdown] Failed to load global citation cache:', e);
        }
    }

    private async saveGlobalCitationCache() {
        try {
            const data: any = {};
            this.citationMetadataCache.forEach((v, k) => data[k] = v);
            const parentDir = this.cacheFilePath.split('/').slice(0, -1).join('/');
            if (!(await this.app.vault.adapter.exists(parentDir))) {
                await this.app.vault.adapter.mkdir(parentDir);
            }
            await this.app.vault.adapter.write(this.cacheFilePath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('[PandocExtendedMarkdown] Failed to save global citation cache:', e);
        }
    }

    public isFileInProject(filePath: string): boolean {
        return this.fileToProject.has(filePath);
    }

    // ═══════════════════════════════════════════════════════
    // Scene Mutation Helpers — all use direct YAML I/O to
    // preserve nested array structure (processFrontMatter
    // silently flattens nested arrays and cannot be used).
    // ═══════════════════════════════════════════════════════

    private async readIndexScenes(folder: TFolder): Promise<{ indexFile: TFile, scenes: any[] } | null> {
        const indexFile = folder.children.find(c =>
            c instanceof TFile && (c.name.toLowerCase() === 'index.md' || c.name === 'longform.json')
        ) as TFile | undefined;
        if (!indexFile) return null;

        try {
            const content = await this.app.vault.read(indexFile);
            const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
            if (!match) return null;
            const yaml = parseYaml(match[1]);
            if (!yaml?.longform?.scenes) return null;
            return { indexFile, scenes: yaml.longform.scenes };
        } catch (e) {
            console.error('[PandocExtendedMarkdown] readIndexScenes failed:', e);
            return null;
        }
    }

    private serializeScenes(scenes: any[], indent: number = 0): string {
        const PAD = '        '; // 8 spaces per level
        const pad = PAD.repeat(indent);
        const lines: string[] = [];

        for (const item of scenes) {
            if (typeof item === 'string') {
                lines.push(`${pad}- ${item}`);
            } else if (Array.isArray(item)) {
                // Nested array: first element is folder name, rest are children
                const [first, ...rest] = item;
                if (typeof first === 'string') {
                    lines.push(`${pad}- - ${first}`);
                    for (const child of rest) {
                        if (typeof child === 'string') {
                            lines.push(`${pad}  - ${child}`);
                        } else if (Array.isArray(child)) {
                            lines.push(this.serializeScenes([child], indent + 1));
                        }
                    }
                }
            } else if (typeof item === 'object' && item !== null) {
                if (item.title) {
                    lines.push(`${pad}- title: ${item.title}`);
                    if (Array.isArray(item.scenes) && item.scenes.length > 0) {
                        lines.push(`${pad}  scenes:`);
                        lines.push(this.serializeScenes(item.scenes, indent + 1));
                    }
                }
            }
        }
        return lines.join('\n');
    }

    private async writeIndexScenes(indexFile: TFile, scenes: any[]): Promise<void> {
        const content = await this.app.vault.read(indexFile);
        const scenesYaml = this.serializeScenes(scenes);

        // Replace the scenes: block inside the frontmatter
        const newContent = content.replace(
            /(^---\s*\r?\n[\s\S]*?)(^\s*scenes:\s*\r?\n)([\s\S]*?)(^\s*\w|^---)/m,
            (_, before, _scenesKey, _oldScenes, after) => {
                return `${before}scenes:\n${scenesYaml}\n${after}`;
            }
        );

        if (newContent === content) {
            console.warn('[PandocExtendedMarkdown] writeIndexScenes: no replacement made, trying full frontmatter rebuild');
            // Fallback: rebuild frontmatter from scratch
            const fmMatch = content.match(/^(---\s*\r?\n)([\s\S]*?)(\r?\n---)/);
            if (!fmMatch) return;
            const rebuilt = fmMatch[1] + fmMatch[2].replace(
                /^\s*scenes:[\s\S]*?(?=^\w|\n\w|$)/m,
                `scenes:\n${scenesYaml}\n`
            ) + fmMatch[3];
            await this.app.vault.modify(indexFile, rebuilt);
            return;
        }
        await this.app.vault.modify(indexFile, newContent);
    }

    /** Flatten the live SceneEntry list to a nested YAML-compatible array. */
    private scenesToNestedYaml(entries: SceneEntry[]): any[] {
        const MAX_LEVEL = 6;
        // We build a tree from the flat level list then serialize
        type Node = { name: string, level: number, children: Node[] };
        const roots: Node[] = [];
        const stack: Node[] = []; // stack[i] = last node at level i

        for (const e of entries) {
            const level = Math.min(e.level, MAX_LEVEL);
            const basename = e.path.split('/').pop()?.replace(/\.md$/, '') ?? e.path;
            const node: Node = { name: basename, level, children: [] };

            // Pop stack down to the parent level
            while (stack.length > level) stack.pop();

            if (stack.length === 0) {
                roots.push(node);
            } else {
                stack[stack.length - 1].children.push(node);
            }
            stack.push(node);
        }

        const toYaml = (nodes: Node[]): any[] => {
            return nodes.map(n => {
                if (n.children.length === 0) return n.name;
                // Use title/scenes object format for nested scenes
                return { title: n.name, scenes: toYaml(n.children) };
            });
        };
        return toYaml(roots);
    }

    public async addNewFileToProject(
        projectPath: string,
        insertRefFilePath: string,
        position: 'before' | 'after' = 'after',
        atStart: boolean = false
    ): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(projectPath);
        if (!(folder instanceof TFolder)) return;

        const result = await this.readIndexScenes(folder);
        if (!result) return;

        // Determine the level of the reference scene so new scene gets same level
        const scenes = this.projectScenes.get(projectPath) || [];
        const refEntry = scenes.find(s => s.path === insertRefFilePath);
        const newLevel = refEntry?.level ?? 0;

        // Generate unique filename
        let fileName = 'New Scene.md';
        let counter = 1;
        while (await this.app.vault.adapter.exists(`${projectPath}/${fileName}`)) {
            fileName = `New Scene ${counter++}.md`;
        }
        const newFilePath = `${projectPath}/${fileName}`;
        const newFile = await this.app.vault.create(newFilePath, '# New Scene\n');

        // Insert into the scenes list at the correct position and level
        const updatedEntries: SceneEntry[] = [];
        let inserted = false;

        if (atStart) {
            updatedEntries.push({ path: newFilePath, level: 0, isFile: true });
            updatedEntries.push(...scenes);
            inserted = true;
        } else {
            for (const entry of scenes) {
                if (!inserted && position === 'before' && entry.path === insertRefFilePath) {
                    updatedEntries.push({ path: newFilePath, level: newLevel, isFile: true });
                    inserted = true;
                }
                updatedEntries.push(entry);
                if (!inserted && position === 'after' && entry.path === insertRefFilePath) {
                    updatedEntries.push({ path: newFilePath, level: newLevel, isFile: true });
                    inserted = true;
                }
            }
        }
        if (!inserted) {
            updatedEntries.push({ path: newFilePath, level: newLevel, isFile: true });
        }

        this.projectScenes.set(projectPath, updatedEntries);
        this.fileToProject.set(newFilePath, projectPath);
        await this.writeIndexScenes(result.indexFile, this.scenesToNestedYaml(updatedEntries));
        await this.scanProject(folder);

        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(newFile);
    }

    public async removeFileFromProject(projectPath: string, filePath: string): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(projectPath);
        if (!(folder instanceof TFolder)) return;

        const result = await this.readIndexScenes(folder);
        if (!result) return;

        const scenes = (this.projectScenes.get(projectPath) || []).filter(e => e.path !== filePath);
        this.projectScenes.set(projectPath, scenes);
        this.fileToProject.delete(filePath);

        await this.writeIndexScenes(result.indexFile, this.scenesToNestedYaml(scenes));
        await this.scanProject(folder);
    }

    public async deleteFileFromProject(projectPath: string, filePath: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        await this.removeFileFromProject(projectPath, filePath);
        if (file instanceof TFile) await this.app.vault.delete(file);
    }

    public async moveScene(projectPath: string, filePath: string, targetPath: string, position: 'before' | 'after'): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(projectPath);
        if (!(folder instanceof TFolder)) return;

        const result = await this.readIndexScenes(folder);
        if (!result) return;

        let scenes = [...(this.projectScenes.get(projectPath) || [])];
        const movingEntry = scenes.find(s => s.path === filePath);
        if (!movingEntry) return;

        scenes = scenes.filter(s => s.path !== filePath);
        const targetIdx = scenes.findIndex(s => s.path === targetPath);

        if (targetIdx === -1) {
            scenes.push(movingEntry);
        } else if (position === 'before') {
            scenes.splice(targetIdx, 0, movingEntry);
        } else {
            scenes.splice(targetIdx + 1, 0, movingEntry);
        }

        this.projectScenes.set(projectPath, scenes);
        await this.writeIndexScenes(result.indexFile, this.scenesToNestedYaml(scenes));
        this.projectIndexMtime.delete(projectPath);
        await this.scanProject(folder);
    }

    public async changeSceneLevel(projectPath: string, filePath: string, delta: number): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(projectPath);
        if (!(folder instanceof TFolder)) return;

        const result = await this.readIndexScenes(folder);
        if (!result) return;

        const scenes = [...(this.projectScenes.get(projectPath) || [])];
        const entry = scenes.find(s => s.path === filePath);
        if (!entry) return;

        entry.level = Math.max(0, Math.min(6, entry.level + delta));

        this.projectScenes.set(projectPath, scenes);
        await this.writeIndexScenes(result.indexFile, this.scenesToNestedYaml(scenes));
        this.projectIndexMtime.delete(projectPath);
        await this.scanProject(folder);
    }

    public async renameScene(projectPath: string, filePath: string, newName: string): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(projectPath);
        if (!(folder instanceof TFolder)) return;

        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        const newBasename = newName.endsWith('.md') ? newName : `${newName}.md`;
        const newPath = `${file.parent?.path ?? projectPath}/${newBasename}`;

        // Rename the physical file
        await this.app.fileManager.renameFile(file, newPath);

        // Update internal scene entries
        const scenes = this.projectScenes.get(projectPath) || [];
        const entry = scenes.find(s => s.path === filePath);
        if (entry) {
            entry.path = newPath;
            this.fileToProject.delete(filePath);
            this.fileToProject.set(newPath, projectPath);
        }

        // Re-read index and write updated scenes (file rename updates the vault, rescan will pick it up)
        const result = await this.readIndexScenes(folder);
        if (result) {
            await this.writeIndexScenes(result.indexFile, this.scenesToNestedYaml(scenes));
        }
        this.projectIndexMtime.delete(projectPath);
        await this.scanProject(folder);
    }

    private trackRecent(path: string, isProject: boolean) {
        const list = isProject ? this.settings.recentProjects : this.settings.recentFiles;

        // Remove if already exists to move to top
        const index = list.indexOf(path);
        if (index > -1) {
            list.splice(index, 1);
        }

        list.unshift(path);

        // Limit to 10 items
        if (list.length > 10) {
            list.pop();
        }

        void this.plugin.saveSettings();
    }
}


