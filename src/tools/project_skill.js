/**
 * Project context scanner.
 * Reads package.json, README, and directory structure to give the agent
 * quick project awareness without having to explore manually.
 */
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const definition = {
  name: 'scan_project',
  description: 'Get an overview of the current project structure, or search for files by pattern.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['overview', 'find_files'],
        description: 'overview: summarize the project | find_files: search by glob pattern'
      },
      pattern: {
        type: 'string',
        description: 'For find_files: file pattern, e.g. "*.js" or "src/**/*.ts"'
      },
      cwd: {
        type: 'string',
        description: 'Project root directory (defaults to process.cwd())'
      }
    },
    required: ['action']
  }
};

async function readFileSafe(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

async function handler({ action, pattern, cwd = process.cwd() }) {
  try {
    if (action === 'overview') {
      let summary = `# Project: ${path.basename(cwd)}\n**Path**: ${cwd}\n\n`;

      // package.json
      const pkgRaw = await readFileSafe(path.join(cwd, 'package.json'));
      if (pkgRaw) {
        try {
          const pkg = JSON.parse(pkgRaw);
          summary += `**Name**: ${pkg.name || 'N/A'}\n`;
          summary += `**Version**: ${pkg.version || 'N/A'}\n`;
          if (pkg.description) summary += `**Description**: ${pkg.description}\n`;
          if (pkg.scripts && Object.keys(pkg.scripts).length) {
            summary += `**Scripts**: ${Object.keys(pkg.scripts).join(', ')}\n`;
          }
          if (pkg.dependencies) {
            const deps = Object.keys(pkg.dependencies).slice(0, 10);
            summary += `**Dependencies**: ${deps.join(', ')}${Object.keys(pkg.dependencies).length > 10 ? '...' : ''}\n`;
          }
          summary += '\n';
        } catch {}
      }

      // README (first 400 chars)
      const readme = await readFileSafe(path.join(cwd, 'README.md'));
      if (readme) {
        summary += `**README preview**:\n${readme.slice(0, 400)}...\n\n`;
      }

      // Directory tree (2 levels, exclude node_modules/.git)
      try {
        const { stdout } = await execAsync(
          'find . -maxdepth 2 -not -path "*/node_modules/*" -not -path "*/.git/*" -not -name "*.lock" | sort',
          { cwd }
        );
        summary += `**Structure**:\n${stdout.slice(0, 1500)}`;
      } catch {}

      return { success: true, data: summary };
    }

    if (action === 'find_files') {
      if (!pattern) return { success: false, error: 'pattern is required' };
      try {
        const { stdout } = await execAsync(
          `find . -name "${pattern}" -not -path "*/node_modules/*" -not -path "*/.git/*" | sort`,
          { cwd }
        );
        return { success: true, data: stdout.trim() || 'No files found matching that pattern.' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    return { success: false, error: `Unknown action: ${action}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { definition, handler };
