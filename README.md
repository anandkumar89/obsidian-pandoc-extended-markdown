# Academic Pandoc Markdown Plugin for Obsidian

An Obsidian plugin tailored for academic writing. It renders specific [Pandoc extended markdown syntax](https://pandoc.org/MANUAL.html#pandocs-markdown) in Live Preview and Reading mode, and provides robust TeX and HTML export capabilities. Supports fenced divs with cross-file referencing, equation labelling, figure referencing, heading numbering, a modular sidebar panel with Table of Contents, and direct Pandoc exports.

## Features


### Fenced Divs and Block Referencing
```markdown
::: {.theorem #thm:main title="Main Result"}
Every compact metric space is complete.
:::

See @thm:main for the proof.
```
- Opening fence renders as **Theorem 1 (Main Result)**
- `@thm:main` renders as the numbered display name (e.g., **Theorem 1**)
- Cross-file referencing within [Longform](https://github.com/kevboh/longform) projects
- Global sequential numbering per class (Theorem 1, Definition 1, Definition 2, …)
- Fuzzy-matching suggester appears when typing `@`

### Equation Labelling and Referencing
```markdown
$$
E = mc^2 % #eq:einstein
$$

See @eq:einstein.
```
- Display-math blocks with `% #eq:label` are extracted and indexed
- `@eq:label` renders as `(eq:label)` in Live Preview
- Cross-file referencing and global numbering in Longform projects

### Figure Referencing
```markdown
![[plot.png|fig:main-result|desc:Convergence rates]]
![fig:comparison|desc:Before and after](images/compare.png)

See @fig:main-result and @fig:comparison.
```
- Wiki-link and standard markdown image syntax both supported
- `@fig:label` renders as **Figure N** in Live Preview
- Sequential numbering, cross-file support, and suggester integration

### Longform Project Integration

Full compatibility with the [Longform plugin](https://github.com/kevboh/longform) for multi-file writing projects:

- **Automatic project detection**: scans parent directories for `Index.md` with `longform` frontmatter
- **Cross-file referencing**: `@label`, `@eq:label`, and `@fig:label` resolve across all scenes
- **Global numbering**: blocks, equations, figures, and sections numbered sequentially across scenes in index order
- **Persistent caching**: `.pem-cache.json` stores indices per project; survives Obsidian restarts
- **Force reload**: sidebar button to rebuild all caches when numbering is stale

### Sidebar Panel

A modular sidebar with tab-based navigation:

| Tab | Icon | Content |
|-----|------|---------|
| **Table of Contents** | `§` | Hierarchical numbered headings (H1–H5); click to navigate; shows project indicator for Longform |
| **Fenced Divs** | `:::` | All labelled blocks with title, number, label, and content preview |
| **Equations** | `$$` | All tagged equations with rendered math preview |
| **Figures** | `📷` | All labeled figures |
| **Export** | `⤓` | Direct TeX/HTML Pandoc export configuration |

**Controls:**
- Toggle buttons (👁 preview, 📁 project scope) in top bar, right-aligned
- Force reload button `↻` for cache rebuild
- Click any entry to navigate to its location
- Click labels to copy reference syntax to clipboard
- Cmd+hover for rendered preview popover

### Native Pandoc TeX / HTML Export
Export your files or Longform projects cleanly and accurately directly to your `~/Downloads` folder.
- Converts fenced divs into proper LaTeX environments (e.g., `\begin{theorem} ... \end{theorem}`).
- Maps Markdown `######` (H6) directly into paragraphs.
- Combines Longform scenes automatically (stripping redundant frontmatter).
- Ensures correct LaTeX references via native `\label{}` mapping.

## Installation

### From Obsidian Community Plugins
1. Open Settings → Community plugins
2. Search for "Academic Pandoc Markdown"
3. Click Install and Enable

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create `academic-pandoc-markdown` in `.obsidian/plugins/`
3. Copy the downloaded files into the folder
4. Reload Obsidian and enable the plugin

## Usage Examples

### Fenced Divs with Cross-References
```markdown
::: {.definition #def:compact title="Compactness"}
A topological space is compact if every open cover has a finite subcover.
:::

::: {.theorem #thm:heine-borel}
A subset of $\mathbb{R}^n$ is compact iff it is closed and bounded.
:::

By @def:compact and @thm:heine-borel, the unit ball is compact.
```

### Equations with Labels
```markdown
$$
\nabla \cdot \mathbf{E} = \frac{\rho}{\epsilon_0} % #eq:gauss
$$

Gauss's law (@eq:gauss) relates charge density to electric field divergence.
```

### Figures
```markdown
![[results.png|fig:convergence|desc:Convergence analysis|title:Main Result]]

As shown in @fig:convergence, the algorithm converges in $O(n \log n)$.
```

```

## Settings

| Category | Setting | Description |
|----------|---------|-------------|
| **Syntax Features** | Fenced divs | Enable `:::` blocks and `@label` references |
| | Heading numbering | Enable hierarchical numbering of headings |
| **Pandoc Export** | Pandoc Path | Absolute path to your pandoc executable |
| | Default Output Format | Preferred export type (TeX, HTML, PDF, etc.) |
| **Panel Features** | Enable list panel | Toggle sidebar panel and ribbon icon |
| | Panel tab order | Drag to reorder panel tabs |

## Commands

| Command | Description |
|---------|-------------|
| Export to Pandoc | Initiates export of the active document/project |

## Development

### Building from Source
```bash
git clone https://github.com/ErrorTzy/obsidian-pandoc-extended-markdown
cd obsidian-pandoc-extended-markdown
npm install
npm run build        # Production build
npm run dev          # Dev mode with watch
npm test             # Unit/integration tests
npm run test:e2e     # E2E tests (WebdriverIO)
npm run lint         # ESLint
```

### Deploying Locally
```bash
cp main.js manifest.json styles.css \
  ~/path-to-vault/.obsidian/plugins/academic-pandoc-markdown/
```
Then reload Obsidian (Cmd+R or disable/re-enable the plugin).

### Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed technical documentation including the processing pipeline, state management, and extension guide.

### Agent Guidelines

See [AGENTS.md](AGENTS.md) for coding conventions, naming rules, and guidelines for LLM coding agents working on this codebase.

## Compatibility

- Requires Obsidian v1.4.0 or higher
- Works on desktop and mobile
- Compatible with the Longform plugin for multi-file projects
- Compatible with other Obsidian plugins

## License

MIT License — see [LICENSE](LICENSE)

## Acknowledgments

Built with Claude Code and Google Gemini. Maintained by Anand Kumar.
