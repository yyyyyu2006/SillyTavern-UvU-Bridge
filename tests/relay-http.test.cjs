'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {once} = require('node:events');
const {createBridgeStore} = require('../server/store.js');
const {createRelayHttpServer, validateRelayConfig} = require('../server/relay-http.js');

const config = {publicUrl:'https://relay.example',adminSecret:'a'.repeat(48),clientOrigins:['https://uvu.example'],uiOrigins:['tauri://localhost'],requestsPerMinute:120,maxPayloadBytes:65536};
async function start(t, store, overrides={}) {
    const server = createRelayHttpServer({store,config:{...config,...overrides}});
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const base = 'http://127.0.0.1:'+server.address().port+'/v1';
    const call = (route,body,token=config.adminSecret,origin='tauri://localhost',method=body===undefined?'GET':'POST') => fetch(base+route,{method,headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {server,base,call};
}
test('relay requires private exact origins, HTTPS public URL and separate strong admin credential',()=>{
    assert.doesNotThrow(()=>validateRelayConfig(config));
    for(const bad of [{adminSecret:'short'},{publicUrl:'http://relay.example'},{uiOrigins:['*']},{clientOrigins:[]}])
        assert.throws(()=>validateRelayConfig({...config,...bad}));
});
test('relay can explicitly allow the Tauri Windows application origin without allowing arbitrary HTTP websites',()=>{
 assert.doesNotThrow(()=>validateRelayConfig({...config,uiOrigins:['http://tauri.localhost']}));
 assert.throws(()=>validateRelayConfig({...config,uiOrigins:['http://example.com']}));
});
test('actual relay rejects origin and auth crossing; pairs device then replays durable events after restart',async t=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'uvu-tt-relay-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
    const filePath=path.join(dir,'state.json');let store=createBridgeStore({filePath});await store.load();
    const a=await start(t,store);
    assert.equal((await a.call('/ui/pairing',undefined,'','tauri://localhost')).status,401);
    assert.equal((await a.call('/ui/pairing',undefined,config.adminSecret,'https://uvu.example')).status,403);
    assert.equal((await a.call('/ui/pairing',undefined,config.adminSecret,'null')).status,403);
    assert.equal((await a.call('/ui/pair-code',undefined,config.adminSecret)).status,200);
    const pair=await (await a.call('/ui/permanent-code',{})).json();
    const device=await (await a.call('/client/pair',{code:pair.code},'','https://uvu.example')).json();
    assert.ok(device.token);
    assert.equal((await a.call('/ui/pairing',undefined,device.token)).status,401);
    assert.equal((await a.call('/client/service',undefined,config.adminSecret,'https://uvu.example')).status,401);
    const event={source:'sillytavern',eventId:'one',kind:'scene_transcript',characterKey:'c',sceneId:'s',payload:{text:'hello',part:1,partCount:1}};
    assert.equal((await a.call('/ui/events',event)).status,200);
    await new Promise(resolve=>a.server.close(resolve));
    store=createBridgeStore({filePath});await store.load();const b=await start(t,store);
    const result=await (await b.call('/client/events?characterKey=c',undefined,device.token,'https://uvu.example')).json();
    assert.equal(result.events.length,1);assert.equal(result.events[0].payload.text,'hello');
    const repeated=await (await b.call('/ui/events',event)).json();assert.equal(repeated.duplicate,true);
    const changed={...event,payload:{...event.payload,text:'changed'}};
    assert.equal((await b.call('/ui/events',changed)).status,400);
});
test('relay bounds requests and payloads and rejects malformed JSON',async t=>{
    const a=await start(t,createBridgeStore(),{requestsPerMinute:4,maxPayloadBytes:1024});
    assert.equal((await a.call('/ui/events',{data:'x'.repeat(2048)})).status,413);
    const malformed=await fetch(a.base+'/ui/events',{method:'POST',headers:{Origin:'tauri://localhost',Authorization:'Bearer '+config.adminSecret,'Content-Type':'application/json'},body:'{'});
    assert.equal(malformed.status,400);
    await a.call('/ui/pairing');await a.call('/ui/pairing');
    assert.equal((await a.call('/ui/pairing')).status,429);
});
test('relay reports storage failure without acknowledging a new event or exposing local paths',async t=>{
 const store=createBridgeStore(),a=await start(t,store);
 const append=store.appendEvent;store.appendEvent=async()=>{throw Object.assign(Error('ENOSPC private/path'),{code:'ENOSPC'});};
 const event={source:'sillytavern',eventId:'retry',kind:'scene_transcript',characterKey:'c',sceneId:'s',payload:{text:'retry',part:1,partCount:1}};
 const failed=await a.call('/ui/events',event);assert.equal(failed.status,503);assert.doesNotMatch((await failed.json()).error,/private\/path/);
 assert.equal(store.listEvents('uvu').events.length,0);store.appendEvent=append;
 assert.equal((await a.call('/ui/events',event)).status,200);assert.equal(store.listEvents('uvu').events.length,1);
});
