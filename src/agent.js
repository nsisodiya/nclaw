const { OpenAI } = require('openai');
const config = require('./config');
const chalk = require('chalk');
const contextLoader = require('./context_loader');
const eventBus = require('./event_bus');

/**
 * Run the agent for one user turn.
 * @param {string}  userInput
 * @param {Array}   history     - Previous messages (OpenAI format)
 * @param {string}  source      - 'cli' | 'telegram' | 'api' | 'web'
 * @param {object}  [agentConfig] - Agent configuration from agent_loader
 * @param {Array}   [agentConfig.tools]       - Array of { definition, handler } objects
 * @param {string}  [agentConfig.systemPrompt] - Pre-built system prompt (overrides contextLoader)
 * @param {number}  [agentConfig.maxSteps]     - Max ReAct loop steps
 * @param {string}  [agentConfig.model]        - Model override
 * @param {string}  [agentConfig.agentName]    - Name of the agent running
 * @returns {{ response: string, history: Array }}
 */
async function runAgent(userInput, history = [], source = 'cli', agentConfig = {}) {
  const model = agentConfig.model || config.lmStudio.model;
  const maxSteps = agentConfig.maxSteps || 15;
  const agentName = agentConfig.agentName || 'main';

  const openai = new OpenAI({
    baseURL: config.lmStudio.baseURL,
    apiKey: config.lmStudio.apiKey
  });

  // Use provided tools or fall back to registry
  const tools = agentConfig.tools || [];
  const toolDefinitions = tools.map((t) => t.definition);

  // Build system prompt: use provided one or build fresh
  const systemPrompt = agentConfig.systemPrompt || await contextLoader.build();

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userInput }
  ];

  eventBus.emit('agent:user_input', { input: userInput, source, agentName });

  let completed = false;
  let finalResponse = '';
  let loopCount = 0;

  while (!completed && loopCount < maxSteps) {
    loopCount++;
    eventBus.emit('agent:thinking', { step: loopCount, source, agentName });
    eventBus.emit('agent:llm_request', {
      step: loopCount,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls,
        tool_call_id: m.tool_call_id,
        name: m.name
      })),
      messageCount: messages.length,
      model,
      toolCount: toolDefinitions.length,
      source,
      agentName
    });
    console.log(chalk.blue(`\n[${agentName} Thinking... (Step ${loopCount})]`));

    try {
      // Streaming LLM call
      const stream = await openai.chat.completions.create({
        model,
        messages,
        tools: toolDefinitions.length > 0
          ? toolDefinitions.map((def) => ({ type: 'function', function: def }))
          : undefined,
        tool_choice: toolDefinitions.length > 0 ? 'auto' : undefined,
        stream: true,
        stream_options: { include_usage: true }
      });

      let fullContent = '';
      const toolCallsAccum = {};
      let usage = null;

      for await (const chunk of stream) {
        if (chunk.usage) usage = chunk.usage;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          fullContent += delta.content;
          eventBus.emit('agent:stream_chunk', {
            step: loopCount,
            text: delta.content,
            source,
            agentName
          });
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallsAccum[idx]) {
              toolCallsAccum[idx] = {
                id: '',
                type: 'function',
                function: { name: '', arguments: '' }
              };
            }
            if (tc.id) toolCallsAccum[idx].id = tc.id;
            if (tc.function?.name)
              toolCallsAccum[idx].function.name += tc.function.name;
            if (tc.function?.arguments)
              toolCallsAccum[idx].function.arguments += tc.function.arguments;
          }
        }
      }

      const toolCallsArray = Object.values(toolCallsAccum);
      const message = {
        role: 'assistant',
        content: fullContent || null,
        tool_calls: toolCallsArray.length > 0 ? toolCallsArray : undefined
      };

      eventBus.emit('agent:llm_response', {
        step: loopCount,
        usage,
        hasToolCalls: !!message.tool_calls?.length,
        toolCallCount: message.tool_calls?.length || 0,
        contentLength: (message.content || '').length,
        content: fullContent,
        source,
        agentName
      });

      messages.push(message);
      const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;

      if (hasToolCalls) {
        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          let toolArgs;

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            const errResult = {
              success: false,
              error: 'Invalid JSON arguments.'
            };
            eventBus.emit('agent:tool_result', {
              toolName,
              toolCallId: toolCall.id,
              success: false,
              result: errResult,
              source,
              agentName
            });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: JSON.stringify(errResult)
            });
            continue;
          }

          eventBus.emit('agent:tool_call', {
            toolName,
            args: toolArgs,
            toolCallId: toolCall.id,
            source,
            agentName
          });
          console.log(chalk.yellow(`[${agentName} Tool: ${toolName}]`));

          if (toolName === 'execute_command') {
            console.log(chalk.gray(`  > ${toolArgs.command}`));
          } else {
            console.log(
              chalk.gray(`  ${JSON.stringify(toolArgs).slice(0, 120)}…`)
            );
          }

          const tool = tools.find((t) => t.definition.name === toolName);
          let result;
          if (tool) {
            result = await tool.handler(toolArgs);
          } else {
            result = { success: false, error: `Tool not found: ${toolName}` };
          }

          eventBus.emit('agent:tool_result', {
            toolName,
            toolCallId: toolCall.id,
            success: result.success,
            result,
            source,
            agentName
          });

          if (result.success) {
            console.log(chalk.green(`  [OK]`));
          } else {
            console.log(chalk.red(`  [FAIL] ${result.error}`));
            console.log(chalk.magenta(`  [Agent will self-heal and retry…]`));
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify(result)
          });
        }
      } else if (message.content && message.content.trim()) {
        // Strip <think> reasoning blocks from final user-visible response
        finalResponse = message.content
          .replace(/<think>[\s\S]*?<\/think>/g, '')
          .trim();
        if (!finalResponse) finalResponse = message.content.trim();
        completed = true;
        eventBus.emit('agent:response', { response: finalResponse, source, agentName });
      } else {
        // Model returned empty content — nudge it to give a final answer
        messages.push({
          role: 'user',
          content:
            'Please provide your final answer based on the tool results above.'
        });
      }
    } catch (e) {
      console.log(chalk.red(`[${agentName} Error: ${e.message}]`));
      eventBus.emit('agent:error', { error: e.message, source, agentName });
      finalResponse = `Agent error: ${e.message}`;
      completed = true;
    }
  }

  if (loopCount >= maxSteps && !completed) {
    finalResponse = `[${agentName} reached max steps (${maxSteps}). Ask me to continue if needed.]`;
    eventBus.emit('agent:response', { response: finalResponse, source, agentName });
  }

  // Return history without the system message
  return { response: finalResponse, history: messages.slice(1) };
}

module.exports = { runAgent };
