# nclaw

A local AI agent inspired by OpenClaw, powered by LM Studio and Qwen 3.5 9b.

## Features
- **Local First**: Runs entirely on your hardware via LM Studio.
- **Terminal Skill**: Execute shell commands.
- **FileSystem Skill**: Read, write, list, and delete files.
- **Agentic Loop**: Reasons and uses tools autonomously to complete tasks.

## Prerequisites
- **Node.js**: Version 18+ recommended.
- **LM Studio**: Running with `qwen/qwen3.5-9b` (or similar) loaded and the local server enabled (default: `http://localhost:1234/v1`).

## Setup
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. (Optional) Create a `.env` file if your LM Studio URL is different:
   ```env
   LM_STUDIO_URL=http://localhost:1234/v1
   ```

## Usage
Start the agent:
```bash
node src/cli.js
```

### Example Commands
- "List the files in this directory."
- "Create a new file named notes.md with some project ideas."
- "What is the current time and date?" (Using terminal `date`)

## License
MIT
