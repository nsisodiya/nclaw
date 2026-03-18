/**
 * delegate_task tool — allows the orchestrator/main agent to delegate
 * sub-tasks to specialized agents.
 *
 * The actual delegation logic is injected by the orchestrator at runtime
 * via setDelegateHandler(). This file only defines the tool interface.
 */

let _delegateHandler = null;

const definition = {
  name: 'delegate_task',
  description: 'Delegate a sub-task to a specialized agent. Use this when a task matches another agent\'s expertise.',
  parameters: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description: 'Name of the agent to delegate to (e.g., "coder", "researcher")'
      },
      task: {
        type: 'string',
        description: 'Clear description of what the agent should do'
      },
      context: {
        type: 'string',
        description: 'Relevant context to pass to the agent (file contents, previous results, etc.)'
      }
    },
    required: ['agent', 'task']
  }
};

async function handler({ agent, task, context }) {
  if (!_delegateHandler) {
    return {
      success: false,
      error: 'Delegation not available. No orchestrator configured.'
    };
  }
  return _delegateHandler({ agent, task, context });
}

function setDelegateHandler(fn) {
  _delegateHandler = fn;
}

module.exports = { definition, handler, setDelegateHandler };
