# Repository Guidelines for LLM Coding Agents

> This file is the canonical reference for any LLM coding agent (Claude, Gemini, GPT, Copilot, etc.) working on this codebase. Read it **before** writing any code.

---

## 1. Project Overview

This is an **Obsidian plugin** written in TypeScript that adds Pandoc extended markdown syntax to Obsidian's Live Preview and Reading mode, and natively exports to TeX/HTML. It ships as a single `main.js` bundle produced by esbuild.

Key domains:
- **Heading Numbering** (hierarchical numbering for TOC and exports)
- **Fenced div blocks** (`::: {.class #id}`) with numbered cross-file `@label` references
- **Equation labelling** (`$$ ... % #eq:label $$`) with `@eq:label` references
- **Figure referencing** (`![[img|fig:label]]`) with `@fig:label` references
- **Longform project integration** (multi-file indexing, global numbering, persistent cache, automated scene merging)
- **Pandoc Exporter** (direct to `~/Downloads` export with custom Lua filters)
- **Sidebar panel** (TOC, fenced divs, equations, figures, export configuration)

---

## 2. Project Structure

```
├── src/
│   ├── core/                          # Plugin entry point and global state
│   │   ├── main.ts                    # Plugin class (onload, onunload)
│   │   ├── settings.ts                # Settings tab UI and persistence
│   │   ├── constants.ts               # Re-exports from constants/
│   │   ├── constants/
│   │   │   ├── listConstants.ts       # LIST_MARKERS, LIST_TYPES, INDENTATION
│   │   │   └── cssConstants.ts        # CSS_CLASSES, COMPOSITE_CSS, DECORATION_STYLES
│   │   └── state/
│   │       ├── pluginStateManager.ts  # Per-document state (example counters, custom labels)
│   │       └── longformProjectManager.ts  # Singleton: Longform project detection, caching, numbering
│   │
│   ├── live-preview/                  # CodeMirror 6 integration (ViewPlugin)
│   │   ├── extension.ts              # CM6 extension entry point
│   │   ├── pipeline/
│   │   │   ├── ProcessingPipeline.ts  # Two-phase pipeline orchestrator
│   │   │   ├── types.ts              # ProcessingContext, ContentRegion, InlineMatch
│   │   │   ├── structural/           # Phase 1: block-level processors
│   │   │   │   ├── FencedDivProcessor.ts
│   │   │   │   └── ...               # Hash, Fancy, Example, Definition, CustomLabel, etc.
│   │   │   ├── inline/               # Phase 2: inline processors
│   │   │   │   └── FencedDivReferenceProcessor.ts  # @label, @eq:, @fig:
│   │   │   └── utils/
│   │   ├── scanners/                  # Content scanners (fencedDivScanner)
│   │   ├── validators/               # Strict mode validation
│   │   └── widgets/                   # CM6 WidgetType implementations
│   │       ├── BaseWidget.ts          # Common widget base class
│   │       └── fencedDivWidget.ts     # FencedDivHeaderWidget, FencedDivReferenceWidget
│   │
│   ├── reading-mode/                  # Post-processor for rendered HTML
│   │   ├── processor.ts              # Public entry point
│   │   ├── pipeline/
│   │   │   ├── ReadingModePipeline.ts # Processor registry and runner
│   │   │   ├── registry.ts           # Default processor set
│   │   │   ├── processors/           # Block/DOM processors
│   │   │   └── inline/               # Inline text replacement processors
│   │   ├── parsers/                   # Feature-specific parsers
│   │   └── utils/                     # DOM helpers
│   │
│   ├── editor-extensions/             # Editor behaviours
│   │   └── suggestions/
│   │       └── fencedDivReferenceSuggest.ts  # Fuzzy-matching @ suggester
│   │
│   ├── views/                         # UI components
│   │   ├── panels/
│   │   │   ├── ListPanelView.ts       # Sidebar panel host (tabs, actions)
│   │   │   ├── modules/
│   │   │   │   ├── BasePanelModule.ts # Abstract base for panel tabs
│   │   │   │   ├── PanelTypes.ts      # PanelModule interface
│   │   │   │   ├── TocPanelModule.ts  # Table of Contents panel
│   │   │   │   ├── FencedDivPanelModule.ts
│   │   │   │   └── EquationPanelModule.ts
│   │   │   └── utils/
│   │   │       ├── contentTruncator.ts   # Smart truncation with math awareness
│   │   │       └── viewInteractions.ts   # renderContentWithMath, setupLabelClickHandler
│   │   └── editor/
│   │       └── highlightUtils.ts      # Line highlighting for navigation
│   │
│   └── shared/                        # Cross-module utilities
│       ├── patterns.ts                # ListPatterns class (all regex patterns)
│       ├── extractors/
│       │   ├── fencedDivExtractor.ts   # Parse ::: blocks from raw content
│       │   ├── equationExtractor.ts    # Parse $$ blocks with % #eq:label
│       │   ├── figureExtractor.ts      # Parse ![[...|fig:label]] and ![fig:label](...)
│       │   └── sectionExtractor.ts     # Parse headings (H1–H5) for TOC
│       ├── rendering/
│       │   └── ContentProcessorRegistry.ts
│       ├── types/
│       │   ├── fencedDivTypes.ts       # FencedDivReference, FencedDivSuggestion
│       │   └── settingsTypes.ts        # isSyntaxFeatureEnabled, normalizeSettings
│       └── utils/
│           ├── errorHandler.ts         # withErrorBoundary, withAsyncErrorBoundary
│           ├── hoverPopovers.ts        # setupRenderedHoverPreview (cmd+hover)
│           ├── mathRenderer.ts         # LaTeX to text conversion for truncation
│           └── cursorUtils.ts          # Cursor position helpers
│
├── styles.css                         # All plugin CSS
├── tests/
│   ├── unit/                          # Jest unit tests
│   ├── integration/                   # Jest integration tests
│   └── e2e/                           # WebdriverIO E2E tests
├── __mocks__/                         # Shared Jest mocks
├── lua_filter/                        # Directory for Pandoc Lua filters
├── esbuild.config.mjs                 # Build configuration
├── tsconfig.json                      # TypeScript configuration
└── manifest.json                      # Obsidian plugin manifest
```

