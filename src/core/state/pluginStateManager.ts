/**
 * Unified Plugin State Manager
 * 
 * Single source of truth for all plugin state including:
 * - Document-specific counters and data
 * - View mode tracking per leaf
 * - Mode transition detection
 */

// External libraries
import { MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { FencedDivReference } from '../../shared/types/fencedDivTypes';
import { EquationPanelItem } from '../../shared/extractors/equationExtractor';

// Types
import { ViewMode, DocumentCounters, ViewState, ModeChangeEvent } from '../../shared/types/settingsTypes';

// Constants
import { UI_CONSTANTS } from '../constants';

// Utils removed

type ModeChangeCallback = (event: ModeChangeEvent) => void;

/**
 * Centralized document state shared between live preview, reading mode, and auxiliary UI.
 *
 * CodeMirror state only exists while an editor is mounted, which means it cannot be used to
 * coordinate features that also run when the document is rendered in reading mode or when the
 * side panel requests metadata for inactive files. This manager keeps document counters,
 * placeholder contexts, and processed-element tracking in one place so every rendering surface
 * can consume the same data without having to keep a CodeMirror editor alive.
 *
 * It also tracks mode transitions at the leaf level so we can reset counters when a file changes
 * or when the user toggles editing modes, guaranteeing that reading-mode DOM and live-preview
 * decorations stay consistent without relying on deprecated workspace APIs.
 */
export class PluginStateManager {
    // Document-specific counters
    private documentCounters = new Map<string, DocumentCounters>();
    
    // View state tracking per leaf
    private viewStates = new Map<string, ViewState>();
    
    // Mode change listeners
    private modeChangeListeners: Set<ModeChangeCallback> = new Set();
    
    // Track processed elements to prevent duplicate counter increments
    private processedElements = new WeakMap<Element, Map<string, unknown>>();
    
    // Track which documents need element reprocessing
    private documentsNeedingReprocess = new Set<string>();

    /**
     * Get or create counters for a document
     */
    getDocumentCounters(docPath: string): DocumentCounters {
        if (!this.documentCounters.has(docPath)) {
            this.documentCounters.set(docPath, this.createEmptyCounters());
        }
        return this.documentCounters.get(docPath)!;
    }

    /**
     * Reset counters for a specific document
     */
    resetDocumentCounters(docPath: string): void {
        if (this.documentCounters.has(docPath)) {
            const counters = this.documentCounters.get(docPath)!;
            counters.fencedDivLabels.clear();
        }
        // Mark that this document needs reprocessing
        this.documentsNeedingReprocess.add(docPath);
    }

    /**
     * Clear counters for a document (remove from memory)
     */
    clearDocumentCounters(docPath: string): void {
        this.documentCounters.delete(docPath);
        // Also clean up the reprocess flag when document is closed
        this.documentsNeedingReprocess.delete(docPath);
    }

    /**
     * Update view state and detect mode/document changes
     */
    updateViewState(leaf: WorkspaceLeaf): ModeChangeEvent | null {
        const leafId = this.getLeafId(leaf);
        const view = leaf.view as MarkdownView;
        
        const currentMode = this.detectViewMode(view);
        const currentPath = view.file?.path || null;
        
        const previous = this.viewStates.get(leafId);
        const previousMode = previous?.mode || null;
        const previousPath = previous?.filePath || null;
        
        // Update state
        this.viewStates.set(leafId, {
            mode: currentMode,
            filePath: currentPath
        });
        
        // Check for changes
        const modeChanged = previousMode !== currentMode;
        const pathChanged = previousPath !== currentPath;
        
        if (modeChanged || pathChanged) {
            const event: ModeChangeEvent = {
                leafId,
                previousMode,
                currentMode,
                previousPath,
                currentPath
            };
            
            // Handle state transitions
            this.handleStateTransition(event);
            
            // Notify listeners
            this.notifyModeChange(event);
            
            return event;
        }
        
        return null;
    }

    /**
     * Handle state transitions (e.g., reset counters)
     */
    private handleStateTransition(event: ModeChangeEvent): void {
        // Don't reset placeholder context on mode transitions
        // Let the scanner handle resets based on actual content changes
        
        // Reset OTHER counters when exiting reading mode
        if (event.previousMode === "reading" && event.currentMode !== "reading") {
            if (event.previousPath) {
                // Only reset non-placeholder counters
                if (this.documentCounters.has(event.previousPath)) {
                    const counters = this.documentCounters.get(event.previousPath)!;
                    counters.fencedDivLabels.clear();
                }
                // Mark that this document needs reprocessing
                this.documentsNeedingReprocess.add(event.previousPath);
            }
        }
        
        // Reset counters when switching documents
        if (event.previousPath && 
            event.currentPath && 
            event.previousPath !== event.currentPath) {
            // When switching documents, reset the new document's counters
            this.resetDocumentCounters(event.currentPath);
        }
        
        // Clear reprocess flag when entering reading mode
        if (event.currentMode === "reading" && event.currentPath) {
            // Give a small delay to ensure all elements are ready
            window.setTimeout(() => {
                this.clearReprocessFlag(event.currentPath!);
            }, UI_CONSTANTS.STATE_TRANSITION_DELAY_MS);
        }
    }

    /**
     * Register a mode change listener
     */
    onModeChange(callback: ModeChangeCallback): () => void {
        this.modeChangeListeners.add(callback);
        // Return unsubscribe function
        return () => {
            this.modeChangeListeners.delete(callback);
        };
    }

    /**
     * Notify all mode change listeners
     */
    private notifyModeChange(event: ModeChangeEvent): void {
        this.modeChangeListeners.forEach(callback => callback(event));
    }



    /**
     * Mark an element as processed to prevent duplicate processing
     */
    markElementProcessed(element: Element, key: string, value: unknown): void {
        if (!this.processedElements.has(element)) {
            this.processedElements.set(element, new Map());
        }
        this.processedElements.get(element)!.set(key, value);
    }

    /**
     * Check if an element has been processed
     */
    isElementProcessed(element: Element, key: string, docPath?: string): boolean {
        // If document needs reprocessing, always return false
        if (docPath && this.documentsNeedingReprocess.has(docPath)) {
            return false;
        }
        return this.processedElements.has(element) && 
               this.processedElements.get(element)!.has(key);
    }
    
    /**
     * Clear reprocess flag for a document after processing
     */
    clearReprocessFlag(docPath: string): void {
        this.documentsNeedingReprocess.delete(docPath);
    }

    /**
     * Get processed element data
     */
    getProcessedElementData(element: Element, key: string): unknown {
        if (this.processedElements.has(element)) {
            return this.processedElements.get(element)!.get(key);
        }
        return undefined;
    }

    /**
     * Scan all leaves and update states
     * Returns true if any mode changes were detected
     */
    scanAllLeaves(leaves: WorkspaceLeaf[]): boolean {
        let anyChanges = false;
        for (const leaf of leaves) {
            if (leaf.view?.getViewType() === "markdown") {
                const event = this.updateViewState(leaf);
                if (event) {
                    anyChanges = true;
                }
            }
        }
        return anyChanges;
    }



    /**
     * Clear all states (for plugin unload)
     */
    clearAllStates(): void {
        this.documentCounters.clear();
        this.viewStates.clear();
        this.modeChangeListeners.clear();
    }

    /**
     * Create empty counters object
     */
    private createEmptyCounters(): DocumentCounters {
        return {
            fencedDivLabels: new Map(),
            equationLabels: new Map()
        };
    }

    /**
     * Detect the current view mode from a MarkdownView
     */
    private detectViewMode(view: MarkdownView): ViewMode {
        const state = view.getState();
        if (state?.mode === "preview") return "reading";
        if (state?.mode === "source") {
            // Live Preview vs Source is encoded in 'source' boolean
            return state.source ? "source" : "live";
        }
        // Fallback
        return (view.getMode() === "preview") ? "reading" : "live";
    }

    /**
     * Get a stable ID for a leaf
     */
    private getLeafId(leaf: WorkspaceLeaf): string {
        // Use leaf.id if available (newer Obsidian versions)
        if ('id' in leaf && leaf.id) {
            return leaf.id as string;
        }
        // Fallback: create a unique key
        const view = leaf.view as MarkdownView;
        return `${view?.file?.path ?? "unknown"}::${Math.random()}`;
    }
}

// Export singleton instance
export const pluginStateManager = new PluginStateManager();
