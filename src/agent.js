const { OpenAI } = require('openai');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const terminalSkill = require('./tools/terminal_skill');
const fsSkill = require('./tools/fs_skill');
const multiReplaceSkill = require('./tools/multi_replace_file_content');
const chalk = require('chalk');

const openai = new OpenAI({
  baseURL: config.lmStudio.baseURL,
  apiKey: config.lmStudio.apiKey,
});

const tools = [
  terminalSkill,
  fsSkill,
  multiReplaceSkill
];

const toolDefinitions = tools.map(t => t.definition);

async function runAgent(userInput, history = []) {
  const soul = await fs.readFile(path.join(__dirname, '../soul.md'), 'utf8');
  
  // ReAct Prompt injection
  const reactPrompt = `
Additional Instructions for Autonomy (ReAct):
1. Think step-by-step. If the user asks for a complex task, break it down.
2. If a tool fails (e.g., a terminal command returns an error or exit code > 0), DO NOT just give up. Read the error, understand what went wrong, and use your tools to fix it. Loop until you succeed.
3. Be precise with file edits using the 'multi_replace_file_content' tool.
`;

  const messages = [
    { role: "system", content: soul + reactPrompt },
    ...history,
    { role: "user", content: userInput }
  ];

  let completed = false;
  let finalResponse = "";
  let loopCount = 0;
  const MAX_LOOPS = 15; // Safeguard against true infinite loops

  while (!completed && loopCount < MAX_LOOPS) {
    loopCount++;
    console.log(chalk.blue(`\n[nclaw Thinking... (Step ${loopCount})]`));
    
    try {
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
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: toolName,
              content: JSON.stringify({ success: false, error: "Invalid JSON arguments provided." }),
            });
            continue;
          }
          
          console.log(chalk.yellow(`[nclaw Executing Tool: ${toolName}]`));
          
          if(toolName === 'execute_command') {
            console.log(chalk.gray(`> ${toolArgs.command}`));
          } else {
             // abbreviate large arguments for logging
             const logArgs = JSON.stringify(toolArgs).substring(0, 150) + "...";
            console.log(chalk.gray(`Args: ${logArgs}`));
          }

          const tool = tools.find(t => t.definition.name === toolName);
          let result;
          if (tool) {
            result = await tool.handler(toolArgs);
          } else {
            result = { success: false, error: "Tool not found" };
          }

          if (result.success) {
            console.log(chalk.green(`[Tool Result: Success]`));
          } else {
             console.log(chalk.red(`[Tool Result: Failed - ${result.error}]`));
             console.log(chalk.magenta(`[nclaw Notice: Agent will attempt to self-heal and retry...]`));
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify(result),
          });
        }
        
      } else if (message.content && message.content.trim().length > 0) {
        finalResponse = message.content;
        completed = true;
      } else {
        finalResponse = "[Empty response from model. Task concluded or aborted.]";
        completed = true;
      }
    } catch (e) {
      console.log(chalk.red(`[Agent Loop Error: ${e.message}]`));
      finalResponse = `Agent crashed during thinking: ${e.message}`;
      completed = true;
    }
  }

  if (loopCount >= MAX_LOOPS) {
      finalResponse = `[nclaw aborted: Reached maximum thinking steps (${MAX_LOOPS}). Ask me to continue if needed.]`;
  }

  return { response: finalResponse, history: messages.slice(1) };
}

module.exports = { runAgent };