---

## 3. Build, Test, and Development Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `npm run dev` | esbuild watch mode for local development |
| `npm run build` | Production build → `main.js` |
| `npm run lint` | ESLint check |
| `npm test` | Jest unit/integration tests |
| `npm run test:e2e` | WebdriverIO E2E tests |
| `npm run test:e2e:dev` | E2E tests with verbose logging |
| `npm run test:all` | All tests (unit + integration + E2E) |

### Deploying to a Vault
```bash
cp main.js manifest.json styles.css \
  ~/path-to-vault/.obsidian/plugins/academic-pandoc-markdown/
```
Then reload Obsidian (Cmd+R or toggle the plugin off/on).

---

## 4. Coding Style & Conventions

### Language and Formatting
- **TypeScript-first**. Follow ESLint rules in `eslint.config.mjs`.
- **4-space indentation**, single quotes, semicolons.
- Existing code uses these conventions consistently — match them.

### Naming
| Element | Convention | Example |
|---------|-----------|---------|
| Classes, interfaces, types | `PascalCase` | `FencedDivProcessor`, `PanelModule` |
| Functions, variables | `camelCase` | `extractFencedDivs`, `globalLabelIndex` |
| Constants | `UPPER_SNAKE_CASE` | `CSS_CLASSES`, `LIST_MARKERS` |
| Files | `camelCase.ts` or `PascalCase.ts` | Match existing pattern in the directory |

### Import Order
```typescript
// 1. External (obsidian, @codemirror/*)
import { Plugin } from 'obsidian';
// 2. Types
import type { ProcessingContext } from '../pipeline/types';
// 3. Constants
import { CSS_CLASSES, MESSAGES } from '../../core/constants';
// 4. Patterns
import { ListPatterns } from '../../shared/patterns';
// 5. Utils
import { withErrorBoundary } from '../../shared/utils/errorHandler';
// 6. Internal (siblings, children)
import { BaseWidget } from './BaseWidget';
```

