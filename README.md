# Codex Usage by Edd

See remaining Codex quota in two VS Code status bar items:

```text
Codex 5h █████████░ 90%    Week ██████████ 98%
```

Each item shows a ten-character progress bar and opens **Codex Usage: Show Details** when clicked. Hover for remaining and used percentages, reset time, time until reset, and the last update time.

This is an independent community extension, not an official OpenAI product.

## Screenshots

A screenshot will be added after the public release is verified. The text preview above illustrates the status bar. No screenshot containing account information is included.

## Requirements

- VS Code 1.85 or newer, using a desktop extension host.
- Codex CLI installed, available on PATH, and authenticated through its normal sign-in flow (`codex login`).
- An account for which Codex exposes 5-hour and weekly quota. API-key-only accounts may not provide these plan limits.
- The Codex executable must support `codex app-server --listen stdio://` and the account rate-limit methods.

The protocol was inspected with Codex CLI 0.160.1. Other versions may work, but are not guaranteed. On Windows, the native executable in a standard npm Codex installation is discovered automatically. Other installation layouts can use the executable-path setting.

## Installation

### VS Code Marketplace

Install [Codex Usage by Edd](https://marketplace.visualstudio.com/items?itemName=Edd.edd-codex-usage) from the VS Code Marketplace, or search for **Codex Usage by Edd** in VS Code's Extensions view and verify publisher **Edd**. The extension identifier is `Edd.edd-codex-usage`. Version 0.1.0 is published.

### From a VSIX

Download the VSIX from [GitHub Releases](https://github.com/EdwardMovsesyan91/codex-usage/releases) once a release is available. In VS Code, run **Extensions: Install from VSIX...** and select the downloaded file. Reload the window if prompted.

### Local development

```sh
npm install
npm test
```

Open the project in VS Code and press F5, selecting **Run Codex Usage**. On Windows PowerShell, use `npm.cmd` if the npm PowerShell shim is blocked by execution policy. Node.js 20 or newer is required for the development checks.

## Understanding the percentages

The extension displays **remaining** quota: `100 - usedPercent`, clamped to 0–100. For example, 10% used becomes 90% remaining. Status bar percentages round to whole numbers; hover tooltips show the unrounded value.

Primary is the 5-hour window (300 minutes); secondary is the weekly window (10080 minutes). Only the overall Codex bucket is displayed. Unavailable or incompatible windows show `—`, rather than substituting another model's limits.

Severity follows the exact remaining percentage:

| Remaining | Appearance |
| --- | --- |
| 60% or more | Normal theme styling |
| 30–59% | Warning foreground |
| 10–29% | Warning background |
| Below 10% | Error background |

Reset times use your local timezone. Countdown text updates locally. Reaching a reset timestamp does not assume quota has recovered; the extension waits for service data.

## Commands

- **Codex Usage: Refresh** — request the latest quota, reconnecting if necessary. Failures show an explicit message with a Show Output action.
- **Codex Usage: Show Details** — show both quota windows and reset times, with a Refresh action.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `codexUsage.refreshInterval` | `60` | Fallback refresh/reconnect interval in seconds. Positive values below 60 use 60 seconds. Set 0 for notifications and manual refresh only. |
| `codexUsage.executablePath` | Empty | Optional absolute path to the native Codex executable. Shell wrappers such as `.cmd`, `.bat`, or `.ps1` are not accepted. |

Recent complete Codex notifications suppress fallback reads. Unrelated or incomplete updates do not. Setting changes reconnect the owned app-server process.

## Troubleshooting

Open **View → Output** and select **Codex Usage** for diagnostics. The channel reports process lifecycle, handshake/read steps, privacy-filtered stderr, response shapes, parsing failures, and timeouts.

- **Executable not found:** install Codex, restart VS Code to refresh PATH, or set `codexUsage.executablePath` to its native executable.
- **Authentication error:** sign in through Codex's normal login flow, then run Refresh. The extension has no embedded login UI.
- **Home directory error:** make sure VS Code's process environment gives Codex access to its normal home directory. If you use CODEX_HOME, launch VS Code with the same environment as your working Codex terminal.
- **Initialize timeout or process exit:** confirm `codex app-server --listen stdio://` works in your normal terminal and inspect the output channel. The extension uses direct stdio rather than the daemon proxy.
- **Quota unavailable:** your account or CLI version may not expose the expected quota windows. A successful sign-in alone does not guarantee these fields.

Do not paste raw terminal logs, authentication responses, or account data into public issues. Diagnostics are filtered, but review any information before sharing it.

## Protocol and compatibility

The extension starts its own `codex app-server --listen stdio://` process. It exchanges newline-delimited JSON, awaits the `initialize` response, sends `initialized`, and reads `account/rateLimits/read`. It consumes `account/rateLimits/updated` notifications and clears cached values on `account/updated`.

The app-server interface is experimental and may change between Codex versions. Unknown responses fail gracefully. The extension does not scrape terminal output, simulate `/status`, read session files, or start inference turns. Disposing the extension terminates its owned app-server process without managing the shared daemon.

Protocol reference: [Codex app-server documentation](https://learn.chatgpt.com/docs/app-server).

## Privacy

The extension does not read or store authentication credentials, access tokens, or API keys. Authentication stays inside the Codex CLI. Quota values are held in memory for display; no account IDs are retained for the UI.

The extension adds no telemetry, makes no direct service requests, and logs no raw authentication responses or request parameters. Diagnostic response shapes withhold arbitrary values. Paths, credential patterns, account identifiers, and email addresses are filtered from diagnostics. Codex itself uses its own configuration and makes the service requests needed to obtain account limits.

## License

Extension code is MIT licensed. Generated protocol reference files retain their upstream Apache-2.0 licensing and are excluded from the VSIX; see [THIRD_PARTY_NOTICES.md](https://github.com/EdwardMovsesyan91/codex-usage/blob/main/THIRD_PARTY_NOTICES.md).
