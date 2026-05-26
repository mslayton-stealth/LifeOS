# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is the **public source** for PAI (Personal AI Infrastructure) — a Life OS that runs on top of Claude Code. It is a sanitized, public mirror of a private development tree (`PAI_DIRECTORY`). Anything personal (API keys, identity, memory, business context) lives only in the private tree and must never enter this repo. `SECURITY.md` is the authoritative policy for that boundary; `.pai-protected.json` encodes it as regex patterns and file lists, and `Tools/validate-protected.ts` enforces it.

This repo is **not** a runnable application. It ships three kinds of artifacts:

- `Tools/` — Bun/TypeScript utilities for maintaining PAI installs (validate-protected, BackupRestore).
- `Packs/` — 45+ self-contained, AI-installable capability packs. Each pack is `README.md` + `INSTALL.md` + `VERIFY.md` + `src/`; an end-user points their DA at the directory and says "install this."
- `Releases/v{N}/.claude/` — complete `.claude/` directories that a user drops into `~/`. `Releases/v5.0.0/` is current. Each release is a full system (hooks/, skills/, settings.json, PAI/, install.sh, its own CLAUDE.md). When you edit a release, you are editing the artifact users install — not the dev environment.

## Commands

```bash
# Validate that no sensitive data is about to be committed (pre-commit gate).
bun Tools/validate-protected.ts            # full scan
bun Tools/validate-protected.ts --staged   # staged files only — use this in pre-commit

# Backup and restore an end-user PAI install (~/.claude).
bun Tools/BackupRestore.ts backup [--name <label>]
bun Tools/BackupRestore.ts list
bun Tools/BackupRestore.ts restore <backup-name>

# Install a release locally for testing (overwrites ~/.claude — back up first).
cd Releases/v5.0.0 && cp -R .claude ~/ && cd ~/.claude && ./install.sh
```

There is no top-level `package.json`, no test runner at the repo root, and no build step. Scripts run directly via `bun <file.ts>`. The Bun runtime is required.

## Runtime conventions (enforced across the project)

- **Bun, not npm.** Use `bun`/`bunx` for every script and dependency. Never invoke `npm`, `npx`, `pnpm`, or `yarn`.
- **TypeScript, not Python.** New tooling is TypeScript. Python only with explicit owner approval.
- **No hardcoded paths.** Use `${PAI_DIR}`, `${HOME}`, or relative paths — never `/Users/...` or a literal home dir. PAI installs to `~/.claude/`; `PAI_DIR` is how installed code refers to its own root.
- **Cross-platform code.** macOS and Linux are both first-class; Windows is not yet supported (`PLATFORM.md` tracks status). For platform branches use `uname -s` in shell or `process.platform` in TypeScript. Never assume Homebrew paths, GNU vs BSD `sed`, or `~/Library/...`.

## Security — non-negotiable for this repo

This is a **public** repository. Every commit is world-readable. Before pushing anything:

1. `bun Tools/validate-protected.ts --staged` must pass. It scans staged files against the regex catalog in `.pai-protected.json` (API keys for Anthropic/OpenAI/AWS/Google/Stripe/Twilio/etc., JWTs, private keys, personal email patterns) and against the `forbidden_directories` list.
2. **Forbidden at the repo root** (per `.pai-protected.json`): `skills/`, `MEMORY/`, `History/`, `context/`, `progress/`, `Deprecated/`, `.deprecated/`. These names belong to the private tree only. Skills in this repo live under `Packs/<Name>/src/` and `Releases/<ver>/.claude/skills/`, never at the root.
3. Examples and docs use `${PAI_DIR}` placeholders, never real paths. `.env.example` is the only env file allowed; real `.env` files are gitignored.
4. `SECURITY.md` has the full transfer checklist when moving capability from the private tree into this public mirror.

If a secret does land in a commit, the recovery procedure is in `SECURITY.md` — rotate the key first, then rewrite history.

## Repo layout — what each directory means

- **`Tools/`** — repo-maintenance utilities. Flat directory of `.ts` files run via `bun`. README in `Tools/README.md`. Add new tooling here only if it operates on the repo or on an end-user install; capability code belongs in a Pack.
- **`Packs/<PackName>/`** — one directory per capability. Mandatory layout: `README.md` (what it does), `INSTALL.md` (the 5-phase install wizard the DA executes), `VERIFY.md` (post-install checks), `src/` (source the installer copies). When adding a pack, follow the existing structure exactly — `Packs/README.md` lists every current pack and the curated bundles.
- **`Releases/v{N}/.claude/`** — the actual installable system. Inside each release: `hooks/` (lifecycle hooks, `.hook.ts`), `skills/` (the skill library, `<Name>/SKILL.md` plus `Workflows/`, `Tools/`, `References/`), `commands/` (slash commands), `agents/` (custom agents), `PAI/` (algorithm, memory templates, documentation, system prompt), `settings.json`, `install.sh`. Each release ships its **own** `CLAUDE.md` and `settings.json` aimed at the end-user runtime — that is a different file from this one. Don't conflate them: this CLAUDE.md is for working **on** the repo; `Releases/v5.0.0/.claude/CLAUDE.md` is what gets installed at `~/.claude/CLAUDE.md` for end users.
- **`.github/workflows/`** — `claude.yml` runs `anthropics/claude-code-action@v1` when an issue/PR comment contains `@claude`. `claude-code-review.yml` runs `/code-review:code-review` on every PR via the `code-review@claude-code-plugins` plugin.
- **`images/`**, **`LICENSE`**, **`README.md`**, **`PLATFORM.md`**, **`SECURITY.md`** — root docs and assets.

## Architecture pointers (for context only — these files are in releases, not the repo root)

A release's `.claude/PAI/` tree is the actual running system. Two pointers are useful when you have to reason about end-user behavior while editing a release:

- `Releases/v5.0.0/.claude/PAI/DOCUMENTATION/PAISystemArchitecture.md` — master architecture doc.
- `Releases/v5.0.0/.claude/PAI/DOCUMENTATION/ARCHITECTURE_SUMMARY.md` — generated summary with the pipeline-by-pipeline file inventory (Security, Algorithm, Memory, Hooks, Observability, Pulse, Skills, Config, Notifications, Doc Integrity). When you edit a file inside a release, that table is how you trace downstream impact.

The Algorithm version (`PAI/ALGORITHM/LATEST` pointing at `v{N}.md`), Memory version, and Pulse port (31337) are all release-internal and change between releases — don't hardcode any of them.

## Working across releases

Older releases under `Releases/v2.x` → `v4.x` are preserved for users on older installs and **should not be retroactively rewritten** except for security fixes. New work goes into the current release (v5.0.0). Cross-release refactors are a different kind of change — confirm scope before touching multiple release directories.
