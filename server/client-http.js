'use strict';

const { createServer } = require('node:http');
const { Buffer } = require('node:buffer');

const ROUTE_PREFIX = '/v1/client/';
const LEGACY_BASE_PREFIX = '/api/plugins/uvu-story-bridge';
const ALLOWED_METHODS = 'GET, POST, PUT, OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type';
const pairFailures = new Map();

function isLoopback(req) {
    const address = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    return address === '127.0.0.1' || address === '::1';
}

function tokenFrom(req) {
    const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    return match?.[1] || '';
}

function send(res, status, body, origin = '') {
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
        res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
        res.setHeader('Access-Control-Max-Age', '600');
    }
    res.setHeader('Cache-Control', 'no-store');
    if (status === 204) return res.writeHead(status).end();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(status).end(JSON.stringify(body));
}

async function readJson(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) throw Object.assign(new Error('Request is too large.'), { status: 413 });
        chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); }
    catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}

function createClientHttpServer({ store, loadConfig }) {
    return createServer(async (req, res) => {
        let config;
        try { config = await loadConfig(); }
        catch { return send(res, 500, { error: 'Bridge configuration could not be loaded.' }); }

        const origin = String(req.headers.origin || '');
        if (!isLoopback(req)) return send(res, 403, { error: 'This endpoint only accepts loopback connections.' });
        if (!origin || !config.allowedOrigins.includes(origin)) {
            return send(res, 403, { error: 'This page origin is not allowed by server/config.json.' });
        }

        if (req.method === 'OPTIONS') return send(res, 204, null, origin);

        let url;
        try { url = new URL(req.url, 'http://127.0.0.1'); }
        catch { return send(res, 400, { error: 'Invalid request URL.' }, origin); }
        let pathname = url.pathname;
        if (pathname === LEGACY_BASE_PREFIX || pathname.startsWith(`${LEGACY_BASE_PREFIX}/`)) {
            pathname = pathname.slice(LEGACY_BASE_PREFIX.length) || '/';
        }
        if (!pathname.startsWith(ROUTE_PREFIX)) return send(res, 404, { error: 'Bridge route not found.' }, origin);

        const isPair = pathname === `${ROUTE_PREFIX}pair` && req.method === 'POST';
        const token = tokenFrom(req);
        if (!isPair && !store.isAuthorized(token)) return send(res, 401, { error: 'This device is not paired.' }, origin);

        try {
            if (isPair) {
                const now = Date.now();
                const ip = req.socket.remoteAddress || 'unknown';
                const failures = pairFailures.get(ip);
                if (failures && now - failures.startedAt < 60_000 && failures.count >= 8) {
                    return send(res, 429, { error: 'Too many pairing attempts. Try again in one minute.' }, origin);
                }
                const body = await readJson(req, 2048);
                try {
                    const pairedToken = await store.claimPair(body?.code);
                    pairFailures.delete(ip);
                    return send(res, 200, { token: pairedToken }, origin);
                } catch {
                    pairFailures.set(ip, !failures || now - failures.startedAt >= 60_000
                        ? { startedAt: now, count: 1 }
                        : { ...failures, count: failures.count + 1 });
                    return send(res, 401, { error: 'Pair code is invalid, expired, or already used.' }, origin);
                }
            }

            if (pathname === `${ROUTE_PREFIX}state` && req.method === 'GET') {
                return send(res, 200, store.getMode(url.searchParams.get('characterKey')), origin);
            }
            if (pathname === `${ROUTE_PREFIX}state` && req.method === 'PUT') {
                const body = await readJson(req, 2048);
                try { return send(res, 200, await store.setMode(body), origin); }
                catch (error) { return send(res, 400, { error: error.message }, origin); }
            }
            if (pathname === `${ROUTE_PREFIX}characters` && req.method === 'PUT') {
                const body = await readJson(req, 64 * 1024);
                try { return send(res, 200, { characters: await store.setCharacters(body?.characters) }, origin); }
                catch (error) { return send(res, 400, { error: error.message }, origin); }
            }
            if (pathname === `${ROUTE_PREFIX}events` && req.method === 'GET') {
                try {
                    return send(res, 200, store.listEvents('uvu', url.searchParams.get('after'), url.searchParams.get('limit'), url.searchParams.get('characterKey')), origin);
                } catch (error) { return send(res, 400, { error: error.message }, origin); }
            }
            if (pathname === `${ROUTE_PREFIX}events` && req.method === 'POST') {
                const body = await readJson(req, config.maxPayloadBytes);
                try { return send(res, 200, await store.appendEvent(body, 'uvu'), origin); }
                catch (error) { return send(res, 400, { error: error.message }, origin); }
            }
            if (pathname === `${ROUTE_PREFIX}ack` && req.method === 'POST') {
                const body = await readJson(req, 2048);
                try { return send(res, 200, { cursor: await store.acknowledge('uvu', body?.seq, body?.characterKey) }, origin); }
                catch (error) { return send(res, 400, { error: error.message }, origin); }
            }
            if (pathname === `${ROUTE_PREFIX}revoke` && req.method === 'POST') {
                await store.revokeToken();
                return send(res, 200, { ok: true }, origin);
            }
            return send(res, 404, { error: 'Bridge route not found.' }, origin);
        } catch (error) {
            return send(res, error.status || 500, { error: error.status ? error.message : 'Bridge request failed.' }, origin);
        }
    });
}

module.exports = { createClientHttpServer };
