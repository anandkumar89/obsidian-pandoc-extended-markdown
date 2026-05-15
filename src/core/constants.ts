/**
 * Central constants index file
 * Re-exports constants from split files and defines remaining constants
 */

// Core list-related constants removed

// CSS and styling constants
export { CSS_CLASSES, COMPOSITE_CSS, DECORATION_STYLES } from './constants/cssConstants';

// Add missing syntax markers
export const SYNTAX_MARKERS = {
    CUSTOM_LABEL_OPEN: '{::',
    CUSTOM_LABEL_CLOSE: '}}',
    CUSTOM_LABEL_BRACKET_CLOSE: '}',
    EXAMPLE_LIST_OPEN: '(@',
    EXAMPLE_LIST_CLOSE: ')',
    ELLIPSIS: '…',
    DEFINITION_LIST_COLON: 'DL:',
} as const;

// Messages and user-facing strings
export const MESSAGES = {
    // Success messages
    FORMAT_SUCCESS: 'Document formatted to pandoc standard',
    FORMAT_ALREADY_COMPLIANT: 'Document already follows pandoc standard',
    PANDOC_COMPLIANT: 'Document follows pandoc formatting standards',
    TOGGLE_BOLD_SUCCESS: 'Definition terms bold style toggled',
    TOGGLE_UNDERLINE_SUCCESS: 'Definition terms underline style toggled',
    LABEL_COPIED: 'Label copied to clipboard',

    // Error messages
    NO_DEFINITION_TERMS: 'No definition terms found to toggle',

    // View messages
    NO_ACTIVE_FILE: 'No active file',
    NO_CUSTOM_LABELS: 'No custom labels found',
    NO_EXAMPLE_LISTS: 'No example lists found',
    NO_DEFINITION_LISTS: 'No definition lists found',
    NO_FENCED_DIVS: 'No fenced divs found',
    NO_FOOTNOTES: 'No footnotes found',
    NO_CITATIONS: 'No citations found',
    FOOTNOTE_REFERENCE_NOT_FOUND: 'No matching footnote reference found',
    LIST_PANEL_DISABLED: 'List panel is disabled in settings',
    CUSTOM_LABELS_VIEW_TITLE: 'Custom Labels',
    EXAMPLE_LISTS_VIEW_TITLE: 'Example Lists',
    DEFINITION_LISTS_VIEW_TITLE: 'Definition Lists',
    FENCED_DIVS_VIEW_TITLE: 'Fenced Divs',
    FOOTNOTE_VIEW_TITLE: 'Footnotes',
    CITATIONS_VIEW_TITLE: 'Citations',

    // Formatting issue messages
    FORMATTING_ISSUES: (count: number) => `Found ${count} formatting issues`,
} as const;

// Command identifiers
export const COMMANDS = {
    CHECK_PANDOC: 'check-pandoc-formatting',
    FORMAT_PANDOC: 'format-to-pandoc-standard',
    TOGGLE_DEFINITION_BOLD: 'toggle-definition-bold-style',
    TOGGLE_DEFINITION_UNDERLINE: 'toggle-definition-underline-style',
    OPEN_LIST_PANEL: 'open-list-panel',
    EXPORT_PANDOC: 'export-to-pandoc',
} as const;

// Settings keys
export const SETTINGS = {
    STRICT_MODE: 'strictPandocMode',
    AUTO_RENUMBER: 'autoRenumberLists',
    HASH_AUTO_NUMBER: 'enableHashAutoNumber',
    FANCY_LISTS: 'enableFancyLists',
    EXAMPLE_LISTS: 'enableExampleLists',
    DEFINITION_LISTS: 'enableDefinitionLists',
    FENCED_DIVS: 'enableFencedDivs',
    SUPERSCRIPT: 'enableSuperscript',
    SUBSCRIPT: 'enableSubscript',
    CUSTOM_LABEL: 'enableCustomLabelLists',
    CITATIONS: 'enableCitations',
    UNORDERED_LIST_MARKER_ORDER: 'unorderedListMarkerOrder',
    ORDERED_LIST_MARKER_CYCLING: 'enableOrderedListMarkerCycling',
    ORDERED_LIST_MARKER_ORDER: 'orderedListMarkerOrder',
    LIST_PANEL: 'enableListPanel',
    PANEL_ORDER: 'panelOrder',
} as const;

