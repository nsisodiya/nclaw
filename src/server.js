/**
 * Express server for the nclaw activity monitor UI.
 * Serves the dashboard at http://localhost:3721
 * Streams all agent events in real-time via SSE at /events
 */
const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const eventBus = require('./event_bus');
const config = require('./config');

let _runAgent = null;
let _telegramStarter = null;
let _orchestrator = null;
let webChatHistory = [];

function setAgent(fn) {
  _runAgent = fn;
}

function setTelegramStarter(fn) {
  _telegramStarter = fn;
}

function setOrchestrator(orch) {
  _orchestrator = orch;
}

const app = express();
app.use(express.json());

const NCLAW_DIR = path.join(os.homedir(), '.nclaw');

// Serve the dashboard
app.get(['/', '/chat', '/inspector', '/setup', '/settings'], (req, res) => {
  res.sendFile(path.join(__dirname, 'ui', 'index.html'));
});

// SSE endpoint — browser connects here for real-time events
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = (eventName, data) => {
    const payload = JSON.stringify({
      ...data,
      timestamp: new Date().toISOString()
    });
    res.write(`event: ${eventName}\ndata: ${payload}\n\n`);
  };

  const AGENT_EVENTS = [
    'agent:user_input',
    'agent:thinking',
    'agent:llm_request',
    'agent:llm_response',
    'agent:stream_chunk',
    'agent:tool_call',
    'agent:tool_result',
    'agent:response',
    'agent:error'
  ];

  const handlers = {};
  for (const event of AGENT_EVENTS) {
    const shortName = event.replace('agent:', '');
    handlers[event] = (data) => send(shortName, data);
    eventBus.on(event, handlers[event]);
  }

  // Keep-alive every 20s to prevent proxy timeouts
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);

  req.on('close', () => {
    clearInterval(ping);
    for (const event of AGENT_EVENTS) {
      eventBus.off(event, handlers[event]);
    }
  });
});

// Chat API — web UI sends messages here
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });
  if (!_runAgent)
    return res
      .status(503)
      .json({ error: 'Agent not initialized. Make sure nclaw is running.' });
  try {
    const result = await _runAgent(message, webChatHistory, 'web');
    webChatHistory = result.history;
    res.json({ response: result.response });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chat/clear', (req, res) => {
  webChatHistory = [];
  res.json({ ok: true });
});

// Config endpoint — exposes non-secret config to the UI
app.get('/api/config', (req, res) => {
  const token = config.telegramBotToken || '';
  res.json({
    lmStudioUrl: config.lmStudio.baseURL,
    model: config.lmStudio.model,
    hasTelegram: !!token,
    telegramBotToken: token,
    telegramAllowedUsers: config.telegramAllowedUsers || []
  });
});

// Status API — returns memory/skill/task/agent/tool counts
app.get('/api/status', async (req, res) => {
  const result = {
    factsCount: 0,
    skillsCount: 0,
    processesCount: 0,
    activeTasksCount: 0,
    agentsCount: _orchestrator ? _orchestrator.getAgentList().length : 0,
    toolsCount: _orchestrator ? _orchestrator.getToolList().length : 0,
    uptime: Math.floor(process.uptime())
  };

  try {
    const facts = await fs.readFile(
      path.join(NCLAW_DIR, 'memory', 'facts.md'),
      'utf8'
    );
    result.factsCount = facts
      .split('\n')
      .filter((l) => l.trim().startsWith('-')).length;
  } catch {}

  try {
    const skills = await fs.readdir(path.join(NCLAW_DIR, 'skills'));
    result.skillsCount = skills.filter((f) => f.endsWith('.md')).length;
  } catch {}

  try {
    const processes = await fs.readdir(path.join(NCLAW_DIR, 'processes'));
    result.processesCount = processes.filter((f) => f.endsWith('.md')).length;
  } catch {}

  try {
    const tasks = await fs.readdir(path.join(NCLAW_DIR, 'tasks', 'active'));
    result.activeTasksCount = tasks.filter((f) => f.endsWith('.md')).length;
  } catch {}

  res.json(result);
});

// Memory/skills/tasks read endpoints for UI
app.get('/api/memory/facts', async (req, res) => {
  try {
    const data = await fs.readFile(
      path.join(NCLAW_DIR, 'memory', 'facts.md'),
      'utf8'
    );
    res.type('text/plain').send(data);
  } catch {
    res.send('(empty)');
  }
});

