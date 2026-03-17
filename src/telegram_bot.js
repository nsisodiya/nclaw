/**
 * Telegram bot interface for nclaw.
 * Allows sending messages to the agent from Telegram.
 *
 * Setup:
 *   1. Create a bot via @BotFather on Telegram
 *   2. Add TELEGRAM_BOT_TOKEN=<your-token> to .env
 *   3. The bot uses polling (no public server needed)
 *
 * Usage in Telegram:
 *   /start — welcome message
 *   /clear — clear conversation history
 *   /tasks — list active tasks
 *   Any other text — sent directly to the agent
 */
const chalk = require('chalk');

// Conversation history per chat_id (in-memory, resets on restart)
const histories = new Map();

function start(token, runAgent) {
  let TelegramBot;
  try {
    TelegramBot = require('node-telegram-bot-api');
  } catch {
    console.log(chalk.yellow('[Telegram] node-telegram-bot-api not installed. Run: npm install'));
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });

  console.log(chalk.green('[Telegram] Bot started. Send messages in Telegram to talk to nclaw.'));

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    // Commands
    if (text === '/start') {
      bot.sendMessage(chatId,
        '👋 *nclaw* is ready.\n\nSend any message to interact with your local AI agent.\n\n' +
        '/clear — clear conversation history\n/tasks — list active tasks',
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
      bot.sendMessage(chatId, result.success ? `📋 *Active Tasks*\n\n${result.data}` : '❌ ' + result.error, { parse_mode: 'Markdown' });
      return;
    }

    if (text === '/status') {
      bot.sendMessage(chatId, `🤖 nclaw is running. Uptime: ${Math.floor(process.uptime())}s`);
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
          await bot.sendMessage(chatId, chunk).catch(() =>
            bot.sendMessage(chatId, chunk, {}) // retry without markdown if parse fails
          );
        }
      } else {
        await bot.sendMessage(chatId, response).catch(() =>
          bot.sendMessage(chatId, response, {})
        );
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
