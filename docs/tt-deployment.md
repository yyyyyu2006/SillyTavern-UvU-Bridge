# TauriTavern / iOS: start with offline files; optional private HTTPS relay

**Start here:** ordinary TT users need only the UI extension and JSON files. TT does not run the SillyTavern Node server plugin. File mode is the default on both sides, needs no endpoint, pairing code, Termux or admin secret, and hides online-only controls and the ST backend tutorial. A saved TT HTTPS connection stays selected after upgrading.

Version 0.5.0 adds a TT adapter. Original Node SillyTavern plugin routes, CSRF, loopback transport and injection gates remain compatible. TT has no Node server-plugin process; install the UI extension in TT and choose **TauriTavern / iOS 连接** in its existing extension panel.

Version 0.5.1 adds the beginner onboarding corrections. A TT mode selection is not applied until **保存 TT 连接** succeeds. While it differs from the saved mode, the panel labels both modes and pauses sync and related actions; select the saved mode again to cancel. Saving suspends the existing scene under the original rules; return to its original chat and explicitly resume after configuration.

## Compatibility and policy

The implementation targets official TT Host ABI **2**, pinned source commit `fff9af0333be97697be2313981699ab0ce35c236` from `Darkatse/TauriTavern`, checked on 2026-11-05. Relevant primary references: `docs/FrontendHostContract.md`, `docs/API/Chat.md`, `docs/API/Extension.md`, and `docs/CurrentState/iOSPolicy.md` in that commit. TT changes after that reference require revalidation.

The extension waits for `__TAURITAVERN__.ready`, checks ABI and available storage/history methods, and reads the effective `iosPolicy.capabilities` snapshot. If third-party execution is forbidden the extension cannot operate; in builds where the host filters it at discovery, this panel cannot appear at all. If prompt injection is forbidden, received copies may be reviewed but this extension's prompt stays empty. It never changes the policy. Public TestFlight external-beta builds may disable third-party extensions; use a distribution that permits this capability.

TT scenes pin `api.chat.current.ref()` and call `api.chat.open(ref).history.tail/before` in bounded 100-message pages. Null slots in `getContext().chat` are never silently discarded. Page continuity, absolute indexes and current ChatRef are checked. Unsaved or differing live messages stop export until TT saves them. Source floor numbers refer to the original full history. State is written through `api.extension.store.setJson`, awaited and read back through `tryGetJson`. Native atomic replacement confirms a completed write, not power-loss durability; retain ordinary TT data backups.

Desktop automated tests cover a TT ABI fixture, the actual extension panel, and a real HTTP relay. **No iPhone/iPad physical-device validation or hosted public service has been provided.** Check file download/import, WebView Origin/CORS, TLS, foreground/background transitions and policy on the actual installed iOS build before relying on it.

## File handoff without a server

1. In TT, open the intended character's private chat. Select **离线 JSON 文件** and **保存 TT 连接**. File mode stores its copies locally using TT native storage.
2. In UvU, choose **TauriTavern / iOS → 无需服务器的文件交接**. Explicitly select and **保存角色**, then **读取所选角色当前存档**. Check the displayed character ID, archive name/ID and start/end message numbers. Export the intended message range as a `to-tavern` JSON file. Transfer it using your own Files/cloud/local mechanism.
3. In TT, select that JSON file. The extension validates the packet and reads its exact character/archive IDs into the target fields without saving a binding, approving text or switching the current TT chat. Check the displayed IDs against UvU, then click **导入线上交接文件**. The selected target must still match every event and the wrapper. The extension will not silently change an existing character binding. Open the correct Tavern character yourself before importing.
4. Expand **线上记忆审核**, inspect each copy, select/edit and **保存勾选与编辑**. Choose **设为下场记忆来源** for the intended archive. Enable memory injection only when desired and allowed by TT policy; then **开始线下剧情**.
5. Manually stop the corresponding UvU automatic replies during offline play. File mode cannot control another device's mode, synchronize live or provide the phone channel. It rejects **拿出手机** until HTTPS is configured.
6. Chat normally in TT. Click **结束并导出** to freeze complete body-only scene parts into the native file outbox. Click **下载待交接剧情 JSON** with the same character/archive target. A browser download is not a receipt from UvU.
7. Transfer the JSON to UvU and import into that exact selected character/archive. In **酒馆线下剧情 → UvU 记忆**, review and select complete floors. Use **生成摘要**, check/edit the preview, then **确认摘要并加入记忆**, or use **原文直接加入记忆**. Enable this page and **所选角色使用已审核的酒馆剧情记忆** when you want the saved memory in context. It does not automatically become usable memory or enter the original local chat.
8. Keep the outbox for retry until UvU confirms saved data. **清空已交接发件箱** requires a confirmation and no active scene. Reimporting the same file is idempotent. File receipt hashes and normal source IDs preserve deduplication; file import never advances a live relay cursor or sends a relay ACK.

