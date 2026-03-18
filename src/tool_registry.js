/**
 * Dynamic tool registry for nclaw v3.
 * Discovers and loads tools from:
 *   1. src/tools/*.js     — built-in tools
 *   2. ~/.nclaw/tools/*.js — user JS tools
 *   3. ~/.nclaw/tools/*.md — markdown-defined tools
 */
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const BUILTIN_DIR = path.join(__dirname, 'tools');
const USER_TOOLS_DIR = path.join(os.homedir(), '.nclaw', 'tools');

class ToolRegistry {
  constructor() {
    this.tools = new Map(); // name -> { definition, handler, metadata }
  }

  register(name, definition, handler, metadata = {}) {
    this.tools.set(name, { definition, handler, metadata });
  }

  get(name) {
    return this.tools.get(name);
  }

  getAll() {
    return Array.from(this.tools.values());
  }

  /**
   * Returns tools filtered to only those whose names are in the given list.
   * If toolNames is null/undefined, returns all tools.
   */
  getForAgent(toolNames) {
    if (!toolNames) return this.getAll();
    return toolNames
      .map((name) => this.tools.get(name))
      .filter(Boolean);
  }

  getToolNames() {
    return Array.from(this.tools.keys());
  }

  /**
   * Discover and load all tools from built-in and user directories.
   */
  async discoverAndLoad() {
    // 1. Built-in JS tools
    await this._loadJsTools(BUILTIN_DIR);
    // 2. User JS tools
    await this._loadJsTools(USER_TOOLS_DIR);
    // 3. User markdown-defined tools
    await this._loadMarkdownTools(USER_TOOLS_DIR);
  }

  async _loadJsTools(dir) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.js')) continue;
        try {
          const tool = require(path.join(dir, file));
          if (tool.definition && tool.handler) {
            this.register(tool.definition.name, tool.definition, tool.handler, {
              source: dir === BUILTIN_DIR ? 'builtin' : 'user',
              file: path.join(dir, file)
            });
          }
        } catch (e) {
          console.error(`[ToolRegistry] Failed to load ${file}: ${e.message}`);
        }
      }
    } catch {
      // Directory doesn't exist — that's fine
    }
  }

  async _loadMarkdownTools(dir) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        try {
          const content = await fs.readFile(path.join(dir, file), 'utf8');
          const tool = this._parseMarkdownTool(content, file);
          if (tool) {
            this.register(tool.definition.name, tool.definition, tool.handler, {
              source: 'markdown',
              file: path.join(dir, file),
              confirm: tool.confirm
            });
          }
        } catch (e) {
          console.error(`[ToolRegistry] Failed to parse ${file}: ${e.message}`);
        }
      }
    } catch {
      // Directory doesn't exist — that's fine
    }
  }

  /**
   * Parse a markdown tool definition file into a { definition, handler } object.
   *
   * Expected format:
   *   # Tool: <name>
   *   ## Description
   *   <description text>
   *   ## Parameters
   *   - paramName (type, required|optional): description
   *   ## Settings
   *   - confirm: true|false
   *   ## Implementation
   *   ```bash
   *   <shell command with ${param} substitution>
   *   ```
   */
  _parseMarkdownTool(content, filename) {
    const lines = content.split('\n');

    // Extract tool name
    let name = '';
    for (const line of lines) {
      const match = line.match(/^#\s+Tool:\s*(.+)/);
      if (match) {
        name = match[1].trim().toLowerCase().replace(/\s+/g, '_');
        break;
      }
    }
    if (!name) return null;

    // Extract sections
    const sections = {};
    let currentSection = '';
    for (const line of lines) {
      const sectionMatch = line.match(/^##\s+(.+)/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim().toLowerCase();
        sections[currentSection] = '';
        continue;
      }
      if (currentSection) {
        sections[currentSection] += line + '\n';
      }
    }

    // Parse description
    const description = (sections['description'] || '').trim() || `Tool: ${name}`;

    // Parse parameters
    const parameters = { type: 'object', properties: {}, required: [] };
    const paramLines = (sections['parameters'] || '').split('\n').filter((l) => l.trim().startsWith('-'));
    for (const paramLine of paramLines) {
      const paramMatch = paramLine.match(/^-\s+(\w+)\s*\((\w+)(?:,\s*(required|optional))?\):\s*(.*)/);
      if (paramMatch) {
        const [, paramName, paramType, requiredFlag, paramDesc] = paramMatch;
        parameters.properties[paramName] = {
          type: paramType,
          description: paramDesc.trim()
        };
        if (requiredFlag !== 'optional') {
          parameters.required.push(paramName);
        }
      }
    }

    // Parse settings
    let confirm = true; // default: require confirmation
    const settingsText = sections['settings'] || '';
    const confirmMatch = settingsText.match(/confirm:\s*(true|false)/i);
    if (confirmMatch) {
      confirm = confirmMatch[1].toLowerCase() === 'true';
    }

    // Parse implementation (bash block)
    const implText = sections['implementation'] || '';
    const bashMatch = implText.match(/```(?:bash|sh)\n([\s\S]*?)```/);
    if (!bashMatch) return null;
    const bashTemplate = bashMatch[1].trim();

    // Build handler
    const handler = async (args) => {
      // Substitute ${param} in template
      let command = bashTemplate;
      for (const [key, value] of Object.entries(args)) {
        // Sanitize value to prevent command injection
        const safeValue = String(value).replace(/[`$\\!"]/g, '\\$&');
        command = command.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), safeValue);
      }

      return new Promise((resolve) => {
        const child = spawn(command, {
          shell: true,
          cwd: process.cwd(),
          timeout: 30000
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        child.on('close', (code) => {
          // Truncate output to prevent context flooding
          const maxLen = 4000;
          const out = stdout.trim().slice(0, maxLen);
          resolve({
            success: code === 0,
            data: out,
            stderr: stderr.trim().slice(0, 1000),
            error: code !== 0 ? `Command failed with exit code ${code}` : null
          });
        });

        child.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });
      });
    };

    return {
      definition: { name, description, parameters },
      handler,
      confirm
    };
  }
}

module.exports = ToolRegistry;
