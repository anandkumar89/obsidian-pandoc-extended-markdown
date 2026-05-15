import {
    PandocExtendedMarkdownSettings,
    isSyntaxFeatureEnabled
} from './settingsTypes';

/**
 * Processor Configuration
 * 
 * Configuration object passed to processors instead of the entire App object.
 * This improves testability and reduces coupling.
 */

export interface ProcessorConfig {
    // Obsidian settings
    strictLineBreaks: boolean;
    
    // Plugin settings
    strictPandocMode: boolean;
    
    // Optional features
    enableFencedDivs?: boolean;
}

/**
 * Create a ProcessorConfig from Obsidian App and plugin settings
 */
export function createProcessorConfig(
    vaultConfig: { strictLineBreaks?: boolean },
    pluginSettings: Partial<PandocExtendedMarkdownSettings>
): ProcessorConfig {
    return {
        strictLineBreaks: vaultConfig.strictLineBreaks ?? false,
        strictPandocMode: pluginSettings.strictPandocMode ?? false,
        enableFencedDivs: isSyntaxFeatureEnabled(pluginSettings, 'enableFencedDivs')
    };
}
