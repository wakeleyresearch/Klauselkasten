# Klauselkasten

**Zettlr + Claude** — A fork of [Zettlr](https://github.com/Zettlr/Zettlr) with an integrated Claude AI chat sidebar.

## What is this?

Klauselkasten is [Zettlr](https://www.zettlr.com/) (the markdown editor for academic writing and Zettelkasten note-taking) with a simple Claude integration built into the sidebar. It spawns the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) as a subprocess — no API keys or custom backends needed, just your existing Claude subscription.

## Features

Everything Zettlr offers, plus:

- **Claude chat sidebar** — Chat with Claude directly in the editor
- **Active document context** — Claude automatically knows which file you're editing and can read its content
- **Document modification** — Claude can edit your open document directly; changes sync back to the editor
- **Insert responses** — One-click insert of Claude's responses into your document at the cursor
- **Undo writes** — Revert Claude's changes to your document with a single click
- **Per-document conversations** — Each document has its own conversation history that persists across sessions
- **Session continuity** — Multi-turn conversations with `--resume` support
- **Model selection** — Switch between Opus, Sonnet, and Haiku from the sidebar
- **Permission modes** — Configure Claude's permission level (plan, auto, acceptEdits)
- **Authentication** — Auto-detects your Claude auth status with a sign-in flow

## Requirements

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude auth login`)
- Node.js 22+ (managed via nvm)
- Yarn 4+

## Building

```bash
git clone https://github.com/wakeleyresearch/Klauselkasten.git
cd Klauselkasten
git checkout feat/claude-chat-v1
corepack enable && corepack yarn install
yarn start
```

## How it works

The integration lives in:
- `source/app/service-providers/claude/` — Main process service provider that spawns `claude -p` with streaming JSON output
- `source/pinia/claude-chat-store.ts` — Pinia store for chat state management
- `source/win-main/sidebar/ClaudeChatTab.vue` — Sidebar UI component

No new npm dependencies. The Claude Code CLI binary is spawned as a child process with `--output-format stream-json` for real-time streaming.

## Upstream

This is a fork of [Zettlr/Zettlr](https://github.com/Zettlr/Zettlr). All credit for Zettlr goes to [Hendrik Erz](https://github.com/nathanlesage) and the Zettlr contributors. The Claude integration is an independent addition.

## License

GNU GPL v3 (same as Zettlr)
