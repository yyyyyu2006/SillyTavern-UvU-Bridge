# Permanent Pairing Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task by task.

**Goal:** reusable permanent pairing codes, independent devices and honest automatic reconnect.
**Architecture:** extend the existing atomic store and both HTTP transports; keep legacy credentials; add scoped Tavern controls and UvU session/backoff state.
**Tech Stack:** Node crypto/fs, vanilla browser JavaScript, Node test and Chromium Playwright.
**Spec:** docs/superpowers/specs/2026-11-05-permanent-pairing-design.md

## Global Constraints
No prompt/reply/context changes. No unrelated CSS. Preserve original unchanged LF/CRLF. Existing checkout and main push authorization continue. No additional worktree.

## Review Focus
- Concurrent/repeated pairing, failed disk writes and one-time single-use behavior.
- Existing legacy tokens survive new pairings and server restarts.
- Revoke-one versus revoke-all versus code reset are independent.
- Client credentials never follow a changed service address; background polling must back off.
- Asynchronous pairing/disconnect/navigation cannot publish stale session state.

### Task 1: store and transport
Files: server/store.js, server/index.js, server/client-http.js; tests/store.test.cjs, tests/client-http.test.cjs, tests/ui-state.test.cjs.
Interfaces: getPairing(), setPairingMode(mode), createPermanentPairCode(), claimPair(code,device), listDevices(), revokeDevice(id), revokeToken(token), revokeAllDevices(), getSession(token).
- [x] Write behavioral tests and observe RED.
- [x] Implement hashed permanent code and independent tokens, legacy support, bounded device list and validation, atomic writes.
- [x] Expose authenticated same-origin management and client session/revoke on both transports.
- [x] Run targeted and full bridge tests.

### Task 2: panels and reconnect
Files: plugin index.js/style.css/client/uvu-bridge-client.js; UvU js/modules/story_bridge.js/index.html. Tests: bridge client/scene tests, UvU story_bridge tests and browser layout.
- [x] Add RED tests for independent client metadata, reconnect, 401/backoff and address isolation.
- [x] Add compact permanent-code/device management UI with scoped confirmations.
- [x] Add UvU device name, long-code input, honest session state, bounded retry and foreground resume; preserve old local token records.
- [x] Update version and in-app tutorials; test narrow mobile layout.

### Task 3: final verification and integration
- [x] Full test suites, syntax checks, 1900 parity, browser flow, final independent review and focused fixes.
Integration: preserve unchanged line endings and inspect staged diff, then commit/push to the already authorized main branches; final response records verified remote SHAs.

## Ledger
Ruling: user approval of the preceding optimization list is the accepted design; execute without another approval gate. Existing task-owned checkouts and direct-push authorization remain in force.
Pre-flight: transport pair returns token string for old callers; optional device metadata must not change that API. Both listener implementations must support the same session/revoke semantics.

Verification ledger (2026-11-05):
- Store/transport and reconnect tests were observed failing before implementation, then passing. Final review regressions reproduced invalid 401 on storage failure, stale disconnect state and inactive pairing-mode acceptance before their focused fixes.
- Full suites: UvU 385/385, bridge 73/73. Permanent pairing Chromium flow passed: two isolated contexts, reload, offline retention, rotation and revoke-one. Existing layout 320/390 and current-archive handoff 320/375/412 passed without page errors.
- Independent read-only review completed; session storage failures now return 503 on both transports, only authentication failures count toward pairing rate limits, and stale automatic jobs check generation/token/address.
- Multi-device bindings share relay/directory; merging distinct browser databases is outside this scope. Repeated pairing creates another binding entry, bounded at 50; device list supports removal. Physical Android/iOS background suspension and Termux process behavior remain device-validation items.
- If server saves a new code but the following list refresh fails, the action reports failure; refreshing settings and resetting again recovers. This does not revoke existing device tokens.

Final verification after byte-preserving newline restoration: UvU 385/385. Bridge 73/73 with --test-concurrency=1. Parallel bridge runs intermittently failed only in pre-existing temporary-directory teardown (Windows ENOTEMPTY); serial full execution passed. Production code and existing unrelated tests were not changed for that environment issue.
