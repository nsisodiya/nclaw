/**
 * Orchestrator — manages agent lifecycle, routing, and delegation.
 *
 * Responsibilities:
 *   1. Load agent definitions and tool registry
 *   2. Route user input to the correct agent (main or @agent)
 *   3. Handle delegate_task tool calls between agents
 *   4. Build per-agent system prompts and tool sets
 */
const chalk = require('chalk');
const { runAgent } = require('./agent');
const { loadAgents } = require('./agent_loader');
const ToolRegistry = require('./tool_registry');
const contextLoader = require('./context_loader');
const eventBus = require('./event_bus');
const delegateSkill = require('./tools/delegate_skill');

class Orchestrator {
  constructor() {
    this.agents = new Map();
    this.registry = new ToolRegistry();
    this.initialized = false;
  }

  async init() {
    // Load tool registry
    await this.registry.discoverAndLoad();

    // Load agent definitions
    this.agents = await loadAgents();

    // Wire up delegate_task handler
    delegateSkill.setDelegateHandler(async ({ agent, task, context }) => {
      return this.delegate(agent, task, context);
    });

    this.initialized = true;

    const agentNames = Array.from(this.agents.keys());
    const toolCount = this.registry.getAll().length;
    console.log(
      chalk.dim(`  [${toolCount} tools, ${agentNames.length} agent(s): ${agentNames.join(', ')}]`)
    );
  }

  /**
   * Parse @agent prefix from user input.
   * Returns { agentName, input } where agentName is null if no prefix.
   */
  parseAgentPrefix(input) {
    const match = input.match(/^@(\w+)\s+([\s\S]+)/);
    if (match && this.agents.has(match[1].toLowerCase())) {
      return {
        agentName: match[1].toLowerCase(),
        input: match[2].trim()
      };
    }
    return { agentName: null, input };
  }

  /**
   * Build the tools array for a specific agent.
   * If the agent defines specific tools, filter the registry.
   * The main agent also gets delegate_task if other agents exist.
   * Applies permission constraints from agent config.
   */
  getToolsForAgent(agentName) {
    const agentConfig = this.agents.get(agentName);
    if (!agentConfig) return this.registry.getAll();

    let tools;
    if (agentConfig.tools) {
      tools = this.registry.getForAgent(agentConfig.tools);
    } else {
      tools = this.registry.getAll();
    }

    // Add delegate_task to main agent if there are other agents
    if (agentName === 'main' && this.agents.size > 1) {
      const hasDelegateAlready = tools.some((t) => t.definition.name === 'delegate_task');
      if (!hasDelegateAlready) {
        tools = [...tools, {
          definition: delegateSkill.definition,
          handler: delegateSkill.handler
        }];
      }
    }

    // Apply permission constraints
    const constraints = agentConfig.constraints || {};
    if (Object.keys(constraints).length > 0) {
      tools = tools.map((tool) => this._wrapWithPermissions(tool, constraints));
    }

    return tools;
  }

  /**
   * Wrap a tool handler with permission checks based on agent constraints.
   * Constraints:
   *   - read_only: block all write/execute operations
   *   - deny: list of command patterns to block
   *   - confirm_before: list of patterns requiring confirmation (logged, not interactive)
   *   - allowed_dirs: restrict file operations to specific directories
   */
  _wrapWithPermissions(tool, constraints) {
    const originalHandler = tool.handler;
    const toolName = tool.definition.name;

    const wrappedHandler = async (args) => {
      // Check read_only constraint
      if (constraints.read_only === true) {
        const writingTools = ['execute_command', 'manage_file', 'multi_replace_file_content', 'git_operation'];
        if (writingTools.includes(toolName)) {
          // Allow read operations through manage_file
          if (toolName === 'manage_file' && args.action === 'read') {
            return originalHandler(args);
          }
          // Allow git status/log/diff
          if (toolName === 'git_operation' && ['status', 'diff', 'log'].includes(args.action)) {
            return originalHandler(args);
          }
          return { success: false, error: 'This agent is read-only. Cannot perform write operations.' };
        }
      }

      // Check deny list for execute_command
      if (toolName === 'execute_command' && constraints.deny && args.command) {
        for (const pattern of constraints.deny) {
          if (args.command.includes(pattern)) {
            return { success: false, error: `Command denied by agent constraints: "${pattern}" is not allowed.` };
          }
        }
      }

      // Check allowed_dirs for file operations
      if (constraints.allowed_dirs && args.path) {
        const os = require('os');
        const path = require('path');
        const resolvedPath = path.resolve(args.path.replace(/^~/, os.homedir()));
        const allowed = constraints.allowed_dirs.some((dir) => {
          const resolvedDir = path.resolve(dir.replace(/^~/, os.homedir()));
          return resolvedPath.startsWith(resolvedDir);
        });
        if (!allowed) {
          return { success: false, error: `Path "${args.path}" is outside allowed directories.` };
        }
      }

      // Log confirm_before warnings
      if (toolName === 'execute_command' && constraints.confirm_before && args.command) {
        for (const pattern of constraints.confirm_before) {
          if (args.command.includes(pattern)) {
            console.log(chalk.yellow(`  [CAUTION] Agent "${toolName}" executing: ${args.command}`));
            break;
          }
        }
      }

      return originalHandler(args);
    };

    return { definition: tool.definition, handler: wrappedHandler, metadata: tool.metadata };
  }

