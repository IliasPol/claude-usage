# Claude Usage Explorer

A local, read-only usage explorer for Claude Code. Browse projects, sessions, agents and models, inspect token usage and estimated API-equivalent costs, and optionally view cached Claude Desktop plan-limit percentages. No external npm dependencies or telemetry.

> **v1.0.0:** The standalone TUI is available via npm. Native sidebar integration requires a compatible Claude Code version; the external-terminal launcher may vary by environment.

## Requirements

- Node.js 20+ (Node 22 recommended)
- Claude Code with native Mods support for the sidebar
- Local Claude Code JSONL transcript history

## Install the standalone CLI (npm)

Install the published npm package globally with Node.js 20+:

```sh
npm install -g claude-usage-explorer
claude-usage tui
```

Or run it without a global installation:

```sh
npx --yes --package claude-usage-explorer claude-usage tui
```

**Note:** On Windows PowerShell, use `npm.cmd` and `claude-usage.cmd` if execution policy blocks the `.ps1` shims.

To run directly from a local checkout, use:

```sh
node ./bin/claude-usage.mjs tui
```

Run the TUI in an **interactive terminal**, not inside a noninteractive Claude tool shell. The optional macOS/Linux installer `./scripts/install-command.sh` is still available for source checkouts but is not needed for npm installations.

## Run the native Claude Code sidebar

Start Claude Code with the local plugin directory:

```sh
claude --plugin-dir /absolute/path/to/claude-usage-explorer
```

Then use `/usage-explorer`. In Claude Code CLI, `/tui fullscreen` may be required for the sidebar to appear. The native command is **`/usage-explorer`**, not `/claude-usage:open`.

The optional `/claude-usage:tui` skill attempts to open a **separate** terminal. This requires one model invocation and depends on your terminal environment. If no terminal appears, launch `node ./bin/claude-usage.mjs tui` directly in PowerShell or Terminal.

## Screenshots

### Native Claude Code sidebar

![Claude Usage Explorer inside the Claude Code sidebar](docs/screenshots/native-sidebar.png)

Run `/usage-explorer` in Claude Code to inspect local usage without leaving your session.

### Standalone terminal UI

![Claude Usage Explorer standalone terminal dashboard](docs/screenshots/standalone-tui.png)

Run `claude-usage tui` for a full-screen view of projects, token usage, model breakdowns, and estimated costs.

## Features

- Drill down into projects, sessions, agents and models
- Periods, sorting, filtering and auto-refresh
- Token totals and estimated API-equivalent cost by model
- Optional cached 5-hour and 7-day Claude Desktop plan-limit percentages (not live usage)
- Read-only, local processing; no uploads or external analytics

**Important:** Estimated API-equivalent cost is not what your Claude subscription was charged. Cached plan percentages can be stale. Claude Desktop Chat history is not included in Claude Code's local transcript analytics.

## Windows

In PowerShell, from the extracted project directory (or use the npm installation above):

```powershell
node .\bin\claude-usage.mjs tui
claude --plugin-dir "$PWD"
```

## Development

```sh
npm test
npm run check
```

The GitHub Actions workflow tests on Windows, macOS and Ubuntu.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Licensed under [MIT](LICENSE).

## Support

If this project is useful, you can [star the repository](https://github.com/IliasPol/claude-usage). Optional GitHub Sponsors support may be enabled later. No donation or payment is required to use the project.
