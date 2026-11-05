const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { createBridgeStore } = require('../server/store.js');
function fixture(fetchImpl) {
    const prompts = new Map([['another-extension', 'UNCHANGED']]);
    const context = { extensionSettings: {}, characters: [{ avatar: 'card.png', name: 'A' }], characterId: 0, chatId: 'chat-a',
        setExtensionPrompt: (key, value) => prompts.set(key, value), saveSettingsDebounced: async () => {} };
    const sandbox = vm.createContext({ getContext: () => context, extension_prompt_types: { IN_PROMPT: 0 },
        document: { readyState: 'loading', visibilityState: 'visible', addEventListener() {} }, console, structuredClone, AbortController, AbortSignal,
        setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ token: 'csrf', enabled: true }) })) });
    const source = fs.readFileSync(require.resolve('../index.js'), 'utf8').split('\n').filter(line => !line.startsWith('import ')).join('\n');
    vm.runInContext(source + '\ncontext=getContext(); globalThis.api={settings,updatePrompt,memoryPrompt,pollEvents,applyEnabled,invalidateRequests,request};', sandbox);
    const settings = sandbox.api.settings();
    Object.assign(settings, { bridgeEnabled: true, injectMemory: true, characterLinks: { 'character:card.png': 'uvu-a' },
        cursorByCharacter: {}, packetsByCharacter: { 'uvu-a': { mode: 'offline', sceneId: 'scene-a', sourceArchiveId: 'archive-a', items: [
            { eventId: 'one', archiveId: 'archive-a', selected: true, text: 'SAVED_MEMORY' },
            { eventId: 'two', archiveId: 'archive-b', selected: true, text: 'OTHER_ARCHIVE' } ] } },
        scene: { id: 'scene-a', stCharacterKey: 'character:card.png', characterKey: 'uvu-a', chatId: 'chat-a', uvuArchiveId: 'archive-a' } });
    return { api: sandbox.api, context, settings, prompts };
}
test('only this extension prompt is written and only for the exact scene/chat/archive', () => {
    const f = fixture();
    f.api.updatePrompt(); assert.match(f.prompts.get('uvu-story-bridge-continuity'), /SAVED_MEMORY/);
    assert.doesNotMatch(f.prompts.get('uvu-story-bridge-continuity'), /OTHER_ARCHIVE/);
    f.context.chatId = 'another-chat-same-card'; f.api.updatePrompt(); assert.equal(f.prompts.get('uvu-story-bridge-continuity'), '');
    f.context.chatId = 'chat-a'; f.settings.scene.uvuArchiveId = 'archive-b'; f.api.updatePrompt(); assert.equal(f.prompts.get('uvu-story-bridge-continuity'), '');
    assert.equal(f.prompts.get('another-extension'), 'UNCHANGED');
});
test('master switch immediately clears prompt and preserves suspended scene without automatic resumption', async () => {
    const f = fixture(); f.api.updatePrompt();
    await f.api.applyEnabled(false);
    assert.equal(f.prompts.get('uvu-story-bridge-continuity'), ''); assert.equal(f.settings.scene.suspended, true);
    await f.api.applyEnabled(true); f.api.updatePrompt();
    assert.equal(f.prompts.get('uvu-story-bridge-continuity'), '');
    assert.equal(f.prompts.get('another-extension'), 'UNCHANGED');
});
test('switch away and back during fetch invalidates old events without advancing cursor', async () => {
    let resolve; const pending = new Promise(r => resolve = r);
    const f = fixture(async () => pending);
    const running = f.api.pollEvents();
    f.context.chatId = 'chat-b'; f.api.invalidateRequests(); f.context.chatId = 'chat-a';
    resolve({ ok: true, json: async () => ({ events: [{ seq: 1, characterKey: 'uvu-a', payload: { text: 'STALE' } }] }) });
    await running; assert.equal(f.settings.cursorByCharacter['uvu-a'], undefined);
    assert.equal(f.settings.packetsByCharacter['uvu-a'].items.length, 2);
});
test('service disable never reactivates offline mode on enable', async () => {
    const store = createBridgeStore();
    await store.setMode({ characterKey: 'a', mode: 'offline', sceneId: 's', archiveId: 'archive' });
    assert.equal(store.getMode('a').archiveId, 'archive');
    await store.setEnabled(false); assert.equal(store.getMode('a').mode, 'online');
    await assert.rejects(store.setMode({ characterKey: 'a', mode: 'offline' }), /disabled/);
    await store.setEnabled(true); assert.equal(store.getMode('a').mode, 'online');
});
