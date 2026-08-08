---
name: sync-up
description: >
  Sync a local git repository with its GitHub or GitLab remote and rebuild current knowledge before doing any work on it: remote detection via git remote -v, git fetch, repo governance docs (AGENTS.md, CLAUDE.md, CONTRIBUTING.md, README), open and closed issues/PRs via gh or glab with full comment threads, and narrowing to an assignee. Trigger on "sync up", "catch me up", "what changed since last time", "pull the latest issues", "check my assigned issues". Also trigger proactively on a new session in a git repo, an unsynced repo, a question assuming current project state ("what should I work on", "is this fixed"), or a working tree/remote that differs from one already synced this session. Do not wait to be asked in these cases.
---

# Sync Up

Rebuild accurate, current knowledge of a git repository: code state, issues, and PRs/MRs, before answering questions about it or working in it.

## When to run this without being asked

Run this before answering, not just when the user says "sync up," when any of these hold:

- This is the first message of a new conversation and the working directory is a git repository.
- The conversation has synced other repos already but not this specific one (compare `git remote -v` / repo root against what was already synced this session).
- The user asks something that assumes current knowledge of issues, PRs, or project state ("what should I work on," "is this already fixed," "what's the status of X") before that knowledge has been established this session.
- The working tree or remote differs from one already synced: different repo root, different `git remote -v` output, or current branch pointing at a different upstream.

Run it silently as a precursor step and fold the result into the actual answer, do not narrate "running sync-up first" as a separate turn.

## Reliability note: description matching is not guaranteed

Claude decides to consult a skill by matching the description above against the current message. This is a judgment call, not a hard rule, and Claude sometimes under-triggers skills on implicit conditions (new session, unfamiliar working tree) even with the wording above. Description matching alone cannot be made 100% reliable.

If reliable auto-run at the start of every session matters more than avoiding an extra tool call, do not rely on the skill description alone. Add a line directly to this repo's `CLAUDE.md` or `AGENTS.md`, for example:

```
Run the sync-up skill before starting any work in this session.
```

`CLAUDE.md`/`AGENTS.md` are loaded as standing project context at the start of a session independent of skill matching, so an instruction placed there does not depend on Claude first guessing that a sync is needed. This is a one-line addition to a file that already exists in most repos, not a new mechanism.

## Step 1: Identify the remote provider

Run:

```bash
git remote -v
```

Parse the output for `github.com` or `gitlab.com` (or a self-hosted GitLab host if the URL pattern matches `/api/v4` conventions elsewhere in the repo config). Pick the CLI accordingly:

- GitHub -> `gh`
- GitLab -> `glab`

If no remote is configured, stop and report that. Do not guess a provider.

If both a `github.com` and a `gitlab.com` remote exist (mirrored repo), ask the user which one is the source of truth for issues/PRs, since the two trackers can diverge.

Confirm the CLI is installed and authenticated before proceeding:

```bash
gh auth status   # or: glab auth status
```

If missing or unauthenticated, report that and stop. Do not attempt to scrape issue data via web_fetch as a substitute; it produces incomplete, unreliable results.

## Step 2: Read repo governance docs first

Before pulling anything else, check for and read, in this order, whichever exist:

- `AGENTS.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`
- `README.md` (project overview section only, not the full file if long)

These define how this specific repo expects contributions, branching, commit conventions, and review process to work. Treat their contents as binding for any subsequent work in this repo. Do not summarize them away or silently override a convention they define (branch naming, commit message format, required checks, code owners) just because it differs from a general default. If a doc's instruction conflicts with something the user asks for later in the session, surface the conflict rather than picking silently.

## Step 3: Fetch the latest state

```bash
git fetch --all --prune
git status -sb
git log --oneline HEAD..@{u} 2>/dev/null   # commits on remote not yet local
git log --oneline @{u}..HEAD 2>/dev/null   # local commits not yet pushed
```

Report, briefly: current branch, how far behind/ahead of upstream, and whether the working tree is clean. This is context, not the main deliverable, keep it to a few lines.

## Step 4: Pull issues and PRs/MRs, both open and closed

GitHub:

```bash
gh issue list --state all --limit 100
gh pr list --state all --limit 100
```

GitLab:

```bash
glab issue list --all
glab mr list --all
```

Closed items matter here because they establish what was already decided or already fixed, which prevents re-litigating settled questions or re-fixing something already merged. Pull both states in the same pass rather than defaulting to open-only.

If the repo is large and the limit truncates results, prefer narrowing by recency (`--search "sort:updated-desc"` on GitHub, equivalent on GitLab) over silently dropping older items without saying so.

## Step 5: Narrow by assignee

Determine the local git identity:

```bash
git config user.email
gh api user --jq .login   # or: glab api user --jq .username
```

Then ask the user directly which scope they want, do not assume:

- Issues/PRs assigned to them
- Issues/PRs assigned to a specific other engineer (ask for the username/handle)
- Everything, unfiltered

Use `ask_user_input_v0` for this if available as a tool in the session; otherwise ask as a plain question. Filter the Step 4 results accordingly:

```bash
gh issue list --state all --assignee <login>
gh pr list --state all --search "assignee:<login>"
```

(GitLab: `glab issue list --assignee=<username>`, `glab mr list --assignee=<username>`.)

## Step 5b: Pull the body and full comment thread on every item

A title and a state are not enough to work from. For every issue/PR in the narrowed scope from Step 5, pull the body and the entire comment thread, not just the summary line:

```bash
gh issue view <number> --comments
gh pr view <number> --comments
```

(GitLab: `glab issue view <id> --comments`, `glab mr view <id> --comments`.)

Comments are not optional context, they are often where the actual state of the work lives: a reviewer requesting changes, someone flagging the issue as stale or a duplicate, a decision reversing the original description, a blocker someone else hit. Read the full thread, not just the first comment. Note explicitly:

- Who commented and roughly when (relative to now, e.g. "3 days ago")
- Any decision, blocker, or requested change that changes what the item is actually asking for versus its original description
- Whether the discussion suggests the item is actually done/stale/superseded despite its open state, or still active

For open PRs/MRs in scope, also pull the diff so the actual code change is known, not just its description:

```bash
gh pr diff <number>
```

(GitLab: `glab mr diff <id>`.)

Cap this at a reasonable number of items (the ones in scope after Step 5 narrowing should already be small; if it is still large, prioritize by most recently updated and say so rather than silently pulling everything). This step is what turns a list of tickets into working knowledge of what each one actually says, what's been argued about it, and where the related code stands.

## Step 6: Report the sync

Give a short, structured summary, not a dump of raw JSON:

- Branch/commit position relative to upstream
- Any governance doc constraints worth flagging for this session (from Step 2)
- For each open issue/PR in scope: number, title, age, a substantive summary of its body, and a separate line for comment-thread status: last commenter, when, and the key point raised (decision made, blocker, "still waiting on X", requested change, or "no discussion yet")
- For PRs, also state what the diff actually changes, in addition to the comment status
- Count only (not full list) of closed items, unless the user asked to see them or a closed item's comments are directly relevant to an open item

This summary is what lets both the assistant and the person resume work with current knowledge instead of stale assumptions. Skip the step if the user only asked for one specific piece of this (e.g. "just fetch", "just show my issues"), do the steps needed for that and stop there rather than always running the full six-step sequence.
