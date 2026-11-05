# Bridge reliability implementation

Approved scope: repair the audited bridge bugs; retain both apps original prompts and generation.

1. Atomic committed store reads, nested validation, persistent relay epoch, transition-only switch, per-user durable extension state.
2. Coalesce source revisions, isolate invalid legacy events, bounded reception, explicit scoped tombstone recovery and receipt diagnostics.
3. Phone turn bounds and revised messages, explicit gap/reset recovery, precise review rollback and drafts.
4. Stable scene boundaries, visible injection budget, service/local switch failures, initial version and tutorials.
5. Full regression and browser checks, fresh final review, commit and push both repositories.

Verification: targeted regression RED then GREEN; full suites; browser 320/390 widths; check base prompt files unchanged.

Progress ledger
- Baseline: UvU 376 and bridge 44 tests passed in preceding audit, clean main checkouts.
- Ruling: work in existing task-owned checkouts with persistent main push authorization; no additional worktree needed because these paths are already dedicated to this task.
- Ruling: retain bounded replay queue and explicit recovery; no automatic destructive queue cleanup in this release because deleted-copy replay recovery needs retained events.

- Batch 1 complete: private store drafts publish after atomic disk commit; nested records validated; relay epochs persist; unchanged switch no longer resets scenes; per-account UI state uses independent atomic storage and revision checks.
- Batch 2 complete: coalesced replay retains approved edits against the newest complete original; malformed legacy events are isolated; initial capacity overflow saves what fits; multipart continuation is retained; scoped recovery preserves other tombstones and ordinary incoming messages.
- Batch 3 complete: complete phone turns and revisions publish; UvU batches up to ten send acknowledgments per local save with rollback; explicit gap/reset recovery preserves complete other-archive scenes; handoff receipts distinguish queue acceptance from receiver retention/review; forced UvU review refresh preserves unsaved drafts by character/archive/journal.
- Batch 4 complete: verified scene anchors refuse unsafe export; failed final saves retain frozen export; remote-mode compensation and suspension protect failures; storage confirmation survives navigation; early chat-isolation listener and storage/service gating prevent cached startup injection; configuration changes cannot snapshot another uncommitted review; initial version and detailed update/recovery tutorials corrected.
- Tests were added RED then made GREEN for the repaired boundaries. The fresh final reviewer identified scoped restore, multipart capacity, final-export rollback, receipt completeness, other-archive pending scenes, navigation acknowledgments and startup isolation; each was addressed with focused regression coverage.
- Verification: UvU 382/382 (including eight available 1900 prompt/request parity cases with additions disabled); bridge 65/65; module/server syntax checks; diff whitespace check treating existing CRLF as line endings; real Chromium mobile-width flow checks at 320/375/390/412 px. Browser tests use the real relay store with simulated transport/Tavern host, not a physical Termux installation.
- Additional route/storage verification: authenticated account identity cannot be overridden by body fields; cross-origin/non-loopback UI storage denied; stale revisions rejected; account review state survives restart and failed writes do not publish a revision.
- A Windows temporary-directory cleanup returned ENOTEMPTY once in an existing restart test. Inspection found all operations awaited; focused rerun and subsequent full suite passed. No product workaround was added for test-directory cleanup.
- Compatibility boundary: base prompt files and custom CSS were not edited. chat_ai.js changes only freeze complete phone-mode handoff bounds; generated reply assembly is untouched. Opt-in approved continuity memory still changes context by design.
- Deliberate follow-up items: lazy review DOM/pagination for very large local diaries, server batch-append endpoint, and further large-library performance benchmarking. Retain the bounded replay queue; do not auto-delete recovery evidence. These are performance follow-ups, not promised as completed here.
- Device limit: Android/iOS background suspension and real phone networking still need user-device checks. Legacy scenes without a reliable boundary must be abandoned and restarted after retaining their original chat.
