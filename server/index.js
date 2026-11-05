'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createBridgeStore } = require('./store.js');
const { createClientHttpServer } = require('./client-http.js');

const ROUTE_PREFIX = '/v1';
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const store = createBridgeStore({ filePath: path.join(DATA_DIR, 'bridge-state.json') });
let configPromise;
let initialized = false;
const pairFailures = new Map();
let clientHttpServer = null;

async function loadConfig() {
    if (configPromise) return configPromise;
    configPromise = (async () => {
        let loaded = {};
        try { loaded = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') console.error('[UvU Bridge] Invalid config:', error.message); }
        const origins = Array.isArray(loaded.allowedOrigins) ? loaded.allowedOrigins : ['https://yyyyyu2006.github.io'];
        return {
            allowedOrigins: [...new Set(origins.map(value => String(value).trim()).filter(value => /^https:\/\//i.test(value)))],
            maxPayloadBytes: Math.max(1024, Math.min(65536, Number(loaded.maxPayloadBytes) || 65536)),
            clientPort: Number.isInteger(Number(loaded.clientPort)) && Number(loaded.clientPort) >= 1024 && Number(loaded.clientPort) <= 65535
                ? Number(loaded.clientPort)
                : 8765,
        };
    })();
    return configPromise;
}

function isLoopback(req) {
    const ip = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function sendError(res, status, message) {
    return res.status(status).json({ error: message });
}

function bodySize(req) {
    try { return Buffer.byteLength(JSON.stringify(req.body ?? null), 'utf8'); }
    catch { return Infinity; }
}

function tokenFrom(req) {
    const match = /^Bearer\s+(.+)$/i.exec(String(req.get?.('authorization') || req.headers?.authorization || ''));
    return match?.[1] || '';
}

function localUi(req, res, next) {
    if (!isLoopback(req)) return sendError(res, 403, 'This endpoint only accepts loopback connections.');
    const origin = String(req.get?.('origin') || '');
    if (origin) {
        try {
            const parsed = new URL(origin);
            if (parsed.host !== req.get('host')) return sendError(res, 403, 'UI endpoint must be same-origin.');
        } catch { return sendError(res, 403, 'Invalid origin.'); }
    }
    return next();
}

async function clientOrigin(req, res, next) {
    if (!isLoopback(req)) return sendError(res, 403, 'This endpoint only accepts loopback connections.');
    const origin = String(req.get?.('origin') || '');
    const options = await loadConfig();
    if (!origin || !options.allowedOrigins.includes(origin)) return sendError(res, 403, 'This page origin is not allowed by server/config.json.');
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.set('Access-Control-Max-Age', '600');
    return next();
}

function clientCors(router) {
    router.use(async (req, res, next) => {
        if (!req.path.startsWith(`${ROUTE_PREFIX}/client/`)) return next();
        const origin = String(req.get?.('origin') || '');
        const options = await loadConfig();
        if (req.method === 'OPTIONS') {
            if (!isLoopback(req) || !origin || !options.allowedOrigins.includes(origin)) return sendError(res, 403, 'This page origin is not allowed by server/config.json.');
            res.set('Access-Control-Allow-Origin', origin);
            res.set('Vary', 'Origin');
            res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
            res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
            res.set('Access-Control-Max-Age', '600');
            return res.status(204).end();
        }
        return clientOrigin(req, res, next);
    });
}

function requireClient(req, res, next) {
    if (!store.isAuthorized(tokenFrom(req))) return sendError(res, 401, 'This device is not paired.');
    return next();
}

function rateLimitPair(req, res, next) {
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();
    const record = pairFailures.get(ip);
    if (record && now - record.startedAt < 60_000 && record.count >= 8) return sendError(res, 429, 'Too many pairing attempts. Try again in one minute.');
    return next();
}

function countPairFailure(req) {
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();
    const current = pairFailures.get(ip);
    pairFailures.set(ip, !current || now - current.startedAt >= 60_000 ? { startedAt: now, count: 1 } : { ...current, count: current.count + 1 });
}

function attachRoutes(router) {
    clientCors(router);

    router.get(`${ROUTE_PREFIX}/health`, localUi, async (req, res) => {
        res.json({ ok: true, paired: store.hasPairedClient(), ...store.getService() });
    });
    router.get(`${ROUTE_PREFIX}/ui/service`, localUi, (_req, res) => res.json(store.getService()));
    router.put(`${ROUTE_PREFIX}/ui/service`, localUi, async (req, res) => {
        try { res.json(await store.setEnabled(req.body?.enabled)); }
        catch (error) { sendError(res, 400, error.message); }
    });
    router.get(`${ROUTE_PREFIX}/client/service`, requireClient, (_req, res) => res.json(store.getService()));
    router.get(`${ROUTE_PREFIX}/client/inbox`, requireClient, (_req, res) => res.json(store.inbox('uvu')));

    router.get(`${ROUTE_PREFIX}/ui/pair-code`, localUi, (req, res) => {
        const pair = store.createPairCode();
        res.json(pair);
    });

    router.post(`${ROUTE_PREFIX}/client/pair`, rateLimitPair, async (req, res) => {
        if (bodySize(req) > 2048) return sendError(res, 413, 'Request is too large.');
        try {
            const token = await store.claimPair(req.body?.code);
            pairFailures.delete(String(req.ip || req.socket?.remoteAddress || 'unknown'));
            return res.json({ token });
        } catch {
            countPairFailure(req);
            return sendError(res, 401, 'Pair code is invalid, expired, or already used.');
        }
    });

    router.get(`${ROUTE_PREFIX}/ui/state`, localUi, (req, res) => {
        res.json(store.getMode(req.query?.characterKey));
    });
    router.put(`${ROUTE_PREFIX}/ui/state`, localUi, async (req, res) => {
        try { res.json(await store.setMode(req.body)); }
        catch (error) { sendError(res, 400, error.message); }
    });
    router.get(`${ROUTE_PREFIX}/client/state`, requireClient, (req, res) => {
        res.json(store.getMode(req.query?.characterKey));
    });
    router.put(`${ROUTE_PREFIX}/client/state`, requireClient, async (req, res) => {
        if (bodySize(req) > 2048) return sendError(res, 413, 'Request is too large.');
        try { res.json(await store.setMode(req.body)); }
        catch (error) { sendError(res, 400, error.message); }
    });
    router.get(`${ROUTE_PREFIX}/ui/characters`, localUi, (_req, res) => {
        res.json({ characters: store.listCharacters() });
    });
    router.put(`${ROUTE_PREFIX}/client/characters`, requireClient, async (req, res) => {
        if (bodySize(req) > 64 * 1024) return sendError(res, 413, 'Character directory is too large.');
        try { res.json({ characters: await store.setCharacters(req.body?.characters) }); }
        catch (error) { sendError(res, 400, error.message); }
    });

    const append = source => async (req, res) => {
        const options = await loadConfig();
        if (bodySize(req) > options.maxPayloadBytes) return sendError(res, 413, 'Event exceeds the configured size limit.');
        try { res.json(await store.appendEvent(req.body, source)); }
        catch (error) { sendError(res, 400, error.message); }
    };
    const list = target => (req, res) => {
        try { res.json(store.listEvents(target, req.query?.after, req.query?.limit, req.query?.characterKey)); }
        catch (error) { sendError(res, 400, error.message); }
    };
    const ack = target => async (req, res) => {
        if (bodySize(req) > 2048) return sendError(res, 413, 'Request is too large.');
        try { res.json({ cursor: await store.acknowledge(target, req.body?.seq, req.body?.characterKey) }); }
        catch (error) { sendError(res, 400, error.message); }
    };

    router.get(`${ROUTE_PREFIX}/ui/events`, localUi, list('sillytavern'));
    router.post(`${ROUTE_PREFIX}/ui/events`, localUi, append('sillytavern'));
    router.post(`${ROUTE_PREFIX}/ui/ack`, localUi, ack('sillytavern'));
    router.get(`${ROUTE_PREFIX}/client/events`, requireClient, list('uvu'));
    router.post(`${ROUTE_PREFIX}/client/events`, requireClient, append('uvu'));
    router.post(`${ROUTE_PREFIX}/client/ack`, requireClient, ack('uvu'));
    router.post(`${ROUTE_PREFIX}/client/revoke`, requireClient, async (req, res) => {
        await store.revokeToken();
        res.json({ ok: true });
    });
}

module.exports = {
    info: {
        id: 'uvu-story-bridge',
        name: 'UvU Story Bridge',
        description: 'Authenticated local event and memory relay for UvU.',
        version: require('./version.js').version,
    },
    async init(router) {
        if (!initialized) {
            await store.load();
            initialized = true;
        }
        attachRoutes(router);
        if (!clientHttpServer?.listening) {
            const options = await loadConfig();
            clientHttpServer = createClientHttpServer({ store, loadConfig });
            await new Promise((resolve, reject) => {
                clientHttpServer.once('error', reject);
                clientHttpServer.listen(options.clientPort, '127.0.0.1', () => {
                    clientHttpServer.removeListener('error', reject);
                    console.info(`[UvU Bridge] UvU client API listening on 127.0.0.1:${options.clientPort}.`);
                    resolve();
                });
            }).catch(error => {
                clientHttpServer = null;
                console.error('[UvU Bridge] Could not start the loopback client API:', error.message);
            });
        }
        console.info('[UvU Bridge] Local bridge routes registered.');
    },
    exit() {
        initialized = false;
        if (clientHttpServer) {
            clientHttpServer.close();
            clientHttpServer = null;
        }
        console.info('[UvU Bridge] Stopped.');
    },
    _test: { attachRoutes, store, loadConfig },
};
