#!/usr/bin/env node
'use strict';

require('dotenv').config();
const readline = require('readline');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const chalk = require('chalk');
const { Command } = require('commander');
const { runAgent } = require('./agent');

const NCLAW_DIR = path.join(os.homedir(), '.nclaw');

// ── Ensure ~/.nclaw directory structure exists ──────────
async function initDirs() {
  const dirs = [
    path.join(NCLAW_DIR, 'memory', 'session-log'),
    path.join(NCLAW_DIR, 'skills'),
    path.join(NCLAW_DIR, 'processes'),
    path.join(NCLAW_DIR, 'tasks', 'active'),
    path.join(NCLAW_DIR, 'tasks', 'completed'),
  ];
  for (const d of dirs) {
    await fs.mkdir(d, { recursive: true }).catch(() => {});
  }
}

// ── Session summary on exit ─────────────────────────────
async function logSessionSummary(history) {
  if (history.length < 2) return;
  try {
    const memorySkill = require('./tools/memory_skill');
    const turns = history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(0, 20)
      .map(m => `${m.role}: ${String(m.content || '').slice(0, 100)}`)
      .join('\n');

    // Quick summarize via the agent (single pass, no tool loop)
    const { OpenAI } = require('openai');
    const config = require('./config');
    const openai = new OpenAI({ baseURL: config.lmStudio.baseURL, apiKey: config.lmStudio.apiKey });

    const res = await openai.chat.completions.create({
      model: config.lmStudio.model,
      messages: [
        { role: 'system', content: 'Summarize this conversation in 2-3 concise bullet points. Be brief.' },
        { role: 'user', content: turns },
      ],
      tool_choice: 'none',
    });

    const summary = res.choices[0]?.message?.content;
    if (summary) {
      await memorySkill.handler({ action: 'log_session', content: summary });
    }
  } catch {
    // Non-critical — don't crash on exit
  }
}

// ── Main ───────────────────────────────────────────────
const program = new Command();

program
  .name('nclaw')
  .description('Local AI agent — optimized for your MacBook')
  .version('2.0.0')
  .option('--no-ui', 'Skip starting the web UI server')
  .option('--port <port>', 'UI server port', '3721');

program.action(async (options) => {
  // Init storage
  await initDirs();

  // Start Express UI (unless --no-ui)
  if (options.ui !== false) {
    try {
      const server = require('./server');
      await server.start(parseInt(options.port, 10));
    } catch (e) {
      console.log(chalk.yellow(`[UI] Could not start: ${e.message}`));
    }
  }

  // Start Telegram bot (if token is configured)
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    try {
      const telegramBot = require('./telegram_bot');
      telegramBot.start(telegramToken, runAgent);
    } catch (e) {
      console.log(chalk.yellow(`[Telegram] Could not start: ${e.message}`));
    }
  }

  // ── REPL ──
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: chalk.magenta('nclaw> '),
  });

  console.log(chalk.bold.cyan('\n  ███╗   ██╗ ██████╗██╗      █████╗ ██╗    ██╗'));
  console.log(chalk.bold.cyan('  ████╗  ██║██╔════╝██║     ██╔══██╗██║    ██║'));
  console.log(chalk.bold.cyan('  ██╔██╗ ██║██║     ██║     ███████║██║ █╗ ██║'));
  console.log(chalk.bold.cyan('  ██║╚██╗██║██║     ██║     ██╔══██║██║███╗██║'));
  console.log(chalk.bold.cyan('  ██║ ╚████║╚██████╗███████╗██║  ██║╚███╔███╔╝'));
  console.log(chalk.bold.cyan('  ╚═╝  ╚═══╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝\n'));
  console.log(chalk.dim("  Local AI agent — type your task, or 'help' for tips"));
  console.log(chalk.dim("  Type 'exit' to quit.\n"));

  let history = [];
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log(chalk.dim('\n  Saving session…'));
      await logSessionSummary(history);
      rl.close();
      return;
    }

    if (input.toLowerCase() === 'help') {
      console.log(chalk.cyan(`
  Tips:
  • Ask me to do anything — I can run commands, edit files, use git.
  • "commit my changes" — uses the git-commit skill
  • "review src/app.js" — uses the code-review skill
  • "deploy" — follows the deploy process
  • "remember that I use yarn" — saves to memory
  • I'll create tasks for complex multi-step work automatically.
`));
      rl.prompt();
      return;
    }

    try {
      const result = await runAgent(input, history);
      history = result.history;
      console.log(chalk.white(`\n${result.response}\n`));
    } catch (error) {
      console.error(chalk.red(`\nError: ${error.message}\n`));
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(chalk.bold.cyan('\n  Goodbye!\n'));
    process.exit(0);
  });
});

program.parse();
