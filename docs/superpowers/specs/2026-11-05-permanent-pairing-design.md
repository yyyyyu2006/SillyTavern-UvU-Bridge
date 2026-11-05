# Permanent pairing design

Approved scope: the user accepted the preceding eight-item optimization list and asked for implementation with continuous self-checks.

Keep the five-minute single-use code and add an explicitly selected permanent random code, hashed at rest and shown only when generated. Permanent code rotation does not revoke existing devices. Each browser gets its own opaque persistent token; pairing another browser retains existing tokens. Legacy tokenHash remains usable and manageable. Provide per-device revoke and explicit revoke-all independently of code reset. Never auto-fill or retain the permanent code in UvU.

UvU keeps the existing local token key, adds optional device metadata, verifies it through a session endpoint, and retries transient connection failure with bounded backoff while visible. Revoked tokens stay stored until explicit local disconnect or re-pair, but automatic retries stop on 401. Bind token use to the saved service origin/address so a new address cannot receive old credentials.

Approaches: making a six-digit code immortal permits cheap guessing; making only the token permanent already exists and does not satisfy repeated pairing. Chosen approach is a long reusable pairing secret plus independent per-device tokens. Keep exact-origin allowlist, loopback-only listeners, CSRF and pairing rate limits. No prompt, model request, chat content or CSS beautification changes. Device credentials share this local relay and directory; this release does not merge separate UvU databases.

Controls: pairing method, generate/copy/reset permanent code, refresh devices, revoke one, revoke all. Secrets are not listed in diagnostics or APIs after creation. Settings persist across restarts; loss of browser or server data still requires rebinding.
