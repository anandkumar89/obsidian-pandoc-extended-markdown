import { App, TFile, Notice, normalizePath } from 'obsidian';
import { exec } from 'child_process';
import { join } from 'path';
import { LongformProjectManager } from '../../core/state/longformProjectManager';
import { PandocExtendedMarkdownSettings } from '../../core/settings';

export type ExportType = 'article' | 'report' | 'standalone';

export class PandocExporter {
    private app: App;
    private settings: PandocExtendedMarkdownSettings;
    private projectManager: LongformProjectManager;

    constructor(app: App, settings: PandocExtendedMarkdownSettings) {
        this.app = app;
        this.settings = settings;
        this.projectManager = LongformProjectManager.getInstance();
    }

    async export(file: TFile | null, type: ExportType, format: string, projectPath?: string): Promise<void> {
        try {
            let content = '';
            let title = file?.basename || 'Project';
            let topLevelDivision = 'section';

            if (type === 'standalone' && file) {
                content = await this.app.vault.read(file);
            } else {
                const targetProjectPath = projectPath || (file ? this.projectManager.getProjectPath(file.path) : null);
                if (!targetProjectPath) {
                    throw new Error('No project selected or active file is not in a project');
                }

                const scenes = this.projectManager.getProjectScenesByPath(targetProjectPath);
                if (scenes.length === 0) {
                    throw new Error('No scenes found in project');
                }

                for (const scenePath of scenes) {
                    const sceneFile = this.app.vault.getAbstractFileByPath(scenePath);
                    if (sceneFile instanceof TFile) {
                        let sceneContent = await this.app.vault.read(sceneFile);
                        // Strip YAML frontmatter from scenes before merging
                        sceneContent = this.stripFrontmatter(sceneContent);
                        content += sceneContent.trim() + '\n\n';
                    }
                }

                title = targetProjectPath.split('/').pop() || 'Project';
                if (type === 'report') {
                    topLevelDivision = 'chapter';
                }
            }

            const os = require('os');
            const fs = require('fs/promises');

            const now = new Date();
            const dateStr = now.getFullYear() +
                String(now.getMonth() + 1).padStart(2, '0') +
                String(now.getDate()).padStart(2, '0') + '_' +
                String(now.getHours()).padStart(2, '0') +
                String(now.getMinutes()).padStart(2, '0') +
                String(now.getSeconds()).padStart(2, '0');
            
            const folderName = `${title}_${dateStr}`;
            const downloadsDir = join(os.homedir(), 'Downloads');
            const outputDir = join(downloadsDir, folderName);

            await fs.mkdir(outputDir, { recursive: true });

            const fullOutputPath = join(outputDir, `${title}.${format}`);
            const fullTempPath = join(outputDir, `_temp_export.md`);
            await fs.writeFile(fullTempPath, content, 'utf8');

            const luaFilterContent = await this.getLuaFilterContent();
            const fullLuaFilterPath = join(outputDir, `extended-markdown.lua`);
            await fs.writeFile(fullLuaFilterPath, luaFilterContent, 'utf8');

            const pandocCmd = `"${this.settings.pandocPath}" "${fullTempPath}" --lua-filter="${fullLuaFilterPath}" --top-level-division=${topLevelDivision} -o "${fullOutputPath}"`;

            new Notice(`Exporting ${title} to ${format}...`);

            exec(pandocCmd, async (error, stdout, stderr) => {
                // Cleanup temp files
                try {
                    await fs.unlink(fullTempPath);
                    await fs.unlink(fullLuaFilterPath);
                } catch (cleanupErr) {
                    console.error('Error cleaning up temp files:', cleanupErr);
                }

                if (error) {
                    console.error(`Pandoc error: ${error.message}`);
                    console.error(`Pandoc stderr: ${stderr}`);
                    new Notice(`Export failed: ${error.message}`);
                    return;
                }

                new Notice(`Export successful: ${fullOutputPath}`);
            });

        } catch (e) {
            console.error('Export error:', e);
            new Notice(`Export error: ${e.message}`);
        }
    }

