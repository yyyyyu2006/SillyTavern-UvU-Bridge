'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

class MemoryStorage {
    values = new Map();
    getItem(key) { return this.values.get(key) || null; }
    setItem(key, value) { this.values.set(key, value); }
    removeItem(key) { this.values.delete(key); }
}

test('UvU client pairs, stores the token, and sends it only in the authorization header', async () => {
    const { UvUStoryBridgeClient } = await import('../client/uvu-bridge-client.js');
    const storage = new MemoryStorage();
    const calls = [];
    const client = new UvUStoryBridgeClient({ baseUrl: 'http://127.0.0.1:8000/api/plugins/uvu-story-bridge', storage,
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return { ok: true, status: 200, json: async () => ({ token: 'opaque-token', events: [] }) };
        } });
    await client.pair('123456');
    assert.equal(JSON.parse(storage.getItem('uvu-story-bridge.v1')).token, 'opaque-token');
    await client.publish({ source: 'uvu', eventId: 'turn-1', kind: 'memory_packet', characterKey: 'char-1', payload: { text: 'scene fact' } });
    assert.equal(calls[0].url, 'http://127.0.0.1:8000/api/plugins/uvu-story-bridge/v1/client/pair');
    assert.equal(calls[0].options.headers.Authorization, undefined);
    assert.equal(calls[1].options.headers.Authorization, 'Bearer opaque-token');
    assert.equal(calls[1].url.includes('opaque-token'), false);
});

test('disconnect clears local credentials only after the server confirms revocation', async () => {
    const { UvUStoryBridgeClient } = await import('../client/uvu-bridge-client.js');
    const storage = new MemoryStorage();
    storage.setItem('uvu-story-bridge.v1', JSON.stringify({ token: 'still-valid' }));
    const client = new UvUStoryBridgeClient({ baseUrl: 'http://127.0.0.1:8000/api/plugins/uvu-story-bridge', storage,
        fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: 'offline' }) }) });
    await assert.rejects(client.disconnect(), /offline/);
    assert.equal(JSON.parse(storage.getItem('uvu-story-bridge.v1')).token, 'still-valid');
});
