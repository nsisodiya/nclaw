/**
 * Task management tool.
 * Creates and tracks multi-step tasks in ~/.nclaw/tasks/
 * Tasks persist across sessions as markdown files with checkboxes.
 */
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const NCLAW_DIR = path.join(os.homedir(), '.nclaw');
const ACTIVE_DIR = path.join(NCLAW_DIR, 'tasks', 'active');
const COMPLETED_DIR = path.join(NCLAW_DIR, 'tasks', 'completed');

const definition = {
  name: 'manage_task',
  description: 'Create and track multi-step tasks. Use for any work that will take more than 3 tool calls.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create_task', 'update_task', 'list_tasks', 'read_task', 'complete_task'],
        description: 'create_task: start a new task | update_task: check off subtasks or add log entry | list_tasks: list active tasks | read_task: get full task file | complete_task: mark done and archive'
      },
      name: {
        type: 'string',
        description: 'Short task identifier used in filename, e.g. "refactor-auth" or "fix-login-bug"'
      },
      goal: {
        type: 'string',
        description: 'For create_task: a clear description of what needs to be accomplished'
      },
      subtasks: {
        type: 'array',
        items: { type: 'string' },
        description: 'For create_task: array of subtask descriptions to create as checkboxes'
      },
      completed_subtask: {
        type: 'string',
        description: 'For update_task: exact text of the subtask to mark as complete (must match exactly)'
      },
      log_entry: {
        type: 'string',
        description: 'For update_task: a progress note to append to the task log'
      }
    },
    required: ['action']
  }
};

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function nowDateTime() {
  return new Date().toISOString().replace('T', ' ').slice(0, 16);
}

async function ensureDirs() {
  await fs.mkdir(ACTIVE_DIR, { recursive: true });
  await fs.mkdir(COMPLETED_DIR, { recursive: true });
}

async function findTaskFile(name) {
  try {
    const slug = slugify(name);
    const files = await fs.readdir(ACTIVE_DIR);
    const match = files.find(f => f.includes(slug) && f.endsWith('.md'));
    if (match) return path.join(ACTIVE_DIR, match);
  } catch {}
  return null;
}

async function handler({ action, name, goal, subtasks, completed_subtask, log_entry }) {
  try {
    await ensureDirs();

    if (action === 'create_task') {
      if (!name || !goal) return { success: false, error: 'name and goal are required' };
      const filename = `${today()}-${slugify(name)}.md`;
      const taskPath = path.join(ACTIVE_DIR, filename);

      const subtaskList = (subtasks || []).map(s => `- [ ] ${s}`).join('\n');

      const content = `# Task: ${name}

## Status: in-progress
## Created: ${today()}

## Goal
${goal}

## Subtasks
${subtaskList || '- [ ] Define subtasks'}

## Log
- ${nowDateTime()}: Task created.
`;
      await fs.writeFile(taskPath, content, 'utf8');
      return { success: true, data: `Task created: ${filename}`, filename };
    }

    if (action === 'list_tasks') {
      const files = (await fs.readdir(ACTIVE_DIR).catch(() => [])).filter(f => f.endsWith('.md'));
      if (files.length === 0) return { success: true, data: 'No active tasks.' };
      // Return names with their goals for context
      const summaries = [];
      for (const f of files) {
        try {
          const content = await fs.readFile(path.join(ACTIVE_DIR, f), 'utf8');
          const goalMatch = content.match(/## Goal\n(.*)/);
          const goal = goalMatch ? goalMatch[1].trim() : '(no goal)';
          summaries.push(`- ${f}: ${goal}`);
        } catch {
          summaries.push(`- ${f}`);
        }
      }
      return { success: true, data: summaries.join('\n') };
    }

    if (action === 'read_task') {
      if (!name) return { success: false, error: 'name is required' };
      const filePath = await findTaskFile(name);
      if (!filePath) return { success: false, error: `Task not found: ${name}` };
      const content = await fs.readFile(filePath, 'utf8');
      return { success: true, data: content, filePath };
    }

    if (action === 'update_task') {
      if (!name) return { success: false, error: 'name is required' };
      const filePath = await findTaskFile(name);
      if (!filePath) return { success: false, error: `Task not found: ${name}` };
      let content = await fs.readFile(filePath, 'utf8');

      if (completed_subtask) {
        const escaped = completed_subtask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        content = content.replace(new RegExp(`- \\[ \\] ${escaped}`), `- [x] ${completed_subtask}`);
      }

      if (log_entry) {
        content = content.replace(
          /^(## Log\n)/m,
          `$1- ${nowDateTime()}: ${log_entry}\n`
        );
      }

      await fs.writeFile(filePath, content, 'utf8');
      return { success: true, data: 'Task updated.' };
    }

    if (action === 'complete_task') {
      if (!name) return { success: false, error: 'name is required' };
      const filePath = await findTaskFile(name);
      if (!filePath) return { success: false, error: `Task not found: ${name}` };
      let content = await fs.readFile(filePath, 'utf8');
      content = content.replace('## Status: in-progress', '## Status: completed');
      content += `\n## Completed: ${today()}\n`;

      const destPath = path.join(COMPLETED_DIR, path.basename(filePath));
      await fs.writeFile(destPath, content, 'utf8');
      await fs.unlink(filePath);
      return { success: true, data: `Task completed and archived: ${path.basename(filePath)}` };
    }

    return { success: false, error: `Unknown action: ${action}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { definition, handler };