File wrapper: `{format:'uvu-bridge-file',version:1,direction:'to-uvu'|'to-tavern',characterKey,archiveId,events}`. Limits: 16 MiB UTF-8, 2000 events, 64 KiB/event and 48 KiB/event payload. Scene parts require SHA-256 `partHash`, complete ordered scene/floor parts and valid floor metadata. Memory packet multipart messages must be complete. Target mismatch, bad checksum, missing parts and invalid identities reject before import. Checksum detects accidental corruption, not the identity of the file author; review the source text before approval. JSON is treated as data and never executed.

## Optional: deploy a private HTTPS relay

Choose HTTPS mode only after independently deploying the relay below on an always-on server with a domain, valid TLS and exact allowed origins. Installing the TT UI extension does not deploy a relay. The UvU site / GitHub Pages URL is a static webpage, not an API; it cannot accept bridge writes (typically HTTP 405). Both apps reject known `github.io` relay addresses before sending credentials. Use the private relay base URL instead, or keep file mode.

This is a **single-user, self-hosted instance**. Every bound device shares its character directory, relay queue and mode. It is not a public multi-tenant service. Use a separate instance and separate secrets/data directory for another person. No public service or secret is embedded.

1. On your own always-on server install Node.js 20 or newer and clone this repository. Keep the checkout and data private. Copy `server/relay-config.example.json` to ignored `server/relay-config.json`.
2. Generate a strong administrator credential locally:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Put the result in the private config's `adminSecret`, or supply `UVU_RELAY_ADMIN_SECRET` through your service's private environment. The empty example credential deliberately refuses startup. Do not reuse a UvU device token or pairing code, commit the config, send it to another person, or put it in a URL.
3. Set `publicUrl` to your own HTTPS origin (no query, fragment, userinfo or path). Configure `clientOrigins` with the exact UvU webpage origin, without a trailing slash. Configure `uiOrigins` with the TT request Origin on each of your actual devices. `tauri://localhost` in the example is an exact application-origin example; it is not a guarantee that every iOS build uses that Origin. The panel displays `location.origin` as a clue, but verify the actual Origin header in your browser/network diagnostics. The exact Tauri Windows application origin `http://tauri.localhost`, exact HTTPS origins and loopback development origins are also accepted when explicitly listed. `*`, `null`, path prefixes and wildcard subdomains are rejected. If a build only sends `null`, use files; do not broadly authorize opaque origins.
4. Run `node server/relay.js` or `npm run relay`. To use a config in another private directory set `UVU_RELAY_CONFIG` to its absolute path. `dataFile` resolves relative to the config. The service loads existing state before accepting connections; corrupted state/config fails startup. The default listener is **127.0.0.1:8766**, intended only behind the HTTPS proxy on that server.
5. Point your own domain at that server and install a certificate-issuing HTTPS reverse proxy, for example Caddy. A minimal Caddyfile is:

   ```caddyfile
   relay.your-domain.example {
       request_body {
           max_size 64KB
       }
       reverse_proxy 127.0.0.1:8766
   }
   ```

   Replace the domain. Serve valid HTTPS on 443, allow the certificate mechanism's required ports, and keep 8766 private. Do not configure CORS wildcard headers at the proxy; the relay supplies exact origin responses. Preserve the Origin header. Do not log Authorization headers or request bodies. No URL query parameters carry credentials.
