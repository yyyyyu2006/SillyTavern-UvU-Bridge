'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const EVENT_KINDS = new Set(['memory_packet', 'phone_exchange', 'scene_transcript', 'scene_summary']);
const MODES = new Set(['online', 'offline', 'phone']);
const SOURCES = new Set(['uvu', 'sillytavern']);

function emptyState() {
    return { version: 1, nextSeq: 1, events: [], cursors: {}, gaps: {}, modes: {}, tokenHash: null };
}

function digest(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function validateEvent(input, source) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Event must be an object');
    if (!SOURCES.has(source) || input.source !== source) throw new Error('Event source does not match the authenticated client');
    const eventId = String(input.eventId || '').trim();
    const characterKey = String(input.characterKey || '').trim();
    const kind = String(input.kind || '');
    if (!eventId || eventId.length > 160) throw new Error('Invalid eventId');
    if (!characterKey || characterKey.length > 200) throw new Error('Invalid characterKey');
    if (!EVENT_KINDS.has(kind)) throw new Error('Unsupported event kind');
    if (input.payload == null || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new Error('Invalid event payload');
    const payload = JSON.stringify(input.payload);
    if (Buffer.byteLength(payload, 'utf8') > 48 * 1024) throw new Error('Event payload exceeds 48 KiB');
    const createdAt = Number(input.createdAt);
    return {
        eventId,
        source,
        target: source === 'uvu' ? 'sillytavern' : 'uvu',
        kind,
        characterKey,
        sceneId: String(input.sceneId || '').slice(0, 160),
        createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
        payload: JSON.parse(payload),
    };
}

function createBridgeStore({ filePath = null, maxEvents = 2000, pairTtlMs = 5 * 60_000, now = Date.now } = {}) {
    let state = emptyState();
    let pair = null;
    let mutationQueue = Promise.resolve();
    const capacity = Math.max(100, Math.min(10000, Math.floor(Number(maxEvents) || 2000)));

    async function save() {
        if (!filePath) return Promise.resolve();
        const snapshot = JSON.stringify(state);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        try {
            await fs.writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
            await fs.rename(temporary, filePath);
        } catch (error) {
            await fs.rm(temporary, { force: true }).catch(() => {});
            throw error;
        }
    }

    function mutate(change) {
        const operation = mutationQueue.then(async () => {
            const previous = state;
            state = structuredClone(state);
            try {
                const result = change();
                await save();
                return result;
            } catch (error) {
                state = previous;
                throw error;
            }
        });
        mutationQueue = operation.catch(() => {});
        return operation;
    }

    async function load() {
        if (!filePath) return;
        try {
            const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
            if (raw?.version !== 1 || !Array.isArray(raw.events) || !raw.cursors || typeof raw.modes !== 'object') throw new Error('Unsupported or corrupted bridge state file');
            state = { ...emptyState(), ...raw,
                cursors: raw.cursors && typeof raw.cursors === 'object' && !Array.isArray(raw.cursors) ? raw.cursors : {},
                gaps: raw.gaps && typeof raw.gaps === 'object' && !Array.isArray(raw.gaps) ? raw.gaps : {},
                modes: raw.modes && typeof raw.modes === 'object' && !Array.isArray(raw.modes) ? raw.modes : {},
                events: raw.events.filter(event => event && SOURCES.has(event.source) && SOURCES.has(event.target) && EVENT_KINDS.has(event.kind)),
                nextSeq: Math.max(1, Number(raw.nextSeq) || 1),
                tokenHash: typeof raw.tokenHash === 'string' ? raw.tokenHash : null,
            };
            pair = null;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }

    function createPairCode() {
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        pair = { hash: digest(code), expiresAt: now() + pairTtlMs };
        return { code, expiresAt: pair.expiresAt };
    }

    async function claimPair(code) {
        const candidate = digest(String(code || '').trim());
        if (!pair || pair.expiresAt <= now() || !crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(pair.hash))) {
            throw new Error('Pair code is invalid or expired');
        }
        pair = null;
        const token = crypto.randomBytes(32).toString('base64url');
        await mutate(() => { state.tokenHash = digest(token); });
        return token;
    }

    function isAuthorized(token) {
        if (!state.tokenHash || !token) return false;
        const candidate = digest(token);
        return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(state.tokenHash));
    }

    function hasPairedClient() {
        return typeof state.tokenHash === 'string' && state.tokenHash.length > 0;
    }

    async function revokeToken() {
        await mutate(() => { state.tokenHash = null; });
    }

    async function appendEvent(input, source) {
        return mutate(() => {
            const clean = validateEvent(input, source);
            const duplicate = state.events.find(event => event.source === source && event.eventId === clean.eventId);
            if (duplicate) return { event: duplicate, duplicate: true };
            const event = { ...clean, seq: state.nextSeq++ };
            state.events.push(event);
            if (state.events.length > capacity) {
                const removed = state.events.splice(0, state.events.length - capacity);
                for (const dropped of removed) {
                    const key = `${dropped.target}:${dropped.characterKey}`;
                    state.gaps[key] = Math.max(Number(state.gaps[key]) || 0, dropped.seq);
                }
            }
            return { event, duplicate: false };
        });
    }

    function listEvents(target, after = 0, limit = 100, characterKey = '') {
        if (!SOURCES.has(target)) throw new Error('Invalid event target');
        const cursor = Math.max(0, Math.floor(Number(after) || 0));
        const count = Math.max(1, Math.min(250, Math.floor(Number(limit) || 100)));
        const key = String(characterKey || '');
        const events = state.events.filter(event => event.target === target && event.seq > cursor && (!key || event.characterKey === key)).slice(0, count);
        const latestSeq = state.nextSeq - 1;
        const gapSeq = Number(state.gaps[`${target}:${key || '*'}`]) || 0;
        return { events, latestSeq, gapDetected: cursor < gapSeq, cursor: events.at(-1)?.seq || latestSeq };
    }

    async function acknowledge(target, seq, characterKey = '') {
        if (!SOURCES.has(target)) throw new Error('Invalid acknowledgement target');
        const cursor = Math.max(0, Math.floor(Number(seq) || 0));
        const key = `${target}:${String(characterKey || '*')}`;
        return mutate(() => {
            state.cursors[key] = Math.max(state.cursors[key] || 0, cursor);
            return state.cursors[key];
        });
    }

    function getMode(characterKey) {
        const value = state.modes[String(characterKey || '')];
        return value ? { ...value } : { mode: 'online', characterKey: String(characterKey || ''), sceneId: '', updatedAt: 0 };
    }

    async function setMode(input) {
        const characterKey = String(input?.characterKey || '').trim();
        const mode = String(input?.mode || '');
        if (!characterKey || characterKey.length > 200) throw new Error('Invalid characterKey');
        if (!MODES.has(mode)) throw new Error('Invalid mode');
        const value = { characterKey, mode, sceneId: String(input.sceneId || '').slice(0, 160), updatedAt: now() };
        return mutate(() => {
            state.modes[characterKey] = value;
            return { ...value };
        });
    }

    return { load, createPairCode, claimPair, isAuthorized, hasPairedClient, revokeToken, appendEvent, listEvents, acknowledge, getMode, setMode };
}

module.exports = { createBridgeStore, validateEvent, EVENT_KINDS, MODES, SOURCES };
