/**
 * Discovers and parses agent definitions from ~/.nclaw/agents/*.md
 *
 * Agent markdown format:
 *   # Agent: <name>
 *   ## Identity
 *   <personality/role text>
 *   ## Tools
 *   - tool_name_1
 *   - tool_name_2
 *   ## Context Sources
 *   - memory/facts
 *   - memory/scratchpad
 *   ## Constraints
 *   - max_steps: 20
 *   - model: qwen/qwen3.5-9b
 *   - confirm_before: [rm, git push]
 *   - allowed_dirs: [~/projects, /tmp]
 *   - deny: [sudo]
 *   - read_only: false
 *   ## When to Delegate
 *   - research tasks -> researcher
 *   - coding tasks -> coder
 */
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const AGENTS_DIR = path.join(os.homedir(), '.nclaw', 'agents');
const SOUL_PATH = path.join(__dirname, '../soul.md');

/**
 * Parse a single agent markdown file into an agent config object.
 */
function parseAgentMarkdown(content) {
  const lines = content.split('\n');

  // Extract agent name
  let name = 'main';
  for (const line of lines) {
    const match = line.match(/^#\s+Agent:\s*(.+)/);
    if (match) {
      name = match[1].trim().toLowerCase();
      break;
    }
  }

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

  // Parse identity
  const identity = (sections['identity'] || '').trim();

  // Parse tools list
  const tools = (sections['tools'] || '')
    .split('\n')
    .filter((l) => l.trim().startsWith('-'))
    .map((l) => l.trim().replace(/^-\s*/, '').trim())
    .filter(Boolean);

  // Parse context sources
  const contextSources = (sections['context sources'] || '')
    .split('\n')
    .filter((l) => l.trim().startsWith('-'))
    .map((l) => l.trim().replace(/^-\s*/, '').trim())
    .filter(Boolean);

  // Parse constraints
  const constraints = {};
  const constraintLines = (sections['constraints'] || '')
    .split('\n')
    .filter((l) => l.trim().startsWith('-'));

  for (const line of constraintLines) {
    const kvMatch = line.match(/^-\s*(\w+):\s*(.+)/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      // Parse arrays [val1, val2]
      const arrayMatch = value.match(/^\[(.+)\]$/);
      if (arrayMatch) {
        constraints[key] = arrayMatch[1].split(',').map((v) => v.trim());
      } else if (value === 'true') {
        constraints[key] = true;
      } else if (value === 'false') {
        constraints[key] = false;
      } else if (!isNaN(value)) {
        constraints[key] = parseInt(value, 10);
      } else {
        constraints[key] = value;
      }
    }
  }

  // Parse delegations
  const delegations = {};
  const delegationLines = (sections['when to delegate'] || '')
    .split('\n')
    .filter((l) => l.trim().startsWith('-'));

  for (const line of delegationLines) {
    const delMatch = line.match(/^-\s*(.+?)\s*->\s*(.+)/);
    if (delMatch) {
      delegations[delMatch[1].trim()] = delMatch[2].trim();
    }
  }

  return {
    name,
    identity,
    tools: tools.length > 0 ? tools : null, // null = all tools
    contextSources: contextSources.length > 0 ? contextSources : null, // null = all
    constraints,
    delegations
  };
}

/**
 * Load all agent definitions from ~/.nclaw/agents/.
 * Falls back to soul.md as the default 'main' agent if no agents dir exists.
 */
async function loadAgents() {
  const agents = new Map();

  try {
    const files = (await fs.readdir(AGENTS_DIR)).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(AGENTS_DIR, file), 'utf8');
        const agentConfig = parseAgentMarkdown(content);
        agents.set(agentConfig.name, agentConfig);
      } catch (e) {
        console.error(`[AgentLoader] Failed to parse ${file}: ${e.message}`);
      }
    }
  } catch {
    // No agents directory — fall through to default
  }

  // Always ensure a 'main' agent exists
  if (!agents.has('main')) {
    let soulContent = '';
    try {
      soulContent = await fs.readFile(SOUL_PATH, 'utf8');
    } catch {
      soulContent = '# nclaw\nYou are a powerful local AI agent.';
    }
    agents.set('main', {
      name: 'main',
      identity: soulContent,
      tools: null, // all tools
      contextSources: null, // all sources
      constraints: {},
      delegations: {}
    });
  }

  return agents;
}

/**
 * Get list of available agent names and their short descriptions.
 */
async function getAgentList() {
  const agents = await loadAgents();
  const list = [];
  for (const [name, config] of agents) {
    list.push({
      name,
      hasCustomTools: config.tools !== null,
      toolCount: config.tools ? config.tools.length : 'all',
      hasDelegations: Object.keys(config.delegations).length > 0
    });
  }
  return list;
}

module.exports = { loadAgents, getAgentList, parseAgentMarkdown };
