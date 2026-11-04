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

- `online`: UvU replies normally. Completed turns can be relayed as `memory_packet` records for the mapped SillyTavern character.
- `offline`: UvU checks this state before a private-chat generation and does not request a reply.
- `phone`: UvU may reply; its completed turn is tagged `phone_exchange`.
- Ending a SillyTavern scene exports ordered `scene_transcript` parts. UvU stores a complete scene as a draft journal after all parts arrive and are saved. It is not favorited by default.
- Enabling scene-memory injection in UvU favorites imported bridge journals. This uses the app's existing favorite-memory context path. No base prompt text or prompt assembly code is replaced.

The sequence queue is a local relay, not a shared live transcript. Each side retains its own original conversation. A scene transcript is imported only after all declared parts are present; if the queue reports a gap, the client must not claim a complete import.
