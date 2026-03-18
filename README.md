# nclaw

A markdown-driven local AI agent for MacBook productivity, powered by LM Studio.

## Install

**Via npm (recommended):**
```bash
npm install -g nclaw
```

**Via curl:**
```bash
curl -fsSL https://raw.githubusercontent.com/nsisodiya/nclaw/refs/heads/main/install.sh | bash
```

## Prerequisites

- **Node.js** 18+
- **LM Studio** running with a model loaded and the local server enabled (default: `http://localhost:1234/v1`)

## Usage

```bash
nclaw
```

This starts the agent and opens the UI at **http://localhost:3721**.

## Configuration

Create a `.env` file in your home directory or wherever you run nclaw:

```env
LM_STUDIO_BASE_URL=http://localhost:1234/v1
LM_STUDIO_MODEL=qwen/qwen3.5-9b
TELEGRAM_BOT_TOKEN=your_token_here   # optional
```

## Upgrading

**One-click:** Open the UI → Settings → click **↑ Upgrade to latest**

**Or via terminal:**
```bash
npm install -g nclaw
```

Every push to `main` is automatically published — you always get the latest when you upgrade.

## Features

- Local-first: all processing runs on your hardware via LM Studio
- ReAct agentic loop with 10 built-in tools
- Markdown-driven skills & processes in `~/.nclaw/`
- Persistent memory across sessions
- Telegram bot integration (no public server needed)
- Real-time activity monitor UI with streaming output

## License

MIT
