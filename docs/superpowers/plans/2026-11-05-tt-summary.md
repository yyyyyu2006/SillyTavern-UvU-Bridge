# TT and Scene Summary Implementation Plan

> Use executing-plans with TDD and one final fresh review. Plugin and UvU domains may proceed independently under dispatching-parallel-agents; no shared file ownership.

**Goal:** add TT/iOS transport, reviewed third-person scene memories, and saved character selection.
**Architecture:** additive platform/transport modules, existing v1 events, original prompt factory with detached external source input, guarded review draft commit.
**Tech Stack:** vanilla JS, Node standard HTTP/crypto, Node tests, Playwright.
**Spec:** docs/superpowers/specs/2026-11-05-tt-summary-design.md

## Global Constraints
Original prompt/reply files remain unchanged; existing Node Tavern transport and approved memories remain compatible. Credentials isolated by transport and never copied into public files. No automatic public service deployment. Preserve unchanged line endings.

## Review Focus
Switching channels/characters/archives while requests run cannot apply stale results. TT null history slots require pinned paging and validation. File imports cannot bypass target/review/checksum gates. Summaries remain drafts until confirmation; no duplicate raw+summary injection. Unknown dates remain unknown in source labels.

### Task 1: Saved character (UvU)
- [x] RED tests for pinned reentry, selected archive refresh and failed save rollback.
- [x] Add save control and selected-character persistence; rename misleading follow control; update tutorial and narrow UI.
- [x] Run targeted tests.

### Task 2: Reviewed summary memories (UvU)
- [x] RED selected floors, prompt reuse/no mutation, batching/merge, preview/confirm/cancel/failure/stale input/target tests.
- [x] Add isolated summary service and review UI; keep raw-save option and existing allowedMemory gate.
- [x] Verify API failure and persistence rollback; run UvU suite and browser review.

### Task 3: TT adapter and relay (plugin)
- [x] Research current official TT APIs/policy; record tested reference commit.
- [x] RED adapter capability/paging/state and real relay auth/persistence/replay/file tests.
- [x] Implement separate TT transport and deployable authenticated HTTPS-proxy relay with documented setup; preserve old Tavern routes.
- [x] Run plugin suite and browser test.

### Task 4: UvU TT channel and file exchange
- [x] RED isolated credentials/state, HTTPS validation, stale channel, file target/size/duplicate tests.
- [x] Implement channel switching and file handoff against the shared v1 contract; add app tutorial.
- [x] End-to-end both apps against actual relay and file fixtures.

### Task 5: Integration
- [x] Fresh read-only review and focused fixes, full suites and narrow browser checks; original prompt-file hashes and line-ending preservation.
- [x] Version update, explicit stage, commit/push both repos, remote SHA verification.

## Ledger
Pre-flight: Task 3 exports same v1 routes as existing transport; Task 4 only changes endpoint/channel state, not protocol/reply assembly. Task 2 consumes reviewed floor metadata and writes the same journal id, never local history range. Task 1 must be complete before channel/UI integration.

2026-11-05 verification: UvU 402/402 and plugin 100/100 Node tests passed. Browser checks passed for reviewed source floors, third-person summary draft/edit/confirm/quota rollback/stale role rejection, saved role reentry, original permanent pairing, original two-panel layout, TT native reload/pinned sparse history/file exchange and actual HTTP relay pairing/event receive. UvU-to-Tavern shared-store browser handoff excludes stale branch snapshots. Mobile widths 320/390 (plus handoff 375/412 and TT 1280) have no horizontal overflow or script errors.

Fresh read-only review found a producer-save/channel-switch race. Added publishingCount plus a deferred-save regression; channelSwitchBusy also blocks requests while switching configuration. Emoji source batching now bounds UTF-16 length without breaking pairs. Original reply/prompt/journal/auto-memory files have no diff. Final staging preserves unchanged line endings. Commits and remote SHA checks are completed after this ledger is staged.

Limits: no public server provisioned, no real public TLS or physical iOS validation. TT requires an extension-permitting ABI 2 build, actual device Origin configuration, and a private HTTPS relay for live mode; file mode has no remote mode control. Successful batch retry cache is in-memory for the current review, while completed summary drafts are persisted.