### Size Limits
- **Files**: ≤ 400 lines. Split into subdirectories if larger.
- **Functions**: ≤ 50 lines. Use Extract Method pattern.

### Error Handling
Always use centralized error handlers:
```typescript
// Sync
return withErrorBoundary(() => { /* ... */ }, fallbackValue, 'context');

// Async
return await withAsyncErrorBoundary(async () => { /* ... */ }, fallback, 'context');
```

### Feature Flags
Gate all new syntax behind `isSyntaxFeatureEnabled(settings, 'featureKey')`. This is the single source of truth for whether a feature is active.

---

## 5. Architecture Essentials

### Processing Pipeline (Live Preview)

The Live Preview mode uses a **two-phase pipeline** via `ProcessingPipeline.ts`:

1. **Phase 1 — Structural**: Block-level processors run in priority order. Each processor inspects a line and optionally produces CodeMirror `Decoration`s (line decorations, marker replacement widgets, content regions).

2. **Phase 2 — Inline**: Inline processors receive content regions from Phase 1 and produce character-level decorations (references, superscript, subscript).

### State Management

| Manager | Scope | Purpose |
|---------|-------|---------|
| `PluginStateManager` | Per-document | Example list counters, custom label maps, strict mode state |
| `LongformProjectManager` | Global singleton | Project detection, multi-file caching (divs, equations, figures, sections), global numbering, persistent `.pem-cache.json` |

### Longform Integration

`LongformProjectManager` (singleton) handles:
1. **Project detection**: Walks parent directories for `Index.md` with `longform` YAML frontmatter
2. **Scene ordering**: Reads `frontmatter.longform.scenes` array, flattens nested structures
3. **File caching**: Extracts fenced divs, equations, figures, sections per scene file
4. **Global numbering**: Numbers blocks by class (Theorem 1, Definition 1, …), equations, figures across all scenes in index order
5. **Persistent cache**: `.pem-cache.json` in project directory, debounced 5s save
6. **Force reload**: Clears all caches and re-scans from scratch

### Sidebar Panel Architecture

`ListPanelView` hosts modular tab panels. All panels extend `BasePanelModule`:

```
ListPanelView (host)
├── Top bar: tab buttons + module actions + reload
├── Content container: active panel renders here
└── Panels: TocPanelModule, FencedDivPanelModule, EquationPanelModule, FigurePanelModule, ExportPanelModule
```

Each module implements:
- `extractData(content)`: Parse raw markdown
- `renderContent(activeView)`: Build DOM in the content container
- `renderActions?(actionsEl, activeView)`: Inject toggle buttons into the top bar

---

## 6. Key Patterns and Gotchas

### Adding a New Extractable Type (e.g., a new block type)

1. Create `src/shared/extractors/myExtractor.ts` with `extractMyType(content): MyEntry[]` and `numberMyType(entries): MyEntry[]`
2. Add cache maps and getters to `LongformProjectManager`
3. Call your extractor in `updateFileCache()` and your numberer in `recalculateNumbering()`
4. Update `persistProjectCache()` and `loadProjectCache()` with the new cache key
5. Update `forceReload()` to clear the new cache
6. Add to the suggester (`fencedDivReferenceSuggest.ts`) for autocomplete
7. Add to `FencedDivReferenceProcessor.resolveLabel()` and `createDecoration()` for live preview rendering
8. Optionally create a new panel module extending `BasePanelModule`

### Adding a New Panel Tab

1. Create `src/views/panels/modules/MyPanelModule.ts` extending `BasePanelModule`
2. Implement `extractData()`, `renderContent()`, optionally `renderActions()`
3. Register in `ListPanelView.initializePanels()` with an `id`, `displayName`, and `icon`
4. Add CSS classes to `styles.css`
5. Add icon constant to `core/constants.ts` if needed

### Hover Previews

- **Cmd+hover** (not simple hover) shows rendered markdown popover
- Use `setupRenderedHoverPreview()` from `hoverPopovers.ts`
- The function detects `metaKey` on `mousemove` events

### CSS Organization

