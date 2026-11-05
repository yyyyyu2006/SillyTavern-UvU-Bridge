'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createBridgeStore } = require('../server/store.js');
const { createClientHttpServer } = require('../server/client-http.js');

async function startServer(t, allowedOrigins = ['https://uvu.example']) {
    const store = createBridgeStore();
    const config = { allowedOrigins, maxPayloadBytes: 65536 };
    const server = createClientHttpServer({ store, loadConfig: async () => config });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    return { store, baseUrl: `http://127.0.0.1:${server.address().port}/api/plugins/uvu-story-bridge` };
}

test('loopback client API handles preflight and pairing without disabling Tavern CSRF', async t => {
    const { store, baseUrl } = await startServer(t);
    const origin = 'https://uvu.example';
    const preflight = await fetch(`${baseUrl}/v1/client/pair`, {
        method: 'OPTIONS',
        headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
        },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
    assert.match(preflight.headers.get('access-control-allow-headers'), /Content-Type/i);

    const unpaired = await fetch(`${baseUrl}/v1/client/state`, { headers: { Origin: origin } });
    assert.equal(unpaired.status, 401);
    assert.equal((await unpaired.json()).error, 'This device is not paired.');

    const pair = store.createPairCode();
    const paired = await fetch(`${baseUrl}/v1/client/pair`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pair.code }),
    });
    assert.equal(paired.status, 200);
    const { token } = await paired.json();
    assert.equal(store.isAuthorized(token), true);

    const mode = await fetch(`${baseUrl}/v1/client/state`, {
        method: 'PUT',
        headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterKey: 'char-1', mode: 'offline' }),
    });
    assert.equal(mode.status, 200);
    assert.equal((await mode.json()).mode, 'offline');
    await store.setEnabled(false);
    const service = await fetch(`${baseUrl}/v1/client/service`, { headers: { Origin: origin, Authorization: `Bearer ${token}` } });
    const info = await service.json();
    assert.equal(info.enabled, false); assert.equal(info.version, require('../manifest.json').version); assert.equal(info.protocolVersion, 1);
    const disabledMode = await fetch(`${baseUrl}/v1/client/state?characterKey=char-1`, { headers: { Origin: origin, Authorization: `Bearer ${token}` } });
    assert.equal((await disabledMode.json()).mode, 'online');
    const inbox = await fetch(`${baseUrl}/v1/client/inbox`, { headers: { Origin: origin, Authorization: `Bearer ${token}` } });
    assert.deepEqual((await inbox.json()).characters, []);
});

test('loopback client API rejects origins outside the plugin allowlist', async t => {
    const { baseUrl } = await startServer(t);
    const response = await fetch(`${baseUrl}/v1/client/state`, { headers: { Origin: 'https://attacker.example' } });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /origin is not allowed/);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('permanent pairing works on client listener and disconnect revokes only this bearer',async t=>{
 const {store,baseUrl}=await startServer(t),origin='https://uvu.example';
 assert.equal(typeof store.createPermanentPairCode,'function');
 const {code}=await store.createPermanentPairCode();
 async function pair(name){const r=await fetch(baseUrl+'/v1/client/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({code,device:{name}})});assert.equal(r.status,200);return r.json();}
 const a=await pair('Phone A'),b=await pair('Phone B');
 assert.equal(a.device.name,'Phone A');assert.equal(a.device.id===b.device.id,false);
 const headers={Origin:origin,Authorization:'Bearer '+a.token};
 const session=await fetch(baseUrl+'/v1/client/session',{headers});assert.equal(session.status,200);assert.equal((await session.json()).device.name,'Phone A');
 const originalSession=store.getSession;store.getSession=async()=>{throw new Error('disk full');};
 assert.equal((await fetch(baseUrl+'/v1/client/session',{headers})).status,503);
 assert.equal(store.isAuthorized(a.token),true);store.getSession=originalSession;
 const originalClaim=store.claimPair;store.claimPair=async()=>{throw new Error('disk full');};
 for(let i=0;i<9;i++)assert.equal((await fetch(baseUrl+'/v1/client/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({code})})).status,503);
 store.claimPair=originalClaim;
 const revoke=await fetch(baseUrl+'/v1/client/revoke',{method:'POST',headers});assert.equal(revoke.status,200);
 assert.equal(store.isAuthorized(a.token),false);assert.equal(store.isAuthorized(b.token),true);
 const sessionAgain=await fetch(baseUrl+'/v1/client/session',{headers});assert.equal(sessionAgain.status,401);
 const hidden=await fetch(baseUrl+'/v1/ui/pairing',{headers:{Origin:origin,Authorization:'Bearer '+b.token}});assert.equal(hidden.status,404);
});
