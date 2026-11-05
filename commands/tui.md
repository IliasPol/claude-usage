---
description: Launch the interactive Claude Usage Explorer in a separate terminal window, without model calls for navigation
allowed-tools: Bash
---

Launch the local TUI sidecar once, without asking the user any questions. Use the following command via Bash, passing the current project directory as CLAUDE_PROJECT_DIR when available:

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/claude-usage.mjs" open
```

Do not run the `tui` command directly in the Bash tool (it needs an interactive terminal). The `open` command starts a separate terminal process and exits immediately. Report only whether the launch succeeded. This slash command requires one Claude invocation; subsequent navigation and refreshes use zero model calls. Do not pretend it embeds inside the Claude Code conversation. If a terminal emulator is unsupported, advise running `node "${CLAUDE_PLUGIN_ROOT}/bin/claude-usage.mjs" tui` in a separate terminal.