All CSS lives in `styles.css` (root level). Sections are delimited by `/* ═══ Section Name ═══ */` comments. Key class prefixes:
- `pem-` — general plugin namespace
- `pem-panel-` — sidebar panel elements
- `pem-block-` — fenced div block elements
- `pem-eq-` — equation panel elements
- `pem-toc-` — table of contents elements
- `pem-suggest-` — suggester dropdown elements

### Content Truncation with Math

`contentTruncator.ts` provides `truncateContentWithRendering()` that handles LaTeX `$...$` correctly — it calculates rendered length of math expressions rather than raw character count, preventing mid-expression truncation.

---

## 7. Testing Guidelines

- **Jest** covers unit and integration tests.
- **WebdriverIO + Mocha** covers E2E tests.
- Test placement:
  - `tests/unit/` — Mock dependencies, test individual functions/classes
  - `tests/integration/` — Test component interactions
  - `tests/e2e/specs/` — Test in a real Obsidian environment
- Naming: `.spec.ts` for most tests, `.test.ts` for some feature tests (match the local folder pattern), `.e2e.ts` for E2E.
- Reuse mocks in `__mocks__/` where possible.

---

## 8. Commit & Pull Request Guidelines

- **Commit messages**: Short, imperative, one-line (e.g., "Fix equation rendering in side panel", "Add figure extractor").
- **Before committing**: Run `npm run lint` and resolve all errors.
- **PR checklist**:
  - Concise summary of changes
  - Testing notes (commands + results)
  - Linked issues when applicable
  - Screenshots/GIFs for UI or CSS changes
  - Updated `README.md` and `ARCHITECTURE.md` when behaviour or structure changes

---

## 9. Common Mistakes to Avoid

| Mistake | Correct Approach |
|---------|-----------------|
| Hardcoding CSS class strings | Use `CSS_CLASSES` from `core/constants` |
| Hardcoding UI text | Use `MESSAGES` from `core/constants` |
| Using `any` type freely | Define proper interfaces; only `any` with documented justification |
| Simple hover for previews | Use `setupRenderedHoverPreview` with cmd+hover |
| Using `startsWith` for fuzzy matching | Use the `fuzzyMatch` helper in the suggester |
| Adding state to widgets | Widgets are ephemeral; use `PluginStateManager` or `LongformProjectManager` |
| Putting CSS in TypeScript | All CSS in `styles.css`; only dynamic styles via inline styles |
| Forgetting H6 exclusion | H6 (`######`) is reserved for paragraphs — never index or number it |
| Not gating features | All syntax features must check `isSyntaxFeatureEnabled()` |
| Modifying `main.js` directly | This is a build artifact; edit TypeScript sources in `src/` |

---

## 10. File Quick Reference

| File | Purpose | When to Modify |
|------|---------|---------------|
| `src/core/main.ts` | Plugin lifecycle (onload/onunload) | Adding new commands, extensions, or views |
| `src/core/settings.ts` | Settings tab UI | Adding new user-facing toggles |
| `src/core/constants.ts` | All constants index | Adding new CSS classes, messages, UI values |
| `src/core/state/longformProjectManager.ts` | Multi-file project state | Adding new extractable types, changing numbering |
| `src/core/state/pluginStateManager.ts` | Per-document state | Adding document-scoped counters or maps |
| `src/live-preview/extension.ts` | CM6 extension entry | Registering new processors |
| `src/live-preview/pipeline/ProcessingPipeline.ts` | Pipeline orchestrator | Changing processor execution order |
| `src/live-preview/pipeline/inline/FencedDivReferenceProcessor.ts` | `@label` rendering | Adding new reference prefixes (e.g., `@fig:`) |
| `src/editor-extensions/suggestions/fencedDivReferenceSuggest.ts` | `@` autocomplete | Adding new suggestion sources |
| `src/views/panels/ListPanelView.ts` | Sidebar host | Adding/removing panel tabs, changing layout |
| `src/views/panels/modules/BasePanelModule.ts` | Panel base class | Changing shared panel behaviour |
| `src/shared/extractors/*.ts` | Content extractors | Adding new extractable patterns |
| `src/shared/utils/hoverPopovers.ts` | Hover preview system | Changing hover behaviour |
| `styles.css` | All plugin CSS | Any visual changes |
