/**
 * Assembles the full system prompt for each agent call.
 * Combines: agent identity + behavior.md + memory + skills index + active tasks
 * Supports per-agent context filtering via agentConfig.contextSources.
 *
 * Total target: < 3000 tokens for 9B model efficiency
 */
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const skillLoader = require('./skill_loader');
const { applyBudget, estimatePromptCost } = require('./context_budget');

const NCLAW_DIR = path.join(os.homedir(), '.nclaw');
const MEMORY_DIR = path.join(NCLAW_DIR, 'memory');
const TASKS_ACTIVE_DIR = path.join(NCLAW_DIR, 'tasks', 'active');
const SOUL_PATH = path.join(__dirname, '../soul.md');
const BEHAVIOR_PATH = path.join(NCLAW_DIR, 'behavior.md');

// Default behavior rules (used if ~/.nclaw/behavior.md doesn't exist)
const DEFAULT_BEHAVIOR = `
## How to Work
1. Break complex tasks into subtasks using \`manage_task\`.
2. If a tool fails, read the error and retry with a fix. Don't give up.
3. Use \`manage_memory\` with \`remember_fact\` when you learn user preferences or project details.
4. When a request matches a skill, read the skill file then follow its steps exactly.
5. Update scratchpad with working notes on multi-step tasks.
`;

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

/**
 * Build the system prompt.
 * @param {object} [agentConfig] - Optional agent configuration
 * @param {string} [agentConfig.identity] - Agent identity text (overrides soul.md)
 * @param {string[]} [agentConfig.contextSources] - Which context sections to include
 *   Possible values: 'memory/facts', 'memory/scratchpad', 'session_logs', 'skills', 'active_tasks'
 *   If null/undefined, all sources are included.
 * @param {object} [agentConfig.delegations] - Delegation rules map
 */
async function build(agentConfig = {}) {
  // Determine which context sources to include
  const sources = agentConfig.contextSources || null; // null = include all
  const shouldInclude = (name) => !sources || sources.includes(name);

  // Agent identity: use provided identity or fall back to soul.md
  const identity = agentConfig.identity
    || await readFileSafe(SOUL_PATH, '# nclaw\nYou are a powerful local AI agent.');

  // Behavior rules from ~/.nclaw/behavior.md (or defaults)
  const behaviorRaw = await readFileSafe(BEHAVIOR_PATH, '');
  const behavior = behaviorRaw.trim() || DEFAULT_BEHAVIOR;

  // Memory (with hard line limits for 9B model context budget)
  let facts = '';
  if (shouldInclude('memory/facts')) {
    const rawFacts = await readFileSafe(path.join(MEMORY_DIR, 'facts.md'), '');
    facts = limitLines(rawFacts, 50);
  }

  let scratchpad = '';
  if (shouldInclude('memory/scratchpad')) {
    const rawScratchpad = await readFileSafe(path.join(MEMORY_DIR, 'scratchpad.md'), '');
    scratchpad = limitLines(rawScratchpad, 30);
  }

  // Last 3 session logs
  let sessionLogs = '';
  if (shouldInclude('session_logs')) {
    try {
      const logDir = path.join(MEMORY_DIR, 'session-log');
      const files = (await fs.readdir(logDir)).filter(f => f.endsWith('.md')).sort();
      const recent = files.slice(-3);
      for (const f of recent) {
        const content = await readFileSafe(path.join(logDir, f), '');
        if (content.trim()) sessionLogs += `\n### ${f.replace('.md', '')}\n${content.trim()}\n`;
      }
    } catch {}
  }

  // Skills & processes index (lazy — only names + triggers)
  let skillIndex = '';
  if (shouldInclude('skills')) {
    skillIndex = await skillLoader.buildIndex();
  }

  // Active tasks (header + checklist only, no log noise)
  let activeTasks = '';
  if (shouldInclude('active_tasks')) {
    activeTasks = await getActiveTasksSummary();
  }

  // Delegation rules
  let delegationSection = '';
  if (agentConfig.delegations && Object.keys(agentConfig.delegations).length > 0) {
    delegationSection = '\n## Delegation\nYou can delegate tasks to specialized agents using the `delegate_task` tool:\n';
    for (const [taskType, agentName] of Object.entries(agentConfig.delegations)) {
      delegationSection += `- ${taskType} -> delegate to **${agentName}**\n`;
    }
  }

  // Apply token budgets to each section
  const budgetedIdentity = applyBudget('identity', identity);
  const budgetedBehavior = applyBudget('behavior', behavior);
  const budgetedFacts = applyBudget('memory_facts', facts);
  const budgetedScratchpad = applyBudget('memory_scratchpad', scratchpad);
  const budgetedSessionLogs = applyBudget('session_logs', sessionLogs);
  const budgetedSkillIndex = applyBudget('skills_index', skillIndex);
  const budgetedActiveTasks = applyBudget('active_tasks', activeTasks);
  const budgetedDelegation = applyBudget('delegation_rules', delegationSection);

  // Assemble — each section only added if non-empty
  let context = budgetedIdentity;

  if (budgetedFacts.trim()) {
    context += `\n\n## Memory: Known Facts\n${budgetedFacts}`;
  }
  if (budgetedScratchpad.trim()) {
    context += `\n\n## Memory: Scratchpad\n${budgetedScratchpad}`;
  }
  if (budgetedSessionLogs.trim()) {
    context += `\n\n## Recent Sessions\n${budgetedSessionLogs}`;
  }
  if (budgetedSkillIndex.trim()) {
    context += `\n\n${budgetedSkillIndex}`;
  }
  if (budgetedActiveTasks.trim()) {
    context += `\n\n## Active Tasks\n${budgetedActiveTasks}`;
  }
  if (budgetedDelegation.trim()) {
    context += budgetedDelegation;
  }

  context += '\n' + budgetedBehavior;

  return context;
}

module.exports = { build };
