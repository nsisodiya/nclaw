/**
 * Central event bus for all agent activity.
 * Used by: agent.js (emit), server.js (subscribe), telegram_bot.js (subscribe)
 *
 * Events:
 *   agent:user_input   { input, source }
 *   agent:thinking     { step, source }
 *   agent:tool_call    { toolName, args, toolCallId, source }
 *   agent:tool_result  { toolName, toolCallId, success, result, source }
 *   agent:response     { response, source }
 *   agent:error        { error, source }
 */
const EventEmitter = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50);

module.exports = bus;