app.get('/api/tasks/active', async (req, res) => {
  try {
    const files = (
      await fs.readdir(path.join(NCLAW_DIR, 'tasks', 'active'))
    ).filter((f) => f.endsWith('.md'));
    const tasks = [];
    for (const f of files) {
      const content = await fs.readFile(
        path.join(NCLAW_DIR, 'tasks', 'active', f),
        'utf8'
      );
      tasks.push({ file: f, content });
    }
    res.json(tasks);
  } catch {
    res.json([]);
  }
});

// Save config to ~/.nclaw/config.json
app.post('/api/config', async (req, res) => {
  const {
    lmStudioBaseURL,
    lmStudioModel,
    telegramBotToken,
    telegramAllowedUsers
  } = req.body;
  const data = {
    lmStudioBaseURL: lmStudioBaseURL || config.lmStudio.baseURL,
    lmStudioModel: lmStudioModel || config.lmStudio.model,
    lmStudioApiKey: 'lm-studio',
    telegramBotToken:
      telegramBotToken !== undefined
        ? telegramBotToken
        : config.telegramBotToken,
    telegramAllowedUsers:
      telegramAllowedUsers !== undefined
        ? telegramAllowedUsers
        : config.telegramAllowedUsers || []
  };
  try {
    await fs.writeFile(config._path, JSON.stringify(data, null, 2), 'utf8');
    config._reload();
    // Start the telegram bot if a token was just saved and we have an agent
    if (telegramBotToken && _telegramStarter) {
      _telegramStarter(telegramBotToken);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Setup check — probe LM Studio server and list available models
app.get('/api/setup/check', async (req, res) => {
  const baseURL = (req.query.url || config.lmStudio.baseURL).replace(/\/$/, '');
  const model = req.query.model || config.lmStudio.model;
  try {
    const axios = require('axios');
    const r = await axios.get(`${baseURL}/models`, { timeout: 4000 });
    const models = (r.data.data || []).map((m) => m.id);
    const modelLoaded = models.some(
      (m) => m.toLowerCase() === model.toLowerCase()
    );
    res.json({ reachable: true, models, configuredModel: model, modelLoaded });
  } catch (e) {
    res.json({
      reachable: false,
      models: [],
      configuredModel: model,
      modelLoaded: false,
      error: e.message
    });
  }
});

// Version info endpoint
app.get('/api/version', (req, res) => {
  const pkg = require('../package.json');
  res.json({ version: pkg.version, name: pkg.name });
});

// Agent list endpoint — returns available agents
app.get('/api/agents', (req, res) => {
  if (!_orchestrator) return res.json([]);
  res.json(_orchestrator.getAgentList());
});

// Tool list endpoint — returns all registered tools
app.get('/api/tools', (req, res) => {
  if (!_orchestrator) return res.json([]);
  res.json(_orchestrator.getToolList());
});

// Upgrade endpoint — runs npm install -g nclaw and streams output
app.post('/api/upgrade', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, text) =>
    res.write(`data: ${JSON.stringify({ type, text })}\n\n`);

  send('log', 'Running: npm install -g nclaw\n');

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = require('child_process').spawn(
    npm,
    ['install', '-g', 'nclaw'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  child.stdout.on('data', (d) => send('log', d.toString()));
  child.stderr.on('data', (d) => send('log', d.toString()));

  child.on('close', (code) => {
    if (code === 0) {
      send('done', 'Upgrade complete! Restart nclaw to use the new version.');
    } else {
      send('error', `npm exited with code ${code}`);
    }
    res.end();
  });
});

function start(port = 3721) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, (err) => {
      if (err) return reject(err);
      console.log(`\n  nclaw UI → http://localhost:${port}\n`);
      require('child_process')
        .spawn('open', [`http://localhost:${port}`], {
          detached: true,
          stdio: 'ignore'
        })
        .unref();
      resolve(server);
    });
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.log(`  [UI] Port ${port} in use, UI not started.`);
        resolve(null);
      } else {
        reject(e);
      }
    });
  });
}

module.exports = { start, setAgent, setTelegramStarter, setOrchestrator };
