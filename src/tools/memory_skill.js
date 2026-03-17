/**
 * Memory management tool.
 * Persists facts, scratchpad notes, and session summaries to ~/.nclaw/memory/
 */
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const NCLAW_DIR = path.join(os.homedir(), '.nclaw');
const MEMORY_DIR = path.join(NCLAW_DIR, 'memory');
const LOG_DIR = path.join(MEMORY_DIR, 'session-log');

const definition = {
  name: 'manage_memory',
  description: 'Persist information across sessions. Remember facts about the user, update working notes, or log session summaries.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['remember_fact', 'update_scratchpad', 'log_session', 'read_memory'],
        description: 'remember_fact: append to facts.md | update_scratchpad: overwrite scratchpad.md | log_session: write daily summary | read_memory: read a memory file'
      },
      content: {
        type: 'string',
        description: 'Content to write (required for remember_fact, update_scratchpad, log_session)'
      },
      file: {
        type: 'string',
        description: 'For read_memory: "facts", "scratchpad", or a date like "2026-03-17"'
      }
    },
    required: ['action']
  }
};

async function ensureDirs() {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
  await fs.mkdir(LOG_DIR, { recursive: true });
}

async function handler({ action, content, file }) {
  try {
    await ensureDirs();

    if (action === 'remember_fact') {
      if (!content) return { success: false, error: 'content is required' };
      const factsPath = path.join(MEMORY_DIR, 'facts.md');
      const line = content.startsWith('- ') ? content : `- ${content}`;
      await fs.appendFile(factsPath, `\n${line}`);
      return { success: true, data: 'Fact remembered.' };
    }

    if (action === 'update_scratchpad') {
      if (!content) return { success: false, error: 'content is required' };
      await fs.writeFile(path.join(MEMORY_DIR, 'scratchpad.md'), content, 'utf8');
      return { success: true, data: 'Scratchpad updated.' };
    }

    if (action === 'log_session') {
      if (!content) return { success: false, error: 'content is required' };
      const today = new Date().toISOString().split('T')[0];
      const logPath = path.join(LOG_DIR, `${today}.md`);
      const timestamp = new Date().toLocaleTimeString();
      await fs.appendFile(logPath, `\n[${timestamp}]\n${content}\n`);
      return { success: true, data: 'Session log updated.' };
    }

    if (action === 'read_memory') {
      let targetPath;
      if (!file || file === 'facts') {
        targetPath = path.join(MEMORY_DIR, 'facts.md');
      } else if (file === 'scratchpad') {
        targetPath = path.join(MEMORY_DIR, 'scratchpad.md');
      } else {
        targetPath = path.join(LOG_DIR, `${file}.md`);
      }
      const data = await fs.readFile(targetPath, 'utf8');
      return { success: true, data };
    }

    return { success: false, error: `Unknown action: ${action}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { definition, handler };
