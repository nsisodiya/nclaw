# nclaw Roadmap

## Vision

nclaw is the best local AI agent for MacBook productivity, running 100% on local hardware via LM Studio.

**Core philosophy**: Behavior is defined in markdown files, not code. Skills, processes, tasks, and memory are all markdown files the LLM reads and understands naturally — just like a task runner built from markdown rules.

---

## Current State

- ReAct loop agent with 3 tools: terminal, filesystem, multi-replace
- `soul.md` as markdown-driven personality/system prompt
- In-memory conversation history (lost on exit)
- LM Studio + Qwen 3.5 9B via OpenAI SDK

---

## Phase 1: Memory System ✅ TODO

**Goal**: nclaw remembers across sessions.

### Directory structure
```
~/.nclaw/
  memory/
    facts.md          # Learned facts (user preferences, projects) — max 50 lines
    scratchpad.md      # Agent's working notes across sessions — max 30 lines
    session-log/
      YYYY-MM-DD.md    # Daily conversation summaries
```

### Changes
- **New**: `src/context_loader.js` — assembles system prompt from soul.md + memory files. Enforces token budgets.
- **New**: `src/tools/memory_skill.js` — tool with actions: `remember_fact`, `read_memory`, `update_scratchpad`, `summarize_session`
- **Modify**: `src/agent.js` — use `context_loader.build()` instead of inline soul reading. Register memory tool.
- **Modify**: `src/cli.js` — init `~/.nclaw/` dirs on first run. On exit, trigger session summary LLM call.
- **Modify**: `soul.md` — add section on when/how to use memory tools.

---

## Phase 2: Markdown-Driven Skills ✅ TODO

**Goal**: Teach the agent new capabilities by dropping a `.md` file. No code changes needed.

### Directory structure
```
~/.nclaw/
  skills/
    git-commit.md
    code-review.md
    summarize-file.md
    explain-error.md
    find-and-replace.md
```

### Skill file format
```markdown
# Skill: Git Commit
## When to use
When the user asks to commit changes or save work.
## Required tools
- execute_command
## Steps
1. Run `git status` to see changes.
2. Show user what will be committed.
3. Ask for or suggest a commit message.
4. Run `git add -A && git commit -m "<message>"`.
## Notes
- Never force push.
```

### Changes
- **New**: `src/skill_loader.js` — scans `~/.nclaw/skills/*.md`, extracts name + trigger description, returns compact index string
- **Modify**: `src/context_loader.js` — append skill index to system prompt
- **Modify**: `soul.md` — add: "When a request matches a skill, read the full skill file via `manage_file`, then follow its steps."
- **Create**: 5–6 starter skill files

### Key design: Lazy loading
Only the index (name + one-line trigger) goes into context. Full skill files are read on-demand. Keeps system prompt small for 9B model.

---

## Phase 3: Task System ✅ TODO

**Goal**: Agent decomposes complex requests into subtasks, tracks progress, and resumes across sessions.

### Directory structure
```
~/.nclaw/
  tasks/
    active/
      2026-03-17-refactor-auth.md
    completed/
```

### Task file format
```markdown
# Task: Refactor auth module
## Status: in-progress
## Created: 2026-03-17
## Goal
Replace session cookies with JWT.
## Subtasks
- [x] Audit current auth code
- [ ] Install jsonwebtoken package
- [ ] Create JWT utility functions
## Log
- 2026-03-17 10:30: Started audit. Found 12 session files.
```

### Changes
- **New**: `src/tools/task_skill.js` — actions: `create_task`, `decompose` (generates subtask checklist), `update_task`, `list_tasks`, `complete_task`
- **Modify**: `src/context_loader.js` — load active task headers + checklists into context
- **Modify**: `soul.md` — add: "If a task will take >3 tool calls, create a task first. Break it into subtasks."

### Task continuation
On startup, if active tasks exist, agent can say "You have an in-progress task: X. Want me to continue?"

---

## Phase 4: Process System (Playbooks) ✅ TODO

**Goal**: Reusable multi-step workflows with prerequisites, decision points, and rollback.

### Directory structure
```
~/.nclaw/
  processes/
    deploy-to-production.md
    new-feature-workflow.md
    daily-standup.md
```

### Process file format
```markdown
# Process: Deploy to Production
## Trigger
When user says "deploy" or "release".
## Prerequisites
- Must be on `main` branch
- All tests pass
- No uncommitted changes
## Steps
### Step 1: Pre-flight
1. Run `git status` — must be clean.
2. Run `npm test` — must pass.
3. If any fail, STOP.
### Step 2: Build & Deploy
...
## Rollback
If anything fails after Step 1, run `git reset --hard HEAD~1`.
```

### Changes
- **Modify**: `src/skill_loader.js` — also scan `~/.nclaw/processes/*.md`
- **Modify**: `soul.md` — add: "When executing a process, follow steps EXACTLY in order. Check prerequisites first."
- **Create**: 2–3 example process files

---

## Phase 5: Enhanced macOS Tools ✅ TODO

| Tool | File | What it does |
|------|------|-------------|
| Clipboard | `src/tools/clipboard_skill.js` | `pbcopy`/`pbpaste` wrappers |
| Notifications | `src/tools/notify_skill.js` | `osascript` native notifications |
| Git | `src/tools/git_skill.js` | Structured git ops with parsed output |
| Project Scanner | `src/tools/project_skill.js` | Reads package.json, dir tree → project summary |
| Web Fetch | `src/tools/web_skill.js` | `open <url>` + axios GET with HTML stripping |

---

## Implementation Order

1. **Phase 1 + 2 together** — share `context_loader.js` and establish `~/.nclaw/` structure
2. **Phase 3** — builds on memory foundation
3. **Phase 4 + 5** — can be done in parallel

---

## Final File Structure

```
nclaw/
  PLAN.md                               ← this file
  soul.md                               ← enhanced with memory/skill/task instructions
  src/
    cli.js                              ← init ~/.nclaw/, session summary on exit
    agent.js                            ← use context_loader, register new tools
    config.js                           ← unchanged
    context_loader.js                   ← NEW: central context assembly
    skill_loader.js                     ← NEW: skill/process discovery
    tools/
      terminal_skill.js                 ← existing
      fs_skill.js                       ← existing
      multi_replace_file_content.js     ← existing
      memory_skill.js                   ← NEW
      task_skill.js                     ← NEW
      clipboard_skill.js                ← NEW
      notify_skill.js                   ← NEW
      git_skill.js                      ← NEW
      project_skill.js                  ← NEW

~/.nclaw/                               ← user data (not tracked in git)
  memory/
  skills/
  tasks/
  processes/
```

---

## 9B Model Guardrails

All design decisions keep things working with a local 9B model:

1. **System prompt < 3K tokens** — strict budgets on every injected section
2. **Lazy loading everywhere** — indexes in context, full files read on-demand
3. **Explicit tool names** — "use `manage_memory` with action `remember_fact`" not vague instructions
4. **Simple markdown formats** — headers, checklists, bullet points. No nested complexity.
5. **One action at a time** — ReAct loop handles sequencing; model picks next single action
6. **Small files** — all markdown files < 500 words. Hard line limits enforced.