// Settings UI text
export const SETTINGS_UI = {
    SYNTAX_FEATURES: {
        NAME: 'Syntax features',
        DESCRIPTION: 'Choose which Pandoc syntaxes the plugin should recognize and render.'
    },
    FENCED_DIVS: {
        NAME: 'Fenced Blocks',
        DESCRIPTION: 'Enable Pandoc fenced div blocks such as ::: {.theorem} and @label references.'
    },
    HEADING_NUMBERING: {
        NAME: 'Heading Numbering',
        DESCRIPTION: 'Show computed heading numbers in Live Preview and Reading mode.'
    },
    CITATIONS: {
        NAME: 'Citations',
        DESCRIPTION: 'Enable Pandoc citation extraction and integration with ZotLit.'
    },
    PANEL_FEATURES: {
        NAME: 'Sidebar Panel',
        DESCRIPTION: 'Configure the academic sidebar panel behavior.'
    },
    LIST_PANEL: {
        NAME: 'Enable Sidebar',
        DESCRIPTION: 'Show/hide the academic sidebar panel (TOC, Blocks, Equations, Figures).'
    },
    PANDOC_SETTINGS: {
        NAME: 'Pandoc Export',
        DESCRIPTION: 'Configure Pandoc export settings.',
        PATH_NAME: 'Pandoc path',
        PATH_DESC: 'The path to the pandoc executable.',
        OUTPUT_NAME: 'Output directory',
        OUTPUT_DESC: 'The directory where exported files will be saved.',
        FORMAT_NAME: 'Default export format',
        FORMAT_DESC: 'The default format to use when exporting.'
    }
} as const;

// UI timing and sizing constants
export const UI_CONSTANTS = {
    NOTICE_DURATION_MS: 10000,
    STATE_TRANSITION_DELAY_MS: 100,
    MODE_REFRESH_DELAY_MS: 20,
    HIGHLIGHT_ANIMATION_DURATION_MS: 2000,
    // Custom Label View
    LABEL_MAX_LENGTH: 6,
    LABEL_TRUNCATION_LENGTH: 5,  // Length before adding ellipsis
    // Definition List View
    TERM_MAX_LENGTH: 100,
    TERM_TRUNCATION_LENGTH: 99,  // Length before adding ellipsis
    DEFINITION_MAX_LENGTH: 300,
    DEFINITION_TRUNCATION_LENGTH: 299,  // Length before adding ellipsis
    // Indentation
    MARKDOWN_INDENT_SIZE: 4,  // Standard markdown indent for continuations
    // Icon dimensions
    PANEL_ICON_SIZE: 20,
    CONTENT_MAX_LENGTH: 51,
    CONTENT_TRUNCATION_LENGTH: 50,  // Length before adding ellipsis
    CONTENT_TRUNCATE_LINES: 3,
    UPDATE_DEBOUNCE_MS: 300,
    SELECTION_CLEAR_DELAY_MS: 300,
    SELECTION_FADE_DELAY_MS: 100,
    HIGHLIGHT_DURATION_MS: 2000,
    MAX_HOVER_WIDTH: '400px',
    MAX_HOVER_HEIGHT: '300px',
    HOVER_PADDING: '8px 12px',
    HOVER_Z_INDEX: '1000',
    // Hover positioning
    HOVER_OFFSET_BOTTOM: 5,
    HOVER_OFFSET_TOP: 5,
    HOVER_OFFSET_HORIZONTAL: 10,
    HOVER_CLEANUP_DELAY_MS: 100,
} as const;

