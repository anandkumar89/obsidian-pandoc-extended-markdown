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

export class LongformProjectManager {
    private plugin: PandocExtendedMarkdownPlugin;
    private app: App;
    private settings: PandocExtendedMarkdownSettings;
    
    // Maps a directory path to its Longform project scene list (ordered file paths)
    private projectScenes: Map<string, string[]> = new Map();
    
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
    
    // Global maps
    private globalLabelIndex: Map<string, FencedDivProjectEntry> = new Map();
    private globalEquationIndex: Map<string, EquationPanelItem> = new Map();
    private globalFigureIndex: Map<string, FigureEntry> = new Map();
    private globalCitationIndex: Map<string, CitationEntry[]> = new Map();
    private citationMetadataCache: Map<string, any> = new Map();
    private cacheFilePath: string;

    private static instance: LongformProjectManager;

    private constructor(plugin: PandocExtendedMarkdownPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.settings = plugin.settings;
        this.cacheFilePath = normalizePath(this.app.vault.configDir + '/plugins/academic-pandoc-markdown/citekey-cache.json');
        void this.loadGlobalCitationCache();
    }

    public static getInstance(plugin?: PandocExtendedMarkdownPlugin): LongformProjectManager {
        if (!LongformProjectManager.instance && plugin) {
            LongformProjectManager.instance = new LongformProjectManager(plugin);
        }
        return LongformProjectManager.instance;
    }

