/**
 * Telegram bot interface for nclaw.
 * Allows sending messages to the agent from Telegram.
 *
 * Setup:
 *   1. Create a bot via @BotFather on Telegram
 *   2. Enter your bot token in the Settings → Telegram Bot section of the UI
 *      (or set telegramBotToken in ~/.nclaw/config.json)
 *   3. The bot uses polling (no public server needed)
 *
 * Usage in Telegram:
 *   /start — welcome message
 *   /clear — clear conversation history
 *   /tasks — list active tasks
 *   Any other text — sent directly to the agent
 */
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const config = require('./config');

// Conversation history per chat_id (in-memory, resets on restart)
const histories = new Map();

function start(token, runAgent) {
  let TelegramBot;
  try {
    TelegramBot = require('node-telegram-bot-api');
  } catch {
    console.log(
      chalk.yellow(
        '[Telegram] node-telegram-bot-api not installed. Run: npm install'
      )
    );
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });

  console.log(
    chalk.green(
      '[Telegram] Bot started. Send messages in Telegram to talk to nclaw.'
    )
  );

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const from = msg.from;
    const text = msg.text;

    if (!text) return;

    // /myid always works — lets anyone look up their own ID to add to whitelist
    if (text === '/myid') {
      bot.sendMessage(
        chatId,
        `🪪 Your Telegram User ID is:\n\n<code>${from.id}</code>\n\nUsername: ${from.username ? `@${from.username}` : '(none)'}\n\nAdd either value to the Allowed Users whitelist in nclaw Settings to authorize yourself.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Check allowed users if configured
    const allowed = config.telegramAllowedUsers || [];
    if (allowed.length > 0) {
      const userId = String(from.id);
      const username = from.username
        ? String(from.username).toLowerCase()
        : null;
      const isAllowed = allowed.some((u) => {
        const su = String(u).toLowerCase();
        return su === userId || (username && su === `@${username}`);
      });

      if (!isAllowed) {
        console.log(
          chalk.red(
            `[Telegram] Unauthorized access by ${from.first_name} (@${from.username || 'no-username'}, ID: ${from.id})`
          )
        );
        bot.sendMessage(
          chatId,
          `🚫 Unauthorized. To use this bot, add your ID (${from.id}) or @${from.username || 'username'} to the allowed users list in nclaw settings.`
        );
        return;
      }
    }

    // Commands
    if (text === '/start') {
      bot.sendMessage(
        chatId,
        '👋 *nclaw* is ready.\n\nSend any message to interact with your local AI agent.\n\n' +
          '/myid — show your Telegram User ID\n/clear — clear conversation history\n/tasks — list active tasks\n/status — show uptime',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (text === '/clear') {
      histories.delete(chatId);
      bot.sendMessage(chatId, '🗑️ Conversation history cleared.');
      return;
    }

    if (text === '/tasks') {
      const taskTool = require('./tools/task_skill');
      const result = await taskTool.handler({ action: 'list_tasks' });
      bot.sendMessage(
        chatId,
        result.success
          ? `📋 *Active Tasks*\n\n${result.data}`
          : '❌ ' + result.error,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (text === '/status') {
      bot.sendMessage(
        chatId,
        `🤖 nclaw is running. Uptime: ${Math.floor(process.uptime())}s`
      );
      return;
    }

    if (text === '/agents') {
      // List available agents
      try {
        const Orchestrator = require('./orchestrator');
        // We can't access the orchestrator directly, so just list agent files
        const agentDir = path.join(os.homedir(), '.nclaw', 'agents');
        const agentFs = require('fs').promises;
        const files = await agentFs.readdir(agentDir).catch(() => []);
        const agents = files.filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
        const list = agents.length > 0
          ? agents.map(a => `- ${a}`).join('\n')
          : 'main (default)';
        bot.sendMessage(chatId, `Available agents:\n${list}\n\nUse @agentname to talk to a specific agent.`);
      } catch {
        bot.sendMessage(chatId, 'Available agents: main (default)');
      }
      return;
    }

    if (text.startsWith('/')) return; // Unknown command

    // Send "working on it" indicator
    const typingInterval = setInterval(() => {
      bot.sendChatAction(chatId, 'typing').catch(() => {});
    }, 4000);
    bot.sendChatAction(chatId, 'typing');

    const history = histories.get(chatId) || [];

    try {
      const result = await runAgent(text, history, 'telegram');
      histories.set(chatId, result.history);
      clearInterval(typingInterval);

      const response = result.response;

      // Telegram message limit is 4096 chars
      if (response.length > 4000) {
        const chunks = [];
        for (let i = 0; i < response.length; i += 4000) {
          chunks.push(response.slice(i, i + 4000));
        }
        for (const chunk of chunks) {
          await bot.sendMessage(chatId, chunk).catch(
            () => bot.sendMessage(chatId, chunk, {}) // retry without markdown if parse fails
          );
        }
      } else {
        await bot
          .sendMessage(chatId, response)
          .catch(() => bot.sendMessage(chatId, response, {}));
      }
    } catch (e) {
      clearInterval(typingInterval);
      console.log(chalk.red(`[Telegram] Error: ${e.message}`));
      bot.sendMessage(chatId, `❌ Error: ${e.message}`);
    }
  });

  bot.on('polling_error', (err) => {
    console.log(chalk.red(`[Telegram] Polling error: ${err.message}`));
  });

  return bot;
}

module.exports = { start };
