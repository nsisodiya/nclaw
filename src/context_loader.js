/**
 * Assembles the full system prompt for each agent call.
 * Combines: soul.md + memory + skills index + active tasks
 * Enforces token budgets to keep the 9B model working well.
 *
 * Total target: < 3000 tokens
 */
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const skillLoader = require('./skill_loader');

const NCLAW_DIR = path.join(os.homedir(), '.nclaw');
const MEMORY_DIR = path.join(NCLAW_DIR, 'memory');
const TASKS_ACTIVE_DIR = path.join(NCLAW_DIR, 'tasks', 'active');
const SOUL_PATH = path.join(__dirname, '../soul.md');

async function readFileSafe(filePath, defaultContent = '') {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return defaultContent;
  }
}

function limitLines(text, max) {
  if (!text || !text.trim()) return '';
  const lines = text.split('\n');
  if (lines.length <= max) return text;
  return '... (older entries truncated)\n' + lines.slice(-max).join('\n');
}

async function getActiveTasksSummary() {
  try {
    const files = (await fs.readdir(TASKS_ACTIVE_DIR)).filter(f => f.endsWith('.md'));
    if (files.length === 0) return '';

    let summary = '';
    for (const f of files) {
      const content = await readFileSafe(path.join(TASKS_ACTIVE_DIR, f), '');
      if (!content) continue;

      // Extract only header + goal + subtasks checklist (skip log section)
      const lines = content.split('\n');
      const kept = [];
      let skipLog = false;
      for (const line of lines) {
        if (line.startsWith('## Log')) { skipLog = true; continue; }
        if (skipLog && line.startsWith('## ')) skipLog = false;
        if (!skipLog) kept.push(line);
      }
      summary += kept.join('\n') + '\n\n';
    }
    return summary.trim();
  } catch {
    return '';
  }
}

async function build() {
  const soul = await readFileSafe(SOUL_PATH, '# nclaw\nYou are a powerful local AI agent.');

  // Memory (with hard line limits for 9B model context budget)
  const rawFacts = await readFileSafe(path.join(MEMORY_DIR, 'facts.md'), '');
  const facts = limitLines(rawFacts, 50);

  const rawScratchpad = await readFileSafe(path.join(MEMORY_DIR, 'scratchpad.md'), '');
  const scratchpad = limitLines(rawScratchpad, 30);

  // Last 3 session logs
  let sessionLogs = '';
  try {
    const logDir = path.join(MEMORY_DIR, 'session-log');
    const files = (await fs.readdir(logDir)).filter(f => f.endsWith('.md')).sort();
    const recent = files.slice(-3);
    for (const f of recent) {
      const content = await readFileSafe(path.join(logDir, f), '');
      if (content.trim()) sessionLogs += `\n### ${f.replace('.md', '')}\n${content.trim()}\n`;
    }
  } catch {}

  // Skills & processes index (lazy — only names + triggers)
  const skillIndex = await skillLoader.buildIndex();

  // Active tasks (header + checklist only, no log noise)
  const activeTasks = await getActiveTasksSummary();

  // ReAct instructions (concise for 9B model)
  const reactPrompt = `
## How to Work
1. Break complex tasks into subtasks using \`manage_task\`.
2. If a tool fails, read the error and retry with a fix. Don't give up.
3. Use \`manage_memory\` with \`remember_fact\` when you learn user preferences or project details.
4. When a request matches a skill, read the skill file then follow its steps exactly.
5. Update scratchpad with working notes on multi-step tasks.
`;

  // Assemble — each section only added if non-empty
  let context = soul;

  if (facts.trim()) {
    context += `\n\n## Memory: Known Facts\n${facts}`;
  }
  if (scratchpad.trim()) {
    context += `\n\n## Memory: Scratchpad\n${scratchpad}`;
  }
  if (sessionLogs.trim()) {
    context += `\n\n## Recent Sessions\n${sessionLogs}`;
  }
  if (skillIndex.trim()) {
    context += `\n\n${skillIndex}`;
  }
  if (activeTasks.trim()) {
    context += `\n\n## Active Tasks\n${activeTasks}`;
  }

  context += reactPrompt;

  return context;
}

module.exports = { build };