// DOM-related attributes
export const DOM_ATTRIBUTES = {
    CONTENT_EDITABLE_FALSE: 'false',
    ELEMENT_DIV: 'div',
    OVERFLOW_AUTO: 'auto',
} as const;

// Math symbol mappings
export const MATH_SYMBOLS = {
    // LaTeX to Unicode mappings for math rendering
    LATEX_TO_UNICODE: {
        '\\therefore': '∴',
        '\\because': '∵',
        '\\alpha': 'α',
        '\\beta': 'β',
        '\\gamma': 'γ',
        '\\delta': 'δ',
        '\\epsilon': 'ε',
        '\\theta': 'θ',
        '\\lambda': 'λ',
        '\\mu': 'μ',
        '\\pi': 'π',
        '\\sigma': 'σ',
        '\\phi': 'φ',
        '\\psi': 'ψ',
        '\\omega': 'ω',
        '\\infty': '∞',
        '\\pm': '±',
        '\\times': '×',
        '\\div': '÷',
        '\\neq': '≠',
        '\\leq': '≤',
        '\\geq': '≥',
        '\\approx': '≈',
        '\\subset': '⊂',
        '\\supset': '⊃',
        '\\cup': '∪',
        '\\cap': '∩',
        '\\in': '∈',
        '\\notin': '∉',
        '\\exists': '∃',
        '\\forall': '∀',
        '\\land': '∧',
        '\\lor': '∨',
        '\\neg': '¬',
        '\\rightarrow': '→',
        '\\leftarrow': '←',
        '\\leftrightarrow': '↔',
        '\\Rightarrow': '⇒',
        '\\Leftarrow': '⇐',
        '\\Leftrightarrow': '⇔'
    } as const
} as const;

