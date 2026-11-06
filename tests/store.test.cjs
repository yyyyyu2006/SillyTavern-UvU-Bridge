'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createBridgeStore } = require('../server/store.js');
const bridgeText = require('../story-text.js');

function event(source, eventId, overrides = {}) {
    return { source, eventId, kind: 'memory_packet', characterKey: 'char-a', createdAt: 1,
        payload: { text: 'A promise made during the previous scene.' }, ...overrides };
}

test('invalid new scene floor metadata is rejected before entering the relay', async () => {
    const store = createBridgeStore();
    const payload = {text: '正文', part: 1, partCount: 1, sceneFormat: 'floors-v1', floor: {id: 'f', number: 1, speaker: 'A',
        role: 'assistant', createdAt: 1, extraction: 'tagged', bodyTag: 'content', part: 1, partCount: 1}};
    for (const field of [{number: 0}, {part: 2}, {role: 'system'}, {speaker: null}, {createdAt: 8640000000000001}]) {
        await assert.rejects(store.appendEvent(event('sillytavern', 'invalid-floor', {kind: 'scene_transcript', payload: {...payload, floor: {...payload.floor, ...field}}}), 'sillytavern'), /floor|楼层/i);
    }
    assert.equal(store.listEvents('uvu').events.length, 0);
    await store.appendEvent(event('sillytavern', 'valid-floor', {kind: 'scene_transcript', payload}), 'sillytavern');
    assert.equal(store.listEvents('uvu').events.length, 1);
});

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

test('large online message parts are retained until complete and then reassembled once', () => {
    const pending = {};
    assert.equal(bridgeText.addMessagePart(pending, 'archive:message-1', { messagePart: 2, messagePartCount: 2, text: '后半段' }), null);
    assert.equal(bridgeText.addMessagePart(pending, 'archive:message-1', { messagePart: 2, messagePartCount: 2, text: '后半段' }), null);
    const complete = bridgeText.addMessagePart(pending, 'archive:message-1', { messagePart: 1, messagePartCount: 2, text: '前半段' });
    assert.equal(complete.text, '前半段后半段');
    assert.equal(Object.hasOwn(pending, 'archive:message-1'), false);
    bridgeText.addMessagePart(pending, 'bad', { messagePart: 1, messagePartCount: 2, text: 'a' });
    assert.throws(() => bridgeText.addMessagePart(pending, 'bad', { messagePart: 2, messagePartCount: 3, text: 'b' }), /分段总数/);
});

test('source spoofing, invalid modes, and oversized event bodies are rejected', async () => {
    const store = createBridgeStore();
    await assert.rejects(store.appendEvent(event('sillytavern', 'evt-2'), 'uvu'), /source/);
    await assert.rejects(store.appendEvent(event('uvu', 'evt-3', { payload: { text: 'x'.repeat(50 * 1024) } }), 'uvu'), /48 KiB/);
    await assert.rejects(store.setMode({ characterKey: 'char-a', mode: 'unknown' }), /Invalid mode/);
});

test('scene events validate their part contract and stable retries reject changed content', async () => {
    const store = createBridgeStore();
    const invalid = event('sillytavern', 'scene-bad', { kind: 'scene_transcript', sceneId: 'scene-a', payload: { part: 3, partCount: 2, text: 'bad' } });
    await assert.rejects(store.appendEvent(invalid, 'sillytavern'), /Invalid scene parts/);
    const valid = event('sillytavern', 'scene-good', { kind: 'scene_transcript', sceneId: 'scene-a', payload: { part: 1, partCount: 1, text: 'story' } });
    assert.equal((await store.appendEvent(valid, 'sillytavern')).duplicate, false);
    assert.equal((await store.appendEvent(valid, 'sillytavern')).duplicate, true);
    await assert.rejects(store.appendEvent({ ...valid, payload: { part: 1, partCount: 1, text: 'changed' } }, 'sillytavern'), /conflicts/);
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
    t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
    const filePath = path.join(directory, 'data.json');
    const first = createBridgeStore({ filePath });
    await first.load();
    await first.appendEvent(event('sillytavern', 'scene-1', { kind: 'scene_transcript', sceneId: 'scene-1', payload: { part: 1, partCount: 1, text: 'offline scene' } }), 'sillytavern');
    await first.acknowledge('uvu', 1);
    await first.setMode({ characterKey: 'char-a', mode: 'offline', sceneId: 'scene-1' });

    const restored = createBridgeStore({ filePath });
    await restored.load();
    assert.equal(restored.listEvents('uvu', 0).events[0].eventId, 'scene-1');
    assert.equal(restored.getMode('char-a').sceneId, 'scene-1');
});

