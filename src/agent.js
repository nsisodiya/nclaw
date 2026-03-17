const { OpenAI } = require('openai');
const config = require('./config');
const chalk = require('chalk');
const contextLoader = require('./context_loader');
const eventBus = require('./event_bus');

// Tools
const terminalSkill      = require('./tools/terminal_skill');
const fsSkill            = require('./tools/fs_skill');
const multiReplaceSkill  = require('./tools/multi_replace_file_content');
const memorySkill        = require('./tools/memory_skill');
const taskSkill          = require('./tools/task_skill');
const clipboardSkill     = require('./tools/clipboard_skill');
const notifySkill        = require('./tools/notify_skill');
const gitSkill           = require('./tools/git_skill');
const projectSkill       = require('./tools/project_skill');
const webSkill           = require('./tools/web_skill');

const openai = new OpenAI({
  baseURL: config.lmStudio.baseURL,
  apiKey:  config.lmStudio.apiKey,
});

const tools = [
  terminalSkill,
  fsSkill,
  multiReplaceSkill,
  memorySkill,
  taskSkill,
  clipboardSkill,
  notifySkill,
  gitSkill,
  projectSkill,
  webSkill,
];

const toolDefinitions = tools.map(t => t.definition);

/**
 * Run the agent for one user turn.
 * @param {string} userInput
 * @param {Array}  history   - Previous messages (OpenAI format)
 * @param {string} source    - 'cli' | 'telegram' | 'api'
 * @returns {{ response: string, history: Array }}
 */
async function runAgent(userInput, history = [], source = 'cli') {
  // Build system prompt fresh each call (picks up memory/task changes)
  const systemPrompt = await contextLoader.build();

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userInput },
  ];

  eventBus.emit('agent:user_input', { input: userInput, source });

  let completed = false;
  let finalResponse = '';
  let loopCount = 0;
  const MAX_LOOPS = 15;

  while (!completed && loopCount < MAX_LOOPS) {
    loopCount++;
    eventBus.emit('agent:thinking', { step: loopCount, source });
    console.log(chalk.blue(`\n[nclaw Thinking... (Step ${loopCount})]`));

    try {
      const response = await openai.chat.completions.create({
        model:       config.lmStudio.model,
        messages,
        tools:       toolDefinitions.map(def => ({ type: 'function', function: def })),
        tool_choice: 'auto',
      });

      const message = response.choices[0].message;
      messages.push(message);

      const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;

      if (hasToolCalls) {
        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          let toolArgs;

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            const errResult = { success: false, error: 'Invalid JSON arguments.' };
            eventBus.emit('agent:tool_result', { toolName, toolCallId: toolCall.id, success: false, result: errResult, source });
            messages.push({ role: 'tool', tool_call_id: toolCall.id, name: toolName, content: JSON.stringify(errResult) });
            continue;
          }

          eventBus.emit('agent:tool_call', { toolName, args: toolArgs, toolCallId: toolCall.id, source });
          console.log(chalk.yellow(`[Tool: ${toolName}]`));

          if (toolName === 'execute_command') {
            console.log(chalk.gray(`  > ${toolArgs.command}`));
          } else {
            console.log(chalk.gray(`  ${JSON.stringify(toolArgs).slice(0, 120)}…`));
          }

          const tool = tools.find(t => t.definition.name === toolName);
          let result;
          if (tool) {
            result = await tool.handler(toolArgs);
          } else {
            result = { success: false, error: `Tool not found: ${toolName}` };
          }

          eventBus.emit('agent:tool_result', { toolName, toolCallId: toolCall.id, success: result.success, result, source });

          if (result.success) {
            console.log(chalk.green(`  [OK]`));
          } else {
            console.log(chalk.red(`  [FAIL] ${result.error}`));
            console.log(chalk.magenta(`  [Agent will self-heal and retry…]`));
          }

          messages.push({ role: 'tool', tool_call_id: toolCall.id, name: toolName, content: JSON.stringify(result) });
        }

      } else if (message.content && message.content.trim()) {
        finalResponse = message.content;
        completed = true;
        eventBus.emit('agent:response', { response: finalResponse, source });

      } else {
        // Model returned empty content — nudge it to give a final answer
        messages.push({ role: 'user', content: 'Please provide your final answer based on the tool results above.' });
      }

    } catch (e) {
      console.log(chalk.red(`[Agent Error: ${e.message}]`));
      eventBus.emit('agent:error', { error: e.message, source });
      finalResponse = `Agent error: ${e.message}`;
      completed = true;
    }
  }

  if (loopCount >= MAX_LOOPS && !completed) {
    finalResponse = `[nclaw reached max steps (${MAX_LOOPS}). Ask me to continue if needed.]`;
    eventBus.emit('agent:response', { response: finalResponse, source });
  }

  // Return history without the system message
  return { response: finalResponse, history: messages.slice(1) };
}

module.exports = { runAgent };
