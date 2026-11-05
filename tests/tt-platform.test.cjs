'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function platform(host) {
    const sandbox = vm.createContext({ __TAURITAVERN__: host, structuredClone, TextEncoder, URL });
    vm.runInContext(fs.readFileSync(require.resolve('../platform.js'), 'utf8'), sandbox);
    return sandbox.UvUBridgePlatform;
}
function hostFixture() {
    const calls = [], values = new Map();
    let ref = { kind: 'character', characterId: 'a', fileName: 'chat-a' };
    const messages = Array.from({length: 235}, (_, i) => ({mes: String(i)}));
    const makePage = (end, limit) => ({startIndex: Math.max(0, end - limit), messages: messages.slice(Math.max(0, end-limit), end), hasMoreBefore: end > limit});
    const host = {abiVersion: 2, iosPolicy: {capabilities: {extensions: {third_party_execution: true}, scripting: {prompt_injections: false}}}, api: {
        chat: {current: {ref: () => ref}, open: pinned => {calls.push(structuredClone(pinned)); return {history: {
            tail: async ({limit}) => makePage(messages.length, limit),
            before: async (page, {limit}) => makePage(page.startIndex, limit),
        }};}},
        extension: {store: {tryGetJson: async ({key}) => ({found: values.has(key), value: values.get(key)}),
            setJson: async ({key,value}) => {values.set(key, structuredClone(value));}}},
    }};
    return {host, calls, messages, values, switchChat: () => {ref = {kind:'character',characterId:'b',fileName:'chat-b'};}};
}
test('TT capability detection uses ABI and effective capability snapshot', () => {
    const f = hostFixture(), p = platform(f.host);
    assert.equal(p.inspect().kind, 'tt'); assert.equal(p.inspect().canInject, false);
    f.host.iosPolicy.capabilities.extensions.third_party_execution = false;
    assert.throws(() => p.assertSupported(), /third.party|扩展/);
    f.host.abiVersion = 1; assert.throws(() => p.assertSupported(), /ABI/);
    assert.equal(platform(undefined).inspect().kind, 'st');
});
test('TT pins a real ChatRef and pages every null history slot in absolute order', async () => {
    const f = hostFixture(), p = platform(f.host), pinned = p.currentRef();
    const actual = await p.readHistory({chat:[null,...f.messages.slice(1)]}, pinned);
    assert.equal(actual.length,235); assert.equal(actual[0].mes,'0'); assert.equal(actual[234].mes,'234');
    assert.equal(f.calls.length,1); assert.equal(f.calls[0].fileName,'chat-a');
    f.switchChat(); await assert.rejects(p.readHistory({chat:[null]},pinned), /聊天|changed/);
});
test('TT rejects sparse, overlapping or incomplete history pages instead of exporting a subset', async () => {
    const f = hostFixture(), p = platform(f.host);
    f.host.api.chat.open = () => ({history:{tail:async()=>({startIndex:3,messages:[{mes:'last'}],hasMoreBefore:false})}});
    await assert.rejects(p.readHistory({chat:[null]},p.currentRef()), /完整|page|分页/);
});
test('TT own settings save waits for native disk write and verifies readback', async () => {
    const f = hostFixture(), p = platform(f.host);
    await p.saveState({scene:{id:'one'}}); assert.equal((await p.loadState()).scene.id,'one');
    f.host.api.extension.store.setJson = async () => {};
    await assert.rejects(p.saveState({scene:{id:'two'}}), /确认|confirm/);
});
test('TT stops a paginated read on a mid-flight chat switch or unsaved live text', async () => {
    const f=hostFixture(),p=platform(f.host),original=f.host.api.chat.open;
    f.host.api.chat.open=ref=>{const handle=original(ref),tail=handle.history.tail;handle.history.tail=async options=>{const result=await tail(options);f.switchChat();return result;};return handle;};
    await assert.rejects(p.readHistory({chat:f.messages},p.currentRef()), /聊天|changed/);
    const second=hostFixture(),other=platform(second.host),live=second.messages.slice();live[0]={mes:'not saved'};
    await assert.rejects(other.readHistory({chat:live},other.currentRef()), /保存/);
});
test('remote endpoint accepts HTTPS or explicit loopback development only', () => {
    const p = platform(undefined);
    assert.equal(p.normalizeEndpoint('https://relay.example/'), 'https://relay.example');
    assert.equal(p.normalizeEndpoint('http://127.0.0.1:8766'), 'http://127.0.0.1:8766');
    for (const url of ['http://192.168.1.2','https://u:p@relay.example','https://relay.example/?token=x','https://relay.example/#x'])
        assert.throws(() => p.normalizeEndpoint(url));
});