  /**
   * Run user input through the appropriate agent.
   * Handles @agent prefix routing.
   */
  async run(userInput, history = [], source = 'cli') {
    if (!this.initialized) await this.init();

    // Check for @agent prefix
    const { agentName, input } = this.parseAgentPrefix(userInput);
    const targetAgent = agentName || 'main';

    return this._runNamedAgent(targetAgent, input, history, source);
  }

  /**
   * Run a specific named agent.
   */
  async _runNamedAgent(agentName, input, history = [], source = 'cli') {
    const agentConfig = this.agents.get(agentName);
    if (!agentConfig) {
      return {
        response: `Agent "${agentName}" not found. Available: ${Array.from(this.agents.keys()).join(', ')}`,
        history
      };
    }

    const tools = this.getToolsForAgent(agentName);
    const systemPrompt = await contextLoader.build({
      identity: agentConfig.identity || undefined,
      contextSources: agentConfig.contextSources,
      delegations: agentConfig.delegations
    });

    return runAgent(input, history, source, {
      tools,
      systemPrompt,
      maxSteps: agentConfig.constraints.max_steps || 15,
      model: agentConfig.constraints.model || undefined,
      agentName
    });
  }

  /**
   * Delegate a task from the main agent to a specialized agent.
   * Returns a condensed result to save context.
   */
  async delegate(agentName, task, context = '') {
    const agentConfig = this.agents.get(agentName);
    if (!agentConfig) {
      return {
        success: false,
        error: `Agent "${agentName}" not found. Available: ${Array.from(this.agents.keys()).filter(n => n !== 'main').join(', ')}`
      };
    }

    eventBus.emit('agent:delegation', {
      from: 'main',
      to: agentName,
      task
    });

    console.log(chalk.cyan(`\n[Delegating to ${agentName}]: ${task.slice(0, 80)}…`));

    // Build the delegated prompt with context
    const delegatedInput = context
      ? `${task}\n\nContext:\n${context}`
      : task;

    try {
      // Run the sub-agent with fresh history (no shared context)
      const result = await this._runNamedAgent(agentName, delegatedInput, [], 'delegation');

      eventBus.emit('agent:delegation_complete', {
        from: 'main',
        to: agentName,
        success: true
      });

      // Return condensed result to save main agent's context
      const truncated = result.response.length > 2000
        ? result.response.slice(0, 2000) + '\n... (truncated)'
        : result.response;

      return {
        success: true,
        data: truncated,
        agent: agentName
      };
    } catch (e) {
      eventBus.emit('agent:delegation_complete', {
        from: 'main',
        to: agentName,
        success: false,
        error: e.message
      });

      return {
        success: false,
        error: `Delegation to ${agentName} failed: ${e.message}`
      };
    }
  }

  /**
   * Get list of available agents for UI/API.
   */
  getAgentList() {
    const list = [];
    for (const [name, config] of this.agents) {
      list.push({
        name,
        hasCustomTools: config.tools !== null,
        toolCount: config.tools ? config.tools.length : this.registry.getAll().length,
        hasDelegations: Object.keys(config.delegations).length > 0
      });
    }
    return list;
  }

  /**
   * Get tool registry info for UI/API.
   */
  getToolList() {
    return this.registry.getAll().map((t) => ({
      name: t.definition.name,
      description: t.definition.description,
      source: t.metadata.source || 'builtin'
    }));
  }
}

module.exports = Orchestrator;
