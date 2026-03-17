const { OpenAI } = require('openai');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const terminalSkill = require('./tools/terminal_skill');
const fsSkill = require('./tools/fs_skill');
const chalk = require('chalk');

const openai = new OpenAI({
  baseURL: config.lmStudio.baseURL,
  apiKey: config.lmStudio.apiKey,
});

const tools = [
  terminalSkill,
  fsSkill
];

const toolDefinitions = tools.map(t => t.definition);

async function runAgent(userInput, history = []) {
  const soul = await fs.readFile(path.join(__dirname, '../soul.md'), 'utf8');
  
  const messages = [
    { role: "system", content: soul },
    ...history,
    { role: "user", content: userInput }
  ];

  let completed = false;
  let finalResponse = "";

  while (!completed) {
    console.log(chalk.blue("\n[nclaw Thinking...]"));
    
    const response = await openai.chat.completions.create({
      model: config.lmStudio.model,
      messages: messages,
      tools: toolDefinitions.map(def => ({ type: "function", function: def })),
      tool_choice: "auto",
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
          console.log(chalk.red(`[Error parsing tool arguments: ${e.message}]`));
          continue;
        }
        
        console.log(chalk.yellow(`[nclaw Executing Tool: ${toolName}]`));
        console.log(chalk.gray(`Args: ${JSON.stringify(toolArgs)}`));

        const tool = tools.find(t => t.definition.name === toolName);
        let result;
        if (tool) {
          result = await tool.handler(toolArgs);
        } else {
          result = { success: false, error: "Tool not found" };
        }

        console.log(chalk.green(`[Tool Result: ${result.success ? 'Success' : 'Failed'}]`));

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify(result),
        });
      }
      
      // If there's also content along with tool calls, we don't treat it as final yet.
    } else if (message.content && message.content.trim().length > 0) {
      finalResponse = message.content;
      completed = true;
    } else {
      // No tool calls and no content (empty response from LLM)
      finalResponse = "[No response from model]";
      completed = true;
    }
  }

  return { response: finalResponse, history: messages.slice(1) };
}

module.exports = { runAgent };
