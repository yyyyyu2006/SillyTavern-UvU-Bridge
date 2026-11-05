# Bridge protocol

The SillyTavern panel routes are mounted below `/api/plugins/uvu-story-bridge` and use SillyTavern's same-origin CSRF token. UvU client routes are served by a separate loopback-only listener on `127.0.0.1:<clientPort>` (default `8765`) so they do not bypass or disable SillyTavern's global CSRF protection. The browser client must send requests only after an explicit user gesture. Do not put bearer tokens in URLs.

## Event envelope

```json
{
  "eventId": "stable-source-id",
  "source": "uvu",
  "kind": "memory_packet",
  "characterKey": "stable-uvu-character-id",
  "sceneId": "optional-scene-id",
  "createdAt": 0,
  "payload": {
    "title": "Continuity handoff",
    "text": "A concise, source-grounded memory."
  }
}
```

`source` is `uvu` or `sillytavern`. `kind` is one of `memory_packet`, `phone_exchange`, `scene_transcript`, or `scene_summary`. Records are append-only and idempotent by `(source, eventId)`. Long scene transcripts are sent as ordered parts with the same `sceneId` and `part`/`partCount` fields. Acknowledgement is by monotonic sequence number, so clients can resume after a background suspension without duplicating imported records. If the bounded queue has dropped older records, the response sets `gapDetected`; the client must request a fresh handoff instead of claiming a complete sync.

## Route contract

- `GET /ui/pair-code`: loopback-only, for the SillyTavern extension panel.
- `POST /client/pair`: exchange a short-lived code for a bearer token on the loopback client listener.
- `GET /ui/events?after=<seq>`: loopback-only events from UvU waiting for SillyTavern.
- `GET /client/events?after=<seq>`: authenticated events from SillyTavern waiting for UvU.
- `POST /ui/events` and `POST /client/events`: append source-tagged events.
- `POST /ui/ack` and `POST /client/ack`: acknowledge imported sequence numbers.
- `GET /ui/state` and `PUT /ui/state`: read or update the linked character and scene mode.
- `POST /client/revoke`: revoke the paired token.

The client listener accepts only loopback connections and exact origins listed in `server/config.json`. Configure its port with `clientPort`; update UvU's bridge address to match.

The server plugin never calls an LLM. UvU keeps using its existing API and prompt logic. SillyTavern memory is provided to its normal generation as a separate extension prompt only when the user has enabled that integration.

## Mode and memory lifecycle

- `online`: UvU replies normally. Only an explicit range handoff relays `memory_packet`; ordinary unrelated turns are not automatically copied.
- `offline`: UvU checks this state before a private-chat generation and does not request a reply.
- `phone`: UvU may reply; its completed turn is tagged `phone_exchange`.
- Ending a SillyTavern scene exports ordered `scene_transcript` parts. UvU stores a complete scene as a draft journal after all parts arrive and are saved. It is not favorited by default.
- UvU stores incoming scenes as unapproved drafts. The user must review, select and save the text; only approved, favorited entries passing the per-character injection switch are usable. The switch alone never approves a scene. No base prompt text is replaced.

Version 0.3.0 adds `scene_cancelled`: discard incomplete parts and retract unapproved drafts for that scene, retaining source chats and already-approved journals. The idempotent cancellation event ID is `<sceneId>:cancel`. Existing event envelopes and protocol version 1 remain compatible; old clients should update to understand this event.

`GET /ui/service`, `PUT /ui/service {enabled:boolean}` and authenticated `GET /client/service` expose the persistent master switch, server version and protocol version. Updating the switch resets effective modes to online; a retained scene requires explicit resume. Authenticated `GET /client/inbox` returns per-character latest sequence numbers without transcript content, allowing delivery independent of the currently open UvU chat. Both the main Tavern routes and separate loopback listener expose client service/inbox endpoints.

State includes `archiveId`; nonmatching UvU archives ignore scene modes. Tavern injection also requires the exact stored scene ID, card key, chat ID and source archive, enabled service and reviewed selection. A chat change invalidates pending work and clears only this extension's continuity prompt.

The sequence queue is a local relay, not a shared live transcript. Each side retains its own original conversation. A scene transcript is imported only after all declared parts are present; if the queue reports a gap, the client must not claim a complete import.

## 0.4.0 additive fields and persistence

Service, inbox and event-list responses include a persistent `relayId`. A changed relay ID or cursor beyond latest sequence requires explicit recovery/review, never silent diary deletion. Event lists expose `gapSeq`. Repeating an unchanged service switch does not reset active scenes.

`handoff_receipt` is a SillyTavern-to-UvU event containing `handoffId`, `archiveId`, expected, seen, retained, reviewed, deleted, pendingParts, incomplete and at. It acknowledges receiver state after a confirmed save, and does not enter chat or memory context.

`GET /ui/extension-state` and `PUT /ui/extension-state {revision,settings}` are same-origin Tavern routes using its CSRF/authenticated account. They are not exposed on the client listener. PUT rejects stale revisions with 409. Extension state is atomically stored separately from the relay queue, so individual events do not clone the full review library. A failed or uncertain save is not acknowledged as received.

## 0.4.2 additive floor metadata

New scene parts add sceneFormat "floors-v1" and floor fields {id,number,speaker,role,createdAt,extraction,bodyTag,part,partCount}. The outer part/partCount spans the whole scene; floor.part/floor.partCount spans one original message. All chunks for a floor carry the same identity and are contiguous. Text chunks concatenate without separators within a floor. The receiver validates consistent format/identity/order and reconstructs all floors before saving or acknowledging a complete journal. Metadata is additive and the original text/checksum transport remains readable to older clients, though whole-floor review requires updated UvU. Old frozen parts and old scenes without metadata retain legacy reception.

## 0.4.1 pairing and device credentials

Pairing accepts `{code,device?:{name}}` and returns `{token,paired:true,device}` on both client transports. Old callers may ignore additive metadata. Permanent codes are 24 random bytes encoded as 32 base64url characters, hashed at rest and reusable until rotation. One-time codes remain single-use with five-minute TTL, and each successful pair creates a distinct credential. Legacy tokenHash continues to authorize and is listed as legacy.

Same-origin loopback UI routes: GET `/ui/pairing` returns mode, hasPermanent, createdAt and sanitized devices; PUT `/ui/pairing {mode}` selects temporary/permanent (permanent requires a generated code); POST `/ui/permanent-code` rotates and enables permanent mode and returns plaintext once; POST `/ui/revoke-device {id}` revokes one; POST `/ui/revoke-all` revokes all credentials, preserving the pairing code. Existing Tavern authentication and CSRF middleware apply. No management route exists on the separate client listener.

GET `/client/session` verifies the bearer and returns sanitized device identity, binding time and recent session check time (persisted at most once a minute per device). POST `/client/revoke` revokes only its bearer, never other devices. Permanent-code reset does not revoke issued tokens. The relay and character directory remain shared by devices; credential separation does not merge or namespace separate UvU databases.