    private stripFrontmatter(content: string): string {
        return content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '');
    }

    private async getLuaFilterContent(): Promise<string> {
        return String.raw`-- Pandoc Lua filter for Extended Markdown

-- Handle H6 as paragraph
function Header(el)
    if el.level == 6 then
        return pandoc.Para(el.content)
    end
    return el
end

-- Handle Custom Labels {::LABEL}
function Str(el)
    if el.text:match("^{::") then
        local label = el.text:match("^{::([^}]+)}")
        if label then
            if FORMAT:match 'latex' or FORMAT:match 'beamer' then
                return pandoc.RawInline('latex', "\\label{" .. label .. "}")
            else
                return pandoc.Span({}, {id = label})
            end
        end
    end
    return el
end

-- Handle Equations $$ ... % #eq:label $$
function Math(el)
    if el.mathtype == "DisplayMath" then
        local label = el.text:match("%% #eq:([%a%d%-_:]+)")
        if label then
            local clean_math = el.text:gsub("%% #eq:[%a%d%-_:]+", ""):gsub("^%s*(.-)%s*$", "%1")
            if FORMAT:match 'latex' or FORMAT:match 'beamer' then
                -- In LaTeX, we use \begin{equation} or similar
                -- Pandoc handles display math with $$...$$, but for labels we might want a raw block
                return pandoc.RawBlock('latex', "\\begin{equation}\\label{eq:" .. label .. "}\n" .. clean_math .. "\n\\end{equation}")
            else
                return pandoc.Div({pandoc.Para({pandoc.Math("DisplayMath", clean_math)})}, {id = "eq:" .. label, class = "equation"})
            end
        end
    end
    return el
end

-- Handle Fenced Divs ::: {.class #id} -> LaTeX environments
function Div(el)
    if FORMAT:match 'latex' or FORMAT:match 'beamer' then
        local class = el.classes[1]
        if class == 'subfigures' then
            local res = {}
            table.insert(res, pandoc.RawBlock('latex', "\\begin{figure}\n  \\centering"))
            
            for _, block in ipairs(el.content) do
                if block.t == "Para" then
                    -- Check if this paragraph contains images
                    local images = {}
                    for _, inline in ipairs(block.content) do
                        if inline.t == "Image" then
                            table.insert(images, inline)
                        end
                    end
                    
                    if #images > 0 then
                        -- It's a row of subfigures
                        local width_frac = math.floor((0.95 / #images) * 100) / 100
                        local width_str = tostring(width_frac) .. "\\textwidth"
                        
                        for _, img in ipairs(images) do
                            local width = width_str
                            if img.attributes and img.attributes.width then
                                width = img.attributes.width
                            end
                            
                            local subfig = "\\begin{subfigure}[b]{" .. width .. "}\n    \\centering\n    \\includegraphics{" .. img.src .. "}"
                            
                            local caption = ""
                            if img.caption and #img.caption > 0 then
                                caption = pandoc.utils.stringify(img.caption)
                                subfig = subfig .. "\n    \\caption{" .. caption .. "}"
                            end
                            
                            if img.identifier and img.identifier ~= "" then
                                subfig = subfig .. "\\label{" .. img.identifier .. "}"
                            end
                            
                            subfig = subfig .. "\n  \\end{subfigure}"
                            table.insert(res, pandoc.RawBlock('latex', subfig))
                        end
                        -- Add a newline after each row
                        table.insert(res, pandoc.RawBlock('latex', "\n\n"))
                    else
                        -- Treat as main caption
                        local caption_text = pandoc.utils.stringify(block)
                        if caption_text and caption_text ~= "" then
                            local main_caption = "\\caption{" .. caption_text .. "}"
                            if el.identifier and el.identifier ~= "" then
                                main_caption = main_caption .. "\\label{" .. el.identifier .. "}"
                            end
                            table.insert(res, pandoc.RawBlock('latex', "  " .. main_caption))
                        end
                    end
                elseif block.t == "Plain" then
                    -- Treat as main caption
                    local caption_text = pandoc.utils.stringify(block)
                    if caption_text and caption_text ~= "" then
                        local main_caption = "\\caption{" .. caption_text .. "}"
                        if el.identifier and el.identifier ~= "" then
                            main_caption = main_caption .. "\\label{" .. el.identifier .. "}"
                        end
                        table.insert(res, pandoc.RawBlock('latex', "  " .. main_caption))
                    end
                end
            end
            
            table.insert(res, pandoc.RawBlock('latex', "\\end{figure}"))
            return res
        elseif class then
            local res = { pandoc.RawBlock('latex', "\\begin{" .. class .. "}") }
            if el.identifier and el.identifier ~= "" then
                table.insert(res, pandoc.RawBlock('latex', "\\label{" .. el.identifier .. "}"))
            end
            for _, block in ipairs(el.content) do
                table.insert(res, block)
            end
            table.insert(res, pandoc.RawBlock('latex', "\\end{" .. class .. "}"))
            return res
        end
    end
    return el
end
`;
    }
}
