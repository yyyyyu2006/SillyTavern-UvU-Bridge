'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const EVENT_KINDS = new Set(['memory_packet', 'phone_exchange', 'scene_transcript', 'scene_summary', 'scene_cancelled', 'handoff_receipt']);
const MODES = new Set(['online', 'offline', 'phone']);
const SOURCES = new Set(['uvu', 'sillytavern']);

function emptyState() {
    return { version: 1, relayId: crypto.randomUUID(), enabled: true, nextSeq: 1, events: [], cursors: {}, gaps: {}, modes: {}, characters: [], tokenHash: null };
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
    if (['memory_packet', 'phone_exchange'].includes(kind) && input.payload.messages !== undefined) {
        if (!Array.isArray(input.payload.messages) || input.payload.messages.length > 500) throw new Error('Invalid messages');
        for (const record of input.payload.messages) {
            const id = record?.sourceMessageId || record?.id;
            if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.text !== 'string' || typeof id !== 'string' || !id || id.length > 300) throw new Error('Invalid message record');
            if (record.messagePart !== undefined || record.messagePartCount !== undefined) {
                if (!Number.isInteger(record.messagePart) || !Number.isInteger(record.messagePartCount) || record.messagePartCount < 2 || record.messagePartCount > 500 || record.messagePart < 1 || record.messagePart > record.messagePartCount || record.text.length > 10000) throw new Error('Invalid message parts');
            }
        }
    }
    if (kind === 'handoff_receipt' && (source !== 'sillytavern' || typeof input.payload.handoffId !== 'string' || typeof input.payload.archiveId !== 'string')) throw new Error('Invalid handoff receipt');
    if (kind === 'scene_transcript') {
        const { part, partCount, text } = input.payload;
        if (!Number.isInteger(part) || !Number.isInteger(partCount) || partCount < 1 || partCount > 2000 || part < 1 || part > partCount || typeof text !== 'string') throw new Error('Invalid scene parts');
        if (input.payload.partHash && input.payload.partHash !== digest(text)) throw new Error('Scene checksum mismatch');
    }
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
    let uiStates = {};
    let uiQueue = Promise.resolve();
    let mutationQueue = Promise.resolve();
    const capacity = Math.max(100, Math.min(10000, Math.floor(Number(maxEvents) || 2000)));

    async function save(draft, targetFile = filePath) {
        if (!targetFile) return Promise.resolve();
        const snapshot = JSON.stringify(draft);
        await fs.mkdir(path.dirname(targetFile), { recursive: true });
        const temporary = `${targetFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        try {
            await fs.writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
            await fs.rename(temporary, targetFile);
        } catch (error) {
            await fs.rm(temporary, { force: true }).catch(() => {});
            throw error;
        }
    }

    function mutate(change) {
        const operation = mutationQueue.then(async () => {
            const draft = structuredClone(state);
            const result = change(draft);
            await save(draft);
            state = draft;
            return structuredClone(result);
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
                relayId: typeof raw.relayId === 'string' && raw.relayId ? raw.relayId : crypto.randomUUID(),
                cursors: raw.cursors && typeof raw.cursors === 'object' && !Array.isArray(raw.cursors) ? raw.cursors : {},
                gaps: raw.gaps && typeof raw.gaps === 'object' && !Array.isArray(raw.gaps) ? raw.gaps : {},
                modes: raw.modes && typeof raw.modes === 'object' && !Array.isArray(raw.modes) ? raw.modes : {},
                characters: Array.isArray(raw.characters) ? raw.characters.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string').slice(0, 200) : [],
                events: raw.events.filter(event => event && SOURCES.has(event.source) && SOURCES.has(event.target) && EVENT_KINDS.has(event.kind)),
                nextSeq: Math.max(1, Number(raw.nextSeq) || 1),
                tokenHash: typeof raw.tokenHash === 'string' ? raw.tokenHash : null,
            };
            if (!raw.relayId) await save(state);
            pair = null;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        try {
            uiStates = JSON.parse(await fs.readFile(filePath + '.ui.json', 'utf8'));
            if (!uiStates || typeof uiStates !== 'object' || Array.isArray(uiStates)) throw new Error('Corrupted extension state');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
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
        await mutate(state => { state.tokenHash = digest(token); });
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
        await mutate(state => { state.tokenHash = null; });
    }

    async function appendEvent(input, source) {
        return mutate(state => {
            const clean = validateEvent(input, source);
            const duplicate = state.events.find(event => event.source === source && event.eventId === clean.eventId);
            if (duplicate) {
                if (duplicate.characterKey !== clean.characterKey || duplicate.sceneId !== clean.sceneId || JSON.stringify(duplicate.payload) !== JSON.stringify(clean.payload)) throw new Error('Event ID conflicts with previous content');
                return { event: duplicate, duplicate: true };
            }
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
        return { events: structuredClone(events), relayId: state.relayId, gapSeq, latestSeq, gapDetected: cursor < gapSeq, cursor: events.at(-1)?.seq || latestSeq };
    }

    function inbox(target) {
        if (!SOURCES.has(target)) throw new Error('Invalid event target');
        const latest = new Map();
        for (const event of state.events) if (event.target === target) latest.set(event.characterKey, event.seq);
        return { relayId: state.relayId, characters: [...latest].map(([characterKey, latestSeq]) => ({ characterKey, latestSeq })) };
    }

    async function acknowledge(target, seq, characterKey = '') {
        if (!SOURCES.has(target)) throw new Error('Invalid acknowledgement target');
        const cursor = Math.max(0, Math.floor(Number(seq) || 0));
        const key = `${target}:${String(characterKey || '*')}`;
        return mutate(state => {
            state.cursors[key] = Math.max(state.cursors[key] || 0, cursor);
            return state.cursors[key];
        });
    }

    function getMode(characterKey) {
        const value = state.modes[String(characterKey || '')];
        const result = value ? { ...value } : { mode: 'online', characterKey: String(characterKey || ''), sceneId: '', archiveId: '', updatedAt: 0 };
        return { ...result, mode: state.enabled === false ? 'online' : result.mode, enabled: state.enabled !== false };
    }

    function getService() { return { enabled: state.enabled !== false, relayId: state.relayId, ...require('./version.js') }; }

    async function setEnabled(enabled) {
        if (typeof enabled !== 'boolean') throw new Error('Invalid enabled flag');
        return mutate(state => {
            if ((state.enabled !== false) === enabled) return { enabled, relayId: state.relayId, ...require('./version.js') };
            state.enabled = enabled;
            // Re-enabling never resumes an old scene without an explicit UI action.
            for (const key of Object.keys(state.modes)) state.modes[key] = { ...state.modes[key], mode: 'online', updatedAt: now() };
            return { enabled: state.enabled !== false, relayId: state.relayId, ...require('./version.js') };
        });
    }

    function listCharacters() {
        return state.characters.map(character => ({ ...character }));
    }

    async function setCharacters(input) {
        if (!Array.isArray(input) || input.length > 200) throw new Error('Invalid character directory');
        const seen = new Set();
        const characters = input.map(item => {
            const id = String(item?.id || '').trim();
            const name = String(item?.name || '').trim();
            if (!id || id.length > 200 || !name || name.length > 120 || seen.has(id)) throw new Error('Invalid character directory entry');
            seen.add(id);
            return { id, name };
        });
        return mutate(state => {
            state.characters = characters;
            return state.characters.map(character => ({ ...character }));
        });
    }

    async function setMode(input) {
        const characterKey = String(input?.characterKey || '').trim();
        const mode = String(input?.mode || '');
        if (!characterKey || characterKey.length > 200) throw new Error('Invalid characterKey');
        if (!MODES.has(mode)) throw new Error('Invalid mode');
        const value = { characterKey, mode, sceneId: String(input.sceneId || '').slice(0, 160), archiveId: String(input.archiveId || '').slice(0, 200), updatedAt: now() };
        return mutate(state => {
            if (state.enabled === false && mode !== 'online') throw new Error('Bridge service is disabled');
            state.modes[characterKey] = value;
            return { ...value };
        });
    }

    function getUiState(userKey) {
        if (!userKey) throw new Error('Authenticated Tavern account required');
        return structuredClone(uiStates[digest(userKey)] || { revision: 0, settings: null });
    }
    async function putUiState(userKey, input) {
        if (!userKey) throw new Error('Authenticated Tavern account required');
        if (!input || !Number.isInteger(input.revision) || !input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings)) throw new Error('Invalid extension state');
        if (Buffer.byteLength(JSON.stringify(input.settings), 'utf8') > 16 * 1024 * 1024) throw new Error('Extension state exceeds 16 MiB');
        const snapshot = structuredClone(input.settings);
        const operation = uiQueue.then(async () => {
            const key = digest(userKey), previous = uiStates[key];
            if ((previous?.revision || 0) !== input.revision) throw new Error('Extension state changed in another tab; reload before saving');
            const value = { revision: input.revision + 1, settings: snapshot };
            const next = { ...uiStates, [key]: value };
            await save(next, filePath ? filePath + '.ui.json' : null);
            uiStates = next;
            return structuredClone(value);
        });
        uiQueue = operation.catch(() => {});
        return operation;
    }

    return { getUiState, putUiState, load, createPairCode, claimPair, isAuthorized, hasPairedClient, revokeToken, appendEvent, listEvents, inbox, acknowledge, getMode, setMode, getService, setEnabled, listCharacters, setCharacters };
}

module.exports = { createBridgeStore, validateEvent, EVENT_KINDS, MODES, SOURCES };
