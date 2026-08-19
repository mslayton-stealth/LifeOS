# Skill: PAI Agentic Core Loop (Bash-Optimized)

## Context

Standardize on Homebrew Bash (`/opt/homebrew/bin/bash`) for all generated scripts. Zsh has escaping problems with other languages and shell tools, so it is excluded. Brew-installed bash is a prerequisite for every system we install.

## Protocol

### Environment
All deployment scripts use `#!/opt/homebrew/bin/bash` as the shebang.

### Shar-Hex Pipeline
- Content is hex-encoded to bypass terminal character interpretation.
- Each share file is a self-extracting bash script that decodes its payload and writes files into the project hierarchy.
- Embedded comments at the top of each share file declare which files it creates and where.

### Automated Feedback
- Pipe stdout+stderr to `pbcopy` so output is on the clipboard for paste-back review:
  - Bash 4+: `|& pbcopy`
  - Portable: `2>&1 | pbcopy`
- After running an install, paste back to Claude/Gemini for inspection.

## installer.sh

A single bash entry point with subcommands, each triggered by a separate argument.

### Subcommands

#### `new [name]`
Creates a standard GitHub repository topology. Takes a name (`-n <name>`) or generates one by default. Steps:
1. Make project root and load standard template.
2. Create default directories: `conf/`, `bin/`, `scripts/`, `docs/`, `submissions/`, `logs/`.
3. Emit `shar_0000` (the bootstrap share file) into `submissions/`. This share file:
   - Embeds the GitHub template.
   - Embeds `install.sh` itself (auto-creates it at the project top level).
   - Adds itself to `submissions/` as submission #1.
4. Exit.

After `new` completes, the project is ready for the first `apply`.

#### `apply`
Decodes and applies the next hex-encoded submission. Each submission lives in a shell variable named `hex_<serial>`, where the serial is a 4-digit sequence starting at `0000` (created by `new`) and incrementing per apply.

Per-apply behavior:
- Read the share file's top comments to determine target files and locations.
- Decode from hex.
- Write files into the appropriate locations under the project root.
- Pipe all output through `pbcopy` for paste-back review.

If multiple `hex_<serial>` instances are queued, apply them in serial order.

#### `rebuild`
Recursive apply. Reads every share file in `submissions/` in serial order and applies each one, starting from the project's top-level directory. Used to rebuild a project from scratch.

### Submission lifecycle
1. AI generates code.
2. Code is hex-encoded into `hex_<serial>` (auto-incremented from prior apply).
3. User copies the variable assignment to clipboard.
4. User runs `installer.sh apply`.
5. Apply decodes, writes files, captures stdout/stderr to clipboard.
6. User pastes the captured output back to the AI for inspection.

### Post-reboot work
When a step requires a reboot (or otherwise can't be completed in the current shell), write the follow-up instructions into the project's `bin/` directory and run them after the reboot.

## Open items

- Cryptographic signing of share files (planned, not yet specified).
- Standard `README.md` template content.
- Other components of the GitHub repository scaffold.
