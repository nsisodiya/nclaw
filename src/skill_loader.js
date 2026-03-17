/**
 * Discovers skills and processes from ~/.nclaw/skills/ and ~/.nclaw/processes/
 * Returns a compact index string for injection into the system prompt.
 * Full skill/process files are lazy-loaded by the agent on demand.
 */
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const NCLAW_DIR = path.join(os.homedir(), '.nclaw');
const SKILLS_DIR = path.join(NCLAW_DIR, 'skills');
const PROCESSES_DIR = path.join(NCLAW_DIR, 'processes');

async function extractMeta(content, headerPrefix) {
  const lines = content.split('\n');
  let name = '';
  let trigger = '';
  let inTrigger = false;

  for (const line of lines) {
    if (line.startsWith(`# ${headerPrefix}:`)) {
      name = line.replace(`# ${headerPrefix}:`, '').trim();
    }
    if (line.startsWith('## When to use') || line.startsWith('## Trigger')) {
      inTrigger = true;
      continue;
    }
    if (inTrigger && line.startsWith('## ')) {
      inTrigger = false;
    }
    if (inTrigger && line.trim()) {
      trigger = line.trim().replace(/^[-*]\s*/, '');
      break;
    }
  }

  return { name, trigger };
}

async function scanDir(dir, headerPrefix) {
  const entries = [];
  try {
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.md'));
    for (const f of files) {
      try {
        const content = await fs.readFile(path.join(dir, f), 'utf8');
        const { name, trigger } = await extractMeta(content, headerPrefix);
        if (name) {
          entries.push({ name, trigger, file: f.replace('.md', ''), fullPath: path.join(dir, f) });
        }
      } catch {}
    }
  } catch {}
  return entries;
}

async function buildIndex() {
  const skills = await scanDir(SKILLS_DIR, 'Skill');
  const processes = await scanDir(PROCESSES_DIR, 'Process');

  let index = '';

  if (skills.length > 0) {
    index += '## Available Skills\n';
    index += 'When a request matches a skill, use `manage_file` to read `~/.nclaw/skills/<filename>.md`, then follow its steps.\n\n';
    for (const s of skills) {
      index += `- **${s.name}** (\`${s.file}\`): ${s.trigger}\n`;
    }
  }

  if (processes.length > 0) {
    index += '\n## Available Processes\n';
    index += 'When executing a process, read `~/.nclaw/processes/<filename>.md` and follow EXACTLY — check prerequisites, execute steps in order.\n\n';
    for (const p of processes) {
      index += `- **${p.name}** (\`${p.file}\`): ${p.trigger}\n`;
    }
  }

  return index;
}

async function getSkillList() {
  const skills = await scanDir(SKILLS_DIR, 'Skill');
  const processes = await scanDir(PROCESSES_DIR, 'Process');
  return { skills, processes };
}

module.exports = { buildIndex, getSkillList };