    public initialize(): void {
        this.app.workspace.onLayoutReady(() => {
            // Initial scan can be triggered lazily when a file is opened
        });

        // Ensure active file is cached on startup
        this.app.workspace.onLayoutReady(() => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                void this.ensureFileCached(activeFile);
            }
        });

        // Listen for metadata changes to catch Index.md updates or scene modifications
        this.app.metadataCache.on('changed', async (file: TFile) => {
            if (file.name.toLowerCase() === 'index.md' || file.name === 'longform.json') {
                if (file.parent instanceof TFolder) {
                    await this.scanProject(file.parent);
                }
            } else {
                // Always update cache for the file to support local heading numbering etc.
                await this.updateFileCache(file);
                if (this.fileToProject.has(file.path)) {
                    this.recalculateNumbering(this.fileToProject.get(file.path)!);
                }
            }
        });

        this.app.vault.on('delete', (file: TFile) => {
            if (this.fileToProject.has(file.path)) {
                const projectPath = this.fileToProject.get(file.path)!;
                this.fileDivCache.delete(file.path);
                this.fileEquationCache.delete(file.path);
                this.fileCitationCache.delete(file.path);
                this.fileToProject.delete(file.path);
                this.recalculateNumbering(projectPath);
                this.debouncedSave(projectPath);
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
            }
        });
    }

    public async checkAndLoadProjectForFile(file: TFile): Promise<void> {
        // If pinned, ensure pinned project is loaded
        if (this.settings.pinnedProjectPath) {
            const pinnedFolder = this.app.vault.getAbstractFileByPath(this.settings.pinnedProjectPath);
            if (pinnedFolder instanceof TFolder) {
                await this.scanProject(pinnedFolder);
            }
        }

        if (this.fileToProject.has(file.path)) return;
        
        let parent = file.parent;
        while (parent) {
            const indexFile = parent.children.find(c => c instanceof TFile && (c.name.toLowerCase() === 'index.md' || c.name === 'longform.json')) as TFile | undefined;
            if (indexFile) {
                console.log(`[PandocExtendedMarkdown] Found Index.md at ${indexFile.path}, scanning project...`);
                await this.scanProject(parent);
                return;
            }
            parent = parent.parent;
        }
        console.log(`[PandocExtendedMarkdown] No Index.md found in parent hierarchy for ${file.path}`);
        // Ensure the file is at least cached locally
        await this.ensureFileCached(file);
    }

    public async ensureFileCached(file: TFile): Promise<void> {
        if (!this.fileSectionCache.has(file.path)) {
            await this.updateFileCache(file, false);
        }
    }

    public async scanProject(folder: TFolder): Promise<void> {
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

        let frontmatter: any = null;

        // Always read the file directly — Obsidian's metadataCache can lag or flatten nested arrays
        try {
            const content = await this.app.vault.read(indexFile);
            // Handle both \n and \r\n line endings
            const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
            if (match) {
                const yaml = parseYaml(match[1]);
                if (yaml?.longform) {
                    frontmatter = yaml;
                }
            }
        } catch (e) {
            console.error(`[PandocExtendedMarkdown] Error reading Index.md for ${folder.path}:`, e);
        }

        // Fallback to metadata cache
        if (!frontmatter) {
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

        if (!rawScenes || !Array.isArray(rawScenes) || rawScenes.length === 0) {
            console.warn(`[PandocExtendedMarkdown] No scenes array in ${indexFile.path}`);
            return;
        }

        const scenes = this.flattenScenes(rawScenes);
        console.log(`[PandocExtendedMarkdown] Flattened scenes (${scenes.length}):`, scenes);
        this.scannedProjects.add(folder.path);
        
        // Try to load from cache first
        await this.loadProjectCache(folder);
        
        const scenePaths: string[] = [];

        // Parse scenes to file paths
        const allFiles = this.getAllFilesUnder(folder);
        
        for (const scene of scenes) {
            // Longform scenes match filenames (basenames) or relative paths
            let sceneFile = allFiles.find(f => f.basename === scene);
            
            if (!sceneFile) {
                // Try matching by relative path (case-insensitive for reliability)
                const normalizedScene = scene.toLowerCase().replace(/\\/g, '/');
                sceneFile = allFiles.find(f => {
                    const relativePath = f.path.substring(folder.path.length + 1).toLowerCase();
                    return relativePath === normalizedScene || relativePath === normalizedScene + '.md';
                });
            }

            if (sceneFile) {
                scenePaths.push(sceneFile.path);
                this.fileToProject.set(sceneFile.path, folder.path);
            } else {
                console.warn(`[PandocExtendedMarkdown] Could not find file for scene: "${scene}" in ${folder.path}`);
            }
        }

        console.log(`[PandocExtendedMarkdown] Matched ${scenePaths.length}/${scenes.length} scenes to files`);
        this.projectScenes.set(folder.path, scenePaths);

        // Scan all scene files for fenced divs
        for (const path of scenePaths) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const cachedDivs = this.fileDivCache.get(path);
                if (cachedDivs && cachedDivs.length > 0 && (cachedDivs[0] as any).mtime === file.stat.mtime) {
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
            inlineTitle: e.title !== e.classes[0] ? e.title : undefined,
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

    private recalculateNumbering(projectPath: string): void {
        const scenes = this.projectScenes.get(projectPath);
        if (!scenes) return;

        const classCounters: Record<string, number> = {};
        
        this.globalLabelIndex.clear();
        this.globalEquationIndex.clear();
        this.globalFigureIndex.clear();
        this.globalCitationIndex.clear();

        const allSections: SectionEntry[] = [];
        const allFigures: FigureEntry[] = [];

        // Map to sync back figure numbers to FencedDivProjectEntry for subfigures
        const subfiguresMap = new Map<FigureEntry, FencedDivProjectEntry>();

        for (const path of scenes) {
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
                    this.globalLabelIndex.set(entry.label, entry);
                }
            }
            
            // Sort interleaved figures by line number
            fileFigures.sort((a, b) => a.lineNumber - b.lineNumber);
            allFigures.push(...fileFigures);
            
            const eqEntries = this.fileEquationCache.get(path) || [];
            for (const eq of eqEntries) {
                this.globalEquationIndex.set(eq.label, eq);
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
                    this.globalLabelIndex.set(divEntry.label, divEntry);
                }
            }
            if (fig.label) {
                this.globalFigureIndex.set(fig.label, fig);
            }
            
            if (fig.subfigures) {
                for (const subfig of fig.subfigures) {
                    if (subfig.label) {
                        this.globalFigureIndex.set(subfig.label, subfig);
                    }
                }
            }
        }
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

    private flattenScenes(scenes: any): string[] {
        if (!scenes) return [];
        if (typeof scenes === 'string') return [scenes];
        if (!Array.isArray(scenes)) {
            // Could be an object with a title/scenes structure from Longform folders
            if (typeof scenes === 'object' && scenes.scenes) {
                return this.flattenScenes(scenes.scenes);
            }
            if (typeof scenes === 'object' && scenes.title) {
                return [scenes.title];
            }
            return [];
        }

        const result: string[] = [];
        for (const item of scenes) {
            if (typeof item === 'string') {
                result.push(item);
            } else if (Array.isArray(item)) {
                result.push(...this.flattenScenes(item));
            } else if (typeof item === 'object' && item !== null) {
                // Longform folder structure: { title: "folder", scenes: [...] }
                if (item.title) result.push(item.title);
                if (item.scenes) result.push(...this.flattenScenes(item.scenes));
                // Also handle any other keys that might contain arrays
                for (const key of Object.keys(item)) {
                    if (key !== 'title' && key !== 'scenes' && Array.isArray(item[key])) {
                        result.push(...this.flattenScenes(item[key]));
                    }
                }
            }
        }
        return result;
    }
    
    public getReference(label: string): FencedDivProjectEntry | undefined {
        return this.globalLabelIndex.get(label);
    }
    
    public getAllReferences(): IterableIterator<FencedDivProjectEntry> {
        return this.globalLabelIndex.values();
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

    public getProjectEntries(filePath: string): FencedDivProjectEntry[] {
        const projectPath = this.resolveProjectPath(filePath);
        if (!projectPath) return [];

        const scenes = this.projectScenes.get(projectPath);
        if (!scenes) return [];

        const allEntries: FencedDivProjectEntry[] = [];
        for (const path of scenes) {
            const entries = this.fileDivCache.get(path);
            if (entries) {
                allEntries.push(...entries);
            }
        }
        return allEntries;
    }
    
    public getProjectEquations(filePath: string): EquationPanelItem[] {
        const projectPath = this.resolveProjectPath(filePath);
        if (!projectPath) return [];

        const scenes = this.projectScenes.get(projectPath);
        if (!scenes) return [];

        const allEntries: EquationPanelItem[] = [];
        for (const path of scenes) {
            const entries = this.fileEquationCache.get(path);
            if (entries) {
                allEntries.push(...entries);
            }
        }
        return allEntries;
    }
    
    public getEquationReference(label: string): EquationPanelItem | undefined {
        return this.globalEquationIndex.get(label);
    }
    
    public getAllEquationReferences(): IterableIterator<EquationPanelItem> {
        return this.globalEquationIndex.values();
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
        for (const path of scenes) {
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
        for (const path of scenes) {
            const entries = this.fileFigureCache.get(path);
            if (entries) allEntries.push(...entries);
        }
        return allEntries;
    }

    public getFigureReference(label: string): FigureEntry | undefined {
        return this.globalFigureIndex.get(label);
    }

    public getAllFigureReferences(): IterableIterator<FigureEntry> {
        return this.globalFigureIndex.values();
    }

    public getProjectCitations(filePath: string): CitationEntry[] {
        const projectPath = this.resolveProjectPath(filePath);
        if (!projectPath) return this.fileCitationCache.get(filePath) || [];

        const scenes = this.projectScenes.get(projectPath);
        if (!scenes) return this.fileCitationCache.get(filePath) || [];

        const allEntries: CitationEntry[] = [];
        for (const path of scenes) {
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
        this.globalLabelIndex.clear();
        this.globalEquationIndex.clear();
        this.globalFigureIndex.clear();
        this.globalCitationIndex.clear();
        this.fileToProject.clear();
        this.projectScenes.clear();

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

    public getProjectScenes(filePath: string): string[] {
        const projectPath = this.fileToProject.get(filePath);
        if (!projectPath) return [];
        return this.getProjectScenesByPath(projectPath);
    }

    public getProjectScenesByPath(projectPath: string): string[] {
        return this.projectScenes.get(projectPath) || [];
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

    private async loadGlobalCitationCache() {
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

    /**
     * Creates a new file in the project folder and adds it to the Longform index.
     * @param projectPath The path to the project root folder.
     * @param insertAfterFilePath The path of the file after which the new one should be inserted.
     */
    public async addNewFileToProject(projectPath: string, insertAfterFilePath: string): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(projectPath);
        if (!(folder instanceof TFolder)) return;

        const indexFile = folder.children.find(c => c instanceof TFile && (c.name.toLowerCase() === 'index.md' || c.name === 'longform.json')) as TFile | undefined;
        if (!indexFile) return;

        // Generate a unique filename
        let fileName = 'New Scene.md';
        let counter = 1;
        while (await this.app.vault.adapter.exists(`${projectPath}/${fileName}`)) {
            fileName = `New Scene ${counter++}.md`;
        }

        const newFilePath = `${projectPath}/${fileName}`;
        const newFile = await this.app.vault.create(newFilePath, '# New Scene\n');

        // Update Index.md scenes list
        const insertAfterBasename = insertAfterFilePath.split('/').pop()?.replace(/\.md$/, '');
        const newFileBasename = fileName.replace(/\.md$/, '');

        await this.app.fileManager.processFrontMatter(indexFile, (fm) => {
            if (!fm.longform || !Array.isArray(fm.longform.scenes)) return;

            const scenes = fm.longform.scenes;
            const index = scenes.indexOf(insertAfterBasename);
            if (index !== -1) {
                scenes.splice(index + 1, 0, newFileBasename);
            } else {
                scenes.push(newFileBasename);
            }
        });

        // Trigger a re-scan of the project
        await this.scanProject(folder);
        
        // Open the new file
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(newFile);
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