test('UvU character directory is validated, persisted, and returned without extra fields', async () => {
    const store = createBridgeStore();
    assert.deepEqual(await store.setCharacters([{ id: 'char-1', name: '小明' }]), [{ id: 'char-1', name: '小明' }]);
    assert.deepEqual(store.listCharacters(), [{ id: 'char-1', name: '小明' }]);
    await assert.rejects(store.setCharacters([{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }]), /directory entry/);
    await assert.rejects(store.setCharacters([{ id: '', name: 'No ID' }]), /directory entry/);
});

test('failed persistence rolls back the in-memory event so retry is not mistaken for success', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'uvu-bridge-fail-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
    const blockedParent = path.join(directory, 'not-a-directory');
    await fs.writeFile(blockedParent, 'occupied');
    const store = createBridgeStore({ filePath: path.join(blockedParent, 'state.json') });
    await assert.rejects(store.appendEvent(event('uvu', 'retry-me'), 'uvu'));
    assert.equal(store.listEvents('sillytavern', 0).events.length, 0);
});


test('repeated enabling preserves active scene and relay epoch survives restart', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uvu-epoch-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
    const filePath = path.join(dir, 'state.json'), store = createBridgeStore({filePath});
    await store.setMode({characterKey:'a',mode:'offline',sceneId:'scene'});
    await store.setEnabled(true);
    assert.equal(store.getMode('a').mode,'offline');
    assert.ok(store.getService().relayId);
    const restored=createBridgeStore({filePath}); await restored.load();
    assert.equal(restored.getService().relayId,store.getService().relayId);
    assert.equal(store.listEvents('uvu').relayId,store.getService().relayId);
});

test('malformed nested message records are rejected without poisoning queue',async()=>{
    const store=createBridgeStore();
    for(const messages of [[null],[{id:'a',text:7}],[{id:'a',text:'x',messagePart:3,messagePartCount:2}]])
        await assert.rejects(store.appendEvent(event('uvu','bad',{payload:{messages}}),'uvu'),/message/i);
    assert.equal(store.listEvents('sillytavern').events.length,0);
});

test('readers cannot observe a draft before its disk write commits',async t=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'uvu-atomic-'));
    t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
    const store=createBridgeStore({filePath:path.join(dir,'s.json')});
    const original=fs.writeFile; let release,started;
    const ready=new Promise(r=>started=r);
    fs.writeFile=async(...args)=>{started();await new Promise(r=>release=r);return original(...args);};
    try {
        const pending=store.appendEvent(event('uvu','private-draft'),'uvu');
        await ready; const visible=store.listEvents('sillytavern').events.length;
        release(); await pending; assert.equal(visible,0);
        assert.equal(store.listEvents('sillytavern').events.length,1);
    } finally {fs.writeFile=original;}
});

test('extension state is isolated by Tavern account and revision checked',async()=>{
    const store=createBridgeStore();
    assert.equal(store.getUiState('alice').revision,0);
    await store.putUiState('alice',{revision:0,settings:{scene:{id:'a'}}});
    assert.equal(store.getUiState('bob').settings,null);
    await assert.rejects(store.putUiState('alice',{revision:0,settings:{}}),/changed/i);
    assert.equal(store.getUiState('alice').settings.scene.id,'a');
});


test('account review storage survives restart and failed writes retain the last confirmed revision',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'uvu-ui-state-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
 const filePath=path.join(dir,'state.json'),store=createBridgeStore({filePath});
 await store.putUiState('alice',{revision:0,settings:{scene:{id:'a'},deleted:['archive:m']}});
 const restored=createBridgeStore({filePath});await restored.load();
 assert.equal(restored.getUiState('alice').revision,1);
 assert.deepEqual(restored.getUiState('alice').settings.deleted,['archive:m']);
 assert.equal(restored.getUiState('bob').settings,null);
 const blocked=path.join(dir,'blocked');await fs.writeFile(blocked,'occupied');
 const broken=createBridgeStore({filePath:path.join(blocked,'state.json')});
 await assert.rejects(broken.putUiState('alice',{revision:0,settings:{scene:{id:'uncommitted'}}}));
 assert.equal(broken.getUiState('alice').revision,0);
 assert.equal(broken.getUiState('alice').settings,null);
});

test('relay queue diagnostics report capacity without secrets or story data',async()=>{
 const store=createBridgeStore({maxEvents:100});await store.appendEvent(event('uvu','diagnostic',{payload:{text:'SECRET STORY'}}),'uvu');
 const snapshot=store.getService();assert.deepEqual(snapshot.capacity,{limit:100,used:1,remaining:99});assert.equal(store.listEvents('sillytavern').capacity.remaining,99);
 assert.doesNotMatch(JSON.stringify(snapshot),/SECRET STORY|tokenHash|pairing/);
});
