# Bridge protocol

All routes are mounted below `/api/plugins/uvu-story-bridge`. The browser client must use the local SillyTavern origin and send requests only after an explicit user gesture. Do not put bearer tokens in URLs.

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
- `POST /client/pair`: exchange a short-lived code for a bearer token.
- `GET /ui/events?after=<seq>`: loopback-only events from UvU waiting for SillyTavern.
- `GET /client/events?after=<seq>`: authenticated events from SillyTavern waiting for UvU.
- `POST /ui/events` and `POST /client/events`: append source-tagged events.
- `POST /ui/ack` and `POST /client/ack`: acknowledge imported sequence numbers.
- `GET /ui/state` and `PUT /ui/state`: read or update the linked character and scene mode.
- `POST /client/revoke`: revoke the paired token.

The server plugin never calls an LLM. UvU keeps using its existing API and prompt logic. SillyTavern memory is provided to its normal generation as a separate extension prompt only when the user has enabled that integration.
