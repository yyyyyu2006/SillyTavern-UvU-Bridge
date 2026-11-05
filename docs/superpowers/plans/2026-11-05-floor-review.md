# Floor Review Implementation Plan

> Use executing-plans and test-driven-development task by task.

**Goal:** exact message boundaries and explicit body extraction before editable memory approval.
**Architecture:** additive floor metadata in existing checked scene parts; bounded reconstruction and existing journal persistence.
**Tech Stack:** vanilla JS, Node tests, Chromium Playwright.
**Spec:** docs/superpowers/specs/2026-11-05-floor-review-design.md

## Global Constraints
No original prompt or reply-flow changes. Preserve original chats and approved legacy memories. Keep existing scoped styling and mixed line endings. Work in existing clean task-owned checkouts under continuing main push authorization.

## Review Focus
Malformed wrappers never include trailing status; nested nonstory wrappers must not expose nested content; long floors split only for transport; mixed/conflicting metadata must fail without cursor advancement; archive switches/save failure retain review data and never enable unapproved text.

### Task 1: Extraction and export
Files: story-text.js, index.js, tests/story-text.test.cjs, tests/scene_isolation.test.cjs; UvU bridge_text.js mirrors extraction.
Interfaces: extractStory(value,{bodyTags,excludeTags}) -> {text,mode,tag}; sceneFloorParts(messages) -> [{text,floor,sceneFormat}].
- [x] Add RED extraction and real export tests: content, aliases/custom, nested exclusions, malformed wrapper, untagged prose, whole floors, long chunks and speaker/number.
- [x] Implement extraction independent of generic clean(), export floor metadata and hashes; preserve frozen legacy exports.
- [x] Run bridge suite.

### Task 2: Receive and review
Files: UvU story_bridge.js, bridge_text.js, css/settings.css, index.html; tests/story_bridge.test.cjs and browser_floor_review.cjs.
Interfaces: floorItems(parts,floorParts) -> whole-floor review items; legacyFloorItems(text) -> header-based or single legacy item.
- [x] RED tests for multi-part floor reconstruction, conflicts, old format, select-all/edit/save/reload, partial selection and rollback.
- [x] Implement checked reconstruction, compact editable floor UI, selection controls and legacy explicit regrouping. Preserve journal injection gate.
- [x] Run UvU full suite and real Chromium narrow review flow.

### Task 3: Docs, review, integrate
- [x] Version 0.4.2, teach body tags/fallback/full-floor review and memory gate in both apps.
- [x] Full suites, syntax, browser layout, final review and focused fixes; preserve unchanged line endings. Integrate both authorized main branches and verify remote SHAs after commit/push.

## Ledger
Pre-flight: exporter and receiver use the same optional floor metadata; old events have no metadata and remain readable. Never repurpose global part/partCount for floor-local part numbering.

Task 1: complete. RED missing extraction / paragraph export reproduced; extraction and actual endScene tests passed. Long floors retain one identity across transport chunks. Arbitrary preset tags use explicit configuration rather than an unsupported universal-recognition claim.
Task 2: complete. RED absent selection UI and missing floor metadata reproduced. UvU suite passed 389/389 before final boundary fixes; Chromium 320/390 passed selection, editing, draft refresh, partial save, legacy regroup and reload. Existing pairing browser regression and both-panel layout passed.
Ruling: continue authorized task-owned main checkouts and push both repos as previously requested; no new worktree or approval gate. Existing approved legacy memories remain unchanged.
Final review: fresh read-only reviewer found decoded literal tags parsed twice, JSON-escape payload overhead, and invalid Date range. One focused fix pass: failing regressions reproduced and passed after preserving extracted plain text, byte-budgeted chunks plus pre-freeze payload validation, and date-range checks. Original prompt and reply-flow files remain outside this change.
Final verification: UvU 390/390 and bridge 80/80 passed. Floor-review browser, pairing browser, narrow layout, and live-current-archive relay/store/review flow passed. Windows temporary-directory cleanup failed intermittently with ENOTEMPTY; test cleanup now uses three bounded retries, without changing runtime persistence. Extension syntax passed. Remote main SHAs still match both task baselines before integration.
