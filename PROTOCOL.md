# Protocol reference

Generated bindings were inspected using Codex CLI 0.160.1:

```sh
codex app-server --help
codex app-server daemon --help
codex app-server proxy --help
codex app-server generate-ts --out protocol
```

The extension uses direct stdio: `codex app-server --listen stdio://`. The existing daemon proxy did not complete initialize in the original development environment, while direct stdio did. No alternate transports or session-file fallback are implemented.

Relevant generated files:

- `InitializeParams.ts`: clientInfo and nullable capabilities.
- `ClientInfo.ts`: name, nullable title, and version.
- `ClientRequest.ts`: initialize and account/rateLimits/read request envelopes.
- `ClientNotification.ts`: initialized notification envelope.
- `v2/GetAccountRateLimitsResponse.ts`: legacy rateLimits plus optional rateLimitsByLimitId and account metadata.
- `v2/RateLimitSnapshot.ts`: bucket ID and nullable primary/secondary windows, plus ignored metadata.
- `v2/RateLimitWindow.ts`: usedPercent, nullable windowDurationMins, and nullable Unix-seconds resetsAt.
- `v2/AccountRateLimitsUpdatedNotification.ts`: a sparse rolling rateLimits update; unavailable nullable values do not clear cached metadata.

The runtime validates consumed fields and tolerates additional fields. Full reads replace buckets; notifications merge available values. The overall Codex bucket uses primary for the 5-hour window and secondary for weekly. Conflicting non-null durations are unavailable. The UI subtracts usedPercent from 100 and clamps the display to 0–100. Reset timestamps are preserved.

Transport is newline-delimited JSON, with no Content-Length headers. Lifecycle: initialize request, wait for its response, initialized notification, account/rateLimits/read. The extension consumes account/rateLimits/updated and account/updated notifications. It creates no threads or inference turns and does not request credentials.

Generated references are not compiled or packaged. Licensing is recorded in THIRD_PARTY_NOTICES.md.

Reference: https://learn.chatgpt.com/docs/app-server
