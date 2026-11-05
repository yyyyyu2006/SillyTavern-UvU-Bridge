'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createBridgeStore} = require('../server/store.js');
const plugin = require('../server/index.js');

test('confirmed UI storage uses authenticated account and rejects cross-origin access and stale revisions', async t => {
    const memory = createBridgeStore(), original = {};
    for (const name of ['getUiState', 'putUiState']) {
        original[name] = plugin._test.store[name];
        plugin._test.store[name] = memory[name];
    }
    t.after(() => Object.assign(plugin._test.store, original));
    const routes = new Map(), router = {use() {}};
    for (const method of ['get', 'put', 'post']) router[method] = (path, ...handlers) => routes.set(method + path, handlers);
    plugin._test.attachRoutes(router);
    async function invoke(method, {user = 'alice', origin = 'http://localhost:8000', ip = '127.0.0.1', body} = {}) {
        const req = {ip, body, user: user ? {profile: {handle: user}} : null,
            get: name => ({origin, host: 'localhost:8000'})[name]};
        const res = {code: 200, status(value) {this.code = value; return this;}, json(value) {this.body = value; return this;}};
        const handlers = routes.get(method + '/v1/ui/extension-state');
        const run = index => handlers[index]?.(req, res, () => run(index + 1));
        await run(0); return res;
    }
    assert.equal((await invoke('get', {user: ''})).code, 401);
    assert.equal((await invoke('get', {origin: 'https://uvu.example'})).code, 403);
    assert.equal((await invoke('get', {ip: '192.168.1.2'})).code, 403);
    const saved = await invoke('put', {body: {userKey: 'bob', revision: 0, settings: {scene: {id: 'scene-a'}}}});
    assert.equal(saved.code, 200); assert.equal(saved.body.revision, 1);
    assert.equal(memory.getUiState('alice').settings.scene.id, 'scene-a');
    assert.equal(memory.getUiState('bob').settings, null);
    assert.equal((await invoke('put', {body: {revision: 0, settings: {}}})).code, 409);
});
