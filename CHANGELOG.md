# Changelog

## [0.1.2] - 2026-03-09

- SECURITY: Migrated to `vscode.SecretStorage` for OS keychain-backed token isolation.
- SECURITY: Implemented a strict 10-second request rate-limit throttle to prevent server abuse flags.
- SECURITY: Added `User-Agent: antigravity-pulse-monitor/0.1.2` to all internal requests.
- SECURITY: Added automatic session expiry validation and global namespace purging on 401 exceptions.

## [0.1.1] - 2026-03-02

- FIXED: Resolved a glitch where completely exhausted/locked shared models (e.g. Claude Opus or GPT-OSS) would incorrectly display as having 100% quota remaining instead of 0%.

## [0.1.0] - 2026-03-01

- Initial release of Antigravity Pulse.
- Support for 6 major AI models (Gemini, Claude, GPT-OSS).
- 2-column hover tooltip and Quick Pick dashboard implementation.
- Real-time sync with local Antigravity Language Server API.
- Live refresh interval controls and notification toggles.