6. Run Node under your existing OS service manager with this checkout as working directory, a restricted local user and writable private data directory. Configure restart-on-failure. For a basic Linux systemd unit, use your actual absolute paths/user:

   ```ini
   [Unit]
   Description=Private UvU TT relay
   After=network.target

   [Service]
   Type=simple
   User=uvu-relay
   WorkingDirectory=/srv/uvu-bridge
   ExecStart=/usr/bin/node /srv/uvu-bridge/server/relay.js
   Restart=on-failure
   Environment=UVU_RELAY_CONFIG=/srv/uvu-private/relay-config.json
   UMask=0077

   [Install]
   WantedBy=multi-user.target
   ```

   Prepare the named user, private directory and permissions through your normal server administration. No service is installed or enabled by this repository automatically. For Windows, use your existing service manager and point it at `node.exe` plus `server/relay.js`.
7. Back up the private config and `dataFile` while the service is stopped. Protect backups as private conversation data. Relay state persists the random relayId, device hashes, pair-code hash, queue, modes and cursors. Writes publish atomically, and failures do not acknowledge a new event. Event replay after restart is idempotent by original source/event ID. A bounded queue may drop old records and report a gap; the apps then require recovery/review rather than claiming a complete sync.

## Connect and operate

1. In TT select **自建 HTTPS 中继**, fill the same base URL as `publicUrl` and the independent administrator secret, then click **保存 TT 连接**. The TT connection config is in a separate native-store key from scene/review state; it is not mirrored to the relay or UvU.
2. Generate a one-time code (five minutes) or a permanent code in the existing panel. In UvU select the **TT** channel, enter the same HTTPS base URL and the pairing code, and connect. UvU gets a separate device bearer credential through `/v1/client/pair`; never paste the admin secret into UvU. The original Tavern **ST** channel retains separate endpoint/credentials.
3. Keep both pages in the foreground for initial synchronization. Publish/refresh UvU's directory, bind the correct character, hand off the selected archive/range, review copies in TT, explicitly choose the next scene source, then start. Memory injection retains the original opt-in, reviewed-item and exact scene/chat/archive gates.
4. **拿出手机 / 收起手机** control the connected UvU mode. TT and UvU continue calling their own normal generation providers. **结束并导出** queues the scene for UvU review. Nothing silently replaces either app's base prompts or original transcripts.
5. Background WebViews may pause; return to the foreground and refresh. A changed chat aborts pending requests. Returning to an existing suspended scene requires **继续本场**. Changing connection settings suspends a scene. Rebuilt relay IDs and old sequence gaps require explicit rehandoff.

TT requests `/v1/ui/*` with administrator Bearer auth and `credentials:omit`, without Tavern CSRF. UvU requests `/v1/client/*` with paired device Bearer auth. The UI origin list and client origin list are independent. UI native state does not need a remote extension-state endpoint. Original `/api/plugins/uvu-story-bridge` and loopback client listeners remain separate.

## Errors and recovery

| Symptom | Action |
| --- | --- |
| Panel absent / policy disables extensions | Check installed TT build and its effective third-party execution capability; the extension cannot override it. |
| ABI/API unavailable | Update TT to the documented ABI and available chat/native-store APIs. |
| HTTP 401 | Verify TT admin credential or re-pair the specific UvU device. Rotating a pairing code does not revoke issued devices; use revoke controls. |
| HTTP 403 / CORS | Compare the exact request Origin with the correct private `uiOrigins` or `clientOrigins`, then restart the relay after config changes. |
| HTTP 413 | Split the scene/handoff; preserve body/floor chunks and complete files. |
| HTTP 429 | Wait one minute and check polling/repeated pairing attempts. Default overall limit is 120 requests/minute per direct connection IP, pairing 8/minute. Behind the proxy this is shared; this is a private single-user service. |
| HTTP 503 / save not confirmed | Check disk permissions/space, retain original chat and frozen payload, and retry. Do not mark it received. |
| TT live history differs from saved pages | Wait for TT chat save; save edits, stay on the pinned chat and retry. Incomplete histories never export. |
| New relayId or queue gap | Restore your own stopped-service backup, or deliberately re-pair/rehand off and review. Existing approved local memories remain. |
| Offline file download does not work on iOS | Use supported Files/share handling in the installed build; this has not been verified on a physical iOS device. |

To update, pull this checkout, run `node --test tests/*.test.cjs`, restart the relay and update/refresh the UI extension. Keep both apps at compatible versions. Do not clear native settings, data or review receipts to fix a connection error.
