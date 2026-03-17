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

const app = express();
app.use(express.json());

const NCLAW_DIR = path.join(os.homedir(), '.nclaw');

// Serve the dashboard
app.get('/', (req, res) => {
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
    const payload = JSON.stringify({ ...data, timestamp: new Date().toISOString() });
    res.write(`event: ${eventName}\ndata: ${payload}\n\n`);
  };

  const AGENT_EVENTS = [
    'agent:user_input',
    'agent:thinking',
    'agent:tool_call',
    'agent:tool_result',
    'agent:response',
    'agent:error',
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

// Status API — returns memory/skill/task counts
app.get('/api/status', async (req, res) => {
  const result = { factsCount: 0, skillsCount: 0, processesCount: 0, activeTasksCount: 0, uptime: Math.floor(process.uptime()) };

  try {
    const facts = await fs.readFile(path.join(NCLAW_DIR, 'memory', 'facts.md'), 'utf8');
    result.factsCount = facts.split('\n').filter(l => l.trim().startsWith('-')).length;
  } catch {}

  try {
    const skills = await fs.readdir(path.join(NCLAW_DIR, 'skills'));
    result.skillsCount = skills.filter(f => f.endsWith('.md')).length;
  } catch {}

  try {
    const processes = await fs.readdir(path.join(NCLAW_DIR, 'processes'));
    result.processesCount = processes.filter(f => f.endsWith('.md')).length;
  } catch {}

  try {
    const tasks = await fs.readdir(path.join(NCLAW_DIR, 'tasks', 'active'));
    result.activeTasksCount = tasks.filter(f => f.endsWith('.md')).length;
  } catch {}

  res.json(result);
});

// Memory/skills/tasks read endpoints for UI
app.get('/api/memory/facts', async (req, res) => {
  try {
    const data = await fs.readFile(path.join(NCLAW_DIR, 'memory', 'facts.md'), 'utf8');
    res.type('text/plain').send(data);
  } catch { res.send('(empty)'); }
});

app.get('/api/tasks/active', async (req, res) => {
  try {
    const files = (await fs.readdir(path.join(NCLAW_DIR, 'tasks', 'active'))).filter(f => f.endsWith('.md'));
    const tasks = [];
    for (const f of files) {
      const content = await fs.readFile(path.join(NCLAW_DIR, 'tasks', 'active', f), 'utf8');
      tasks.push({ file: f, content });
    }
    res.json(tasks);
  } catch { res.json([]); }
});

function start(port = 3721) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, (err) => {
      if (err) return reject(err);
      console.log(`\n  nclaw UI → http://localhost:${port}\n`);
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

module.exports = { start };