// Icon SVGs
export const ICONS = {
    CUSTOM_LABEL_SVG: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <text x="50" y="50"
              text-anchor="middle"
              dominant-baseline="central"
              font-family="monospace"
              font-size="48"
              font-weight="bold"
              fill="currentColor">
            {::}
        </text>
    </svg>`,
    EXAMPLE_LIST_SVG: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <text x="50" y="50"
              text-anchor="middle"
              dominant-baseline="central"
              font-family="monospace"
              font-size="58"
              font-weight="bold"
              fill="currentColor">
            (@)
        </text>
    </svg>`,
    DEFINITION_LIST_SVG: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <g fill="currentColor" font-family="monospace" font-weight="bold">
            <text x="30" y="45" font-size="40" text-anchor="middle">DL</text>
            <text x="70" y="65" font-size="48" text-anchor="middle">:</text>
        </g>
    </svg>`,
    FOOTNOTE_SVG: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <text x="50" y="55"
              text-anchor="middle"
              dominant-baseline="central"
              font-family="monospace"
              font-size="56"
              font-weight="bold"
              fill="currentColor">
            [^]
        </text>
    </svg>`,
    FENCED_DIV_SVG: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <text x="50" y="55"
              text-anchor="middle"
              dominant-baseline="central"
              font-family="monospace"
              font-size="62"
              font-weight="bold"
              fill="currentColor">
            :::
        </text>
    </svg>`,
    LIST_PANEL_ID: 'layout',
    CUSTOM_LABEL_ID: 'custom-label-list',
    LIST_PANEL_SVG: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-book"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6.5 2v20"/></svg>`,
    LIST_PANEL_ID_OLD: 'list-panel-view',
    EXPORT_ID: 'export-view',
    EXPORT_SVG: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
    CITATION_SVG: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`
} as const;


// Error codes
export const ERROR_CODES = {
    PARSE_ERROR: 'PARSE_ERROR',
    RENDER_ERROR: 'RENDER_ERROR',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    API_ERROR: 'API_ERROR',
    SETTINGS_ERROR: 'SETTINGS_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

// Error messages
export const ERROR_MESSAGES = {
    PLUGIN_PREFIX: 'Academic Pandoc Markdown',
    UNEXPECTED_ERROR: 'An unexpected error occurred',
    PARSE_FAILED: 'failed',
    COPY_FAILED: 'Failed to copy label',
    HIGHLIGHT_ERROR: 'Error highlighting line',
    SCROLL_ERROR: 'Error scrolling to label',
    WIDGET_CREATION_ERROR: 'Failed to create definition widget',
    DECORATION_ERROR: 'Failed to add decoration',
    INVALID_POSITION: 'Invalid decoration position',
    INVALID_MARKER_POSITION: 'Invalid marker positions for definition',
} as const;

// Console log messages
export const LOG_MESSAGES = {
    COPY_FAILED: 'Failed to copy label:',
    LABEL_CLICK_ERROR: 'Error in label click handler:',
    SCROLL_ERROR: 'Error scrolling to label:',
    HIGHLIGHT_ERROR: 'Error highlighting line:',
    WIDGET_CREATION_ERROR: 'Failed to create definition widget:',
    DECORATION_ERROR: 'Failed to add decoration at',
    INVALID_DECORATION_WARN: 'Invalid decoration position:',
    INVALID_MARKER_WARN: 'Invalid marker positions for definition:',
} as const;

// Numeric constants and thresholds
export const NUMERIC_CONSTANTS = {
    // Document validation
    MIN_DOC_POSITION: 0,

    // Position validation
    POSITION_TOLERANCE: 0,

    // Line processing
    LINE_PROCESSING_BATCH_SIZE: 100,

    // Content limits
    MAX_CONTENT_LENGTH: 1000,
    MAX_LABEL_LENGTH: 100,

    // Timer intervals
    DEBOUNCE_INTERVAL_MS: 100,
    SELECTION_TIMEOUT_MS: 50,

    // Character limits
    SINGLE_CHARACTER: 1,
    EMPTY_LENGTH: 0,

    // Array indices
    FIRST_INDEX: 0,
    SECOND_INDEX: 1,
    THIRD_INDEX: 2,

    // List processing
    LIST_NESTING_LEVEL: 1,
    MAX_NESTING_DEPTH: 10,
} as const;

// Text processing constants
export const TEXT_PROCESSING = {
    // Preview truncation
    PREVIEW_TRUNCATE_LENGTH: 30,
    PREVIEW_ELLIPSIS: '...',

    // Tab/space conversion
    TAB_EQUIVALENT_SPACES: 4,

    // Content extraction
    MIN_CONTENT_LENGTH: 1,

    // Text formatting
    LINE_SEPARATOR: '\n',
    SPACE_CHARACTER: ' ',
} as const;

// File and path constants
export const FILE_CONSTANTS = {
    EXTENSION_TS: '.ts',
    EXTENSION_MD: '.md',
    PATH_SEPARATOR: '/',
    EMPTY_STRING: '',
    SPACE: ' ',
    NEWLINE: '\n',
    TAB_CHARACTER: '\t',
} as const;

// Roman numeral conversion mappings
export const ROMAN_NUMERALS = {
    VALUES: {
        'i': 1, 'iv': 4, 'v': 5, 'ix': 9, 'x': 10,
        'xl': 40, 'l': 50, 'xc': 90, 'c': 100,
        'cd': 400, 'd': 500, 'cm': 900, 'm': 1000,
        'I': 1, 'IV': 4, 'V': 5, 'IX': 9, 'X': 10,
        'XL': 40, 'L': 50, 'XC': 90, 'C': 100,
        'CD': 400, 'D': 500, 'CM': 900, 'M': 1000
    },
    TO_ROMAN_UPPER: [
        [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
        [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
        [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
    ] as [number, string][],
    TO_ROMAN_LOWER: [
        [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
        [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
        [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
    ] as [number, string][]
} as const;

// Helper function to create fancy list type class names
export function getFancyListClass(type: string): string {
    return `pem-list-${type}`;
}
