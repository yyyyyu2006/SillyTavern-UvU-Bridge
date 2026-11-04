# UvU Story Bridge for SillyTavern

This project is a local, opt-in bridge between the UvU phone UI and SillyTavern. It keeps online UvU turns and offline SillyTavern scenes as separate, source-tagged records. It does not rewrite either app's base prompt.

## Current status

This is an early prototype. The server API, SillyTavern panel, and a reusable UvU browser client are implemented and tested in isolation. The current UvU app does not yet include its connection panel or message/memory lifecycle integration, so installing this repository in SillyTavern alone does not connect the apps end to end.

The repository includes a reusable browser client at `client/uvu-bridge-client.js`. It is not wired into UvU's UI yet; the next integration change in UvU will add a connection panel, store the paired token locally, and move scene transcripts into its existing memory-journal flow.

The repository contains both parts required by the bridge:

- A SillyTavern UI extension for pairing, mode control, memory context, and scene export.
- A SillyTavern server plugin that exposes the authenticated local API used by UvU.

SillyTavern server plugins run with server-side privileges. Review the source before installing and only enable server plugins if you trust it.

## Intended behavior

- Online mode leaves normal UvU chat behavior unchanged.
- Offline scene mode captures the selected SillyTavern chat only after the user starts a scene.
- UvU messages are held as source-tagged memory events; they are not silently inserted into the SillyTavern chat transcript.
- SillyTavern scene exports are delivered to UvU as separate records for review and summarization.
- Memory injection is opt-in and uses SillyTavern's extension-prompt facility, not edits to the character card or base prompt.
- Switching modes never deletes either app's source conversation.

## Installation overview

Install the repository twice because the UI extension and server plugin run in different parts of SillyTavern:

1. Add the repository URL in SillyTavern's third-party extension installer to install the UI panel.
2. Clone the same repository into `<SillyTavern>/plugins/uvu-story-bridge` for the server plugin.
3. Set `enableServerPlugins: true` in the server's `config.yaml`, then restart SillyTavern.
4. Copy `plugins/uvu-story-bridge/server/config.example.json` to `plugins/uvu-story-bridge/server/config.json` and allow only the exact HTTPS origin serving UvU. The sample currently lists `https://yyyyyu2006.github.io`; retain or replace it with the deployed page's origin.
5. Pair the apps using the short-lived code shown in the UvU Story Bridge panel.

For a GitHub Pages project, the bridge base URL entered in UvU is `http://127.0.0.1:<SillyTavern-port>/api/plugins/uvu-story-bridge`. The default SillyTavern port may differ by installation; use its actual local port. Start pairing from a visible UvU page by clicking the connect action. Browser local-network permission and mixed-content behavior vary by browser/version and must be tested on the target device. Background pages may pause, so the client resumes from sequence cursors when brought back to the foreground.

The UI extension and server plugin must both be installed. The extension manager cannot install or enable a server plugin on a user's behalf. Server plugins are not sandboxed and can access server-side resources; review the code before enabling one.

## Data and security

- The API is intended for a SillyTavern instance on the same device as UvU.
- Cross-origin requests require an explicit origin allowlist and a paired bearer token.
- Pair codes expire and can only be redeemed once. Tokens can be revoked from either side.
- The plugin rejects non-loopback clients by default.
- Local event and memory records are stored under `server/data/`, which is excluded from Git.
- Do not expose the SillyTavern server port to the public internet. CORS is not authentication.

## Development

```sh
npm test
```

See [the protocol](docs/protocol.md) for the event envelope and planned UvU integration points.
