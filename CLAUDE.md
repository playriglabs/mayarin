# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

The agent guidance itself is tool-agnostic and lives in **AGENT.md**. This file
imports it and adds only the Claude-Code-specific layer.

@AGENT.md

## Claude Code specifics

- **Repo skills** live in `.agent/skills/` (source of truth) and are symlinked
  into `.claude/skills/` so Claude Code auto-loads them:
  - `functional-programming` — the full TypeScript style guide (pure domain
    packages, immutable aggregates, injected effects, exhaustiveness, and the
    throw-over-`Result` rationale). Read it before writing or refactoring any TS.
  - Other skills (e.g. `graphify`) are user-global (`~/.claude/skills/`), not
    repo-local — do not assume they ship with this repo.
- **Slash commands** in `.claude/` are user-invocable skills; do not guess names
  not listed in the available-skills reminder.
- **Memory** persists across sessions under the Claude Code project memory dir;
  it is auto-managed, no need to reference a path in code.
- **Commits** carry no Claude/Anthropic attribution trailer (see AGENT.md →
  Conventions). Pre-commit runs Biome + Prettier; pre-push runs `typecheck` +
  `bun test`.
