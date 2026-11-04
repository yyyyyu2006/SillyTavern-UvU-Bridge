'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createBridgeStore } = require('../server/store.js');

function event(source, eventId, overrides = {}) {
    return { source, eventId, kind: 'memory_packet', characterKey: 'char-a', createdAt: 1,
        payload: { text: 'A promise made during the previous scene.' }, ...overrides };
}

test('pair code is single-use, expires, and bearer tokens can be revoked', async () => {
    let now = 1000;
    const store = createBridgeStore({ now: () => now, pairTtlMs: 100 });
    const first = store.createPairCode();
    assert.equal(store.hasPairedClient(), false);
    const token = await store.claimPair(first.code);
    assert.equal(store.isAuthorized(token), true);
    assert.equal(store.hasPairedClient(), true);
    await assert.rejects(store.claimPair(first.code), /invalid or expired/);
    await store.revokeToken();
    assert.equal(store.isAuthorized(token), false);
    assert.equal(store.hasPairedClient(), false);

    const second = store.createPairCode();
    now += 101;
    await assert.rejects(store.claimPair(second.code), /invalid or expired/);
});

test('events are idempotent and delivered only to the opposite app', async () => {
    const store = createBridgeStore();
    const first = await store.appendEvent(event('uvu', 'evt-1'), 'uvu');
    const duplicate = await store.appendEvent(event('uvu', 'evt-1'), 'uvu');
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(store.listEvents('sillytavern', 0).events.length, 1);
    assert.equal(store.listEvents('uvu', 0).events.length, 0);
});

test('source spoofing, invalid modes, and oversized event bodies are rejected', async () => {
    const store = createBridgeStore();
    await assert.rejects(store.appendEvent(event('sillytavern', 'evt-2'), 'uvu'), /source/);
    await assert.rejects(store.appendEvent(event('uvu', 'evt-3', { payload: { text: 'x'.repeat(50 * 1024) } }), 'uvu'), /48 KiB/);
    await assert.rejects(store.setMode({ characterKey: 'char-a', mode: 'unknown' }), /Invalid mode/);
});

test('independent cursors resume each direction without losing sequence ordering', async () => {
    const store = createBridgeStore();
    await store.appendEvent(event('uvu', 'u1'), 'uvu');
    await store.appendEvent(event('sillytavern', 's1', { kind: 'scene_summary' }), 'sillytavern');
    await store.appendEvent(event('uvu', 'u2'), 'uvu');
    assert.deepEqual(store.listEvents('sillytavern', 0).events.map(item => item.eventId), ['u1', 'u2']);
    assert.deepEqual(store.listEvents('uvu', 0).events.map(item => item.eventId), ['s1']);
    assert.equal(await store.acknowledge('sillytavern', 3), 3);
});

test('event history is filtered by linked character and reports dropped records per character', async () => {
    const store = createBridgeStore({ maxEvents: 100 });
    for (let index = 0; index < 101; index++) {
        await store.appendEvent(event('uvu', `evt-${index}`, { characterKey: `char-${index}` }), 'uvu');
    }
    const dropped = store.listEvents('sillytavern', 0, 100, 'char-0');
    const retained = store.listEvents('sillytavern', 0, 100, 'char-1');
    assert.equal(dropped.gapDetected, true);
    assert.equal(retained.gapDetected, false);
    assert.deepEqual(retained.events.map(item => item.characterKey), ['char-1']);
});

test('events, cursors, and modes survive a local restart', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'uvu-bridge-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'data.json');
    const first = createBridgeStore({ filePath });
    await first.load();
    await first.appendEvent(event('sillytavern', 'scene-1', { kind: 'scene_transcript' }), 'sillytavern');
    await first.acknowledge('uvu', 1);
    await first.setMode({ characterKey: 'char-a', mode: 'offline', sceneId: 'scene-1' });

    const restored = createBridgeStore({ filePath });
    await restored.load();
    assert.equal(restored.listEvents('uvu', 0).events[0].eventId, 'scene-1');
    assert.equal(restored.getMode('char-a').sceneId, 'scene-1');
});

test('failed persistence rolls back the in-memory event so retry is not mistaken for success', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'uvu-bridge-fail-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const blockedParent = path.join(directory, 'not-a-directory');
    await fs.writeFile(blockedParent, 'occupied');
    const store = createBridgeStore({ filePath: path.join(blockedParent, 'state.json') });
    await assert.rejects(store.appendEvent(event('uvu', 'retry-me'), 'uvu'));
    assert.equal(store.listEvents('sillytavern', 0).events.length, 0);
});
