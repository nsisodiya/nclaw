/**
 * Structured git operations with parsed output.
 * More reliable for the agent than raw terminal output.
 */
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const definition = {
  name: 'git_operation',
  description: 'Perform git operations with structured output. Prefer this over execute_command for git tasks.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'diff', 'log', 'commit', 'add', 'branch', 'checkout', 'pull', 'push', 'stash'],
        description: 'Git action to perform'
      },
      args: {
        type: 'string',
        description: 'Additional arguments. For commit: the commit message. For checkout: branch name. For diff: file path or options.'
      },
      cwd: {
        type: 'string',
        description: 'Working directory (defaults to process.cwd())'
      }
    },
    required: ['action']
  }
};

async function handler({ action, args = '', cwd = process.cwd() }) {
  try {
    const esc = (s) => s.replace(/"/g, '\\"');
    const opts = { cwd };

    const commands = {
      status: 'git status --porcelain',
      diff: `git diff ${args}`,
      log: `git log --oneline --decorate -20 ${args}`,
      commit: `git commit -m "${esc(args)}"`,
      add: `git add ${args || '-A'}`,
      branch: `git branch ${args}`,
      checkout: `git checkout ${args}`,
      pull: `git pull ${args}`,
      push: `git push ${args}`,
      stash: `git stash ${args}`,
    };

    const cmd = commands[action];
    if (!cmd) return { success: false, error: `Unknown action: ${action}` };

    const { stdout, stderr } = await execAsync(cmd, opts);
    const output = (stdout + stderr).trim();

    // For status, annotate what each line means
    let parsed = output;
    if (action === 'status') {
      if (!output) {
        parsed = 'Working directory clean. Nothing to commit.';
      } else {
        const lines = output.split('\n').map(line => {
          const code = line.slice(0, 2);
          const file = line.slice(3);
          const meanings = {
            'M ': `Modified (staged): ${file}`,
            ' M': `Modified (unstaged): ${file}`,
            'A ': `Added (staged): ${file}`,
            '??': `Untracked: ${file}`,
            'D ': `Deleted (staged): ${file}`,
            ' D': `Deleted (unstaged): ${file}`,
          };
          return meanings[code] || line;
        });
        parsed = lines.join('\n');
      }
    }

    return { success: true, data: parsed, action, cwd };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { definition, handler };
