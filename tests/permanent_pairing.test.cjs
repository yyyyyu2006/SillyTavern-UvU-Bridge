'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const {createBridgeStore} = require('../server/store.js');

test('permanent code is reusable across restarts and rotation preserves existing devices', async t => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(),'uvu-permanent-'));
 t.after(() => fs.rm(dir,{recursive:true,force:true,maxRetries:3}));
 const filePath=path.join(dir,'state.json'), store=createBridgeStore({filePath});
 assert.equal(typeof store.createPermanentPairCode,'function');
 const pair=await store.createPermanentPairCode();
 assert.ok(pair.code.length>=32);assert.equal(pair.expiresAt,null);
 const a=await store.claimPair(pair.code,{name:'Chrome'}),b=await store.claimPair(pair.code,{name:'Edge'});
 assert.equal(store.isAuthorized(a),true);assert.equal(store.isAuthorized(b),true);
 const restored=createBridgeStore({filePath});await restored.load();
 assert.equal(restored.isAuthorized(a),true);
 const c=await restored.claimPair(pair.code,{name:'PWA'});
 assert.equal(restored.listDevices().length,3);
 const rotated=await restored.createPermanentPairCode();
 await assert.rejects(restored.claimPair(pair.code),/invalid|expired/i);
 assert.equal(restored.isAuthorized(c),true);
 assert.equal(restored.getPairing().mode,'permanent');
 assert.doesNotMatch(await fs.readFile(filePath,'utf8'),new RegExp(pair.code+'|'+rotated.code+'|'+a));
 const devices=restored.listDevices();
 assert.equal(devices.some(d=>Object.hasOwn(d,'tokenHash')),false);
 await restored.revokeDevice(devices.find(d=>d.name==='Edge').id);
 assert.equal(restored.isAuthorized(b),false);assert.equal(restored.isAuthorized(a),true);
 await restored.revokeToken(a);assert.equal(restored.isAuthorized(c),true);
 await restored.setPairingMode('temporary');
 await assert.rejects(restored.claimPair(rotated.code),/invalid|expired/i);
 assert.equal(restored.isAuthorized(c),true);
 await restored.setPairingMode('permanent');
 await restored.claimPair(rotated.code);
 await restored.revokeAllDevices();assert.equal(restored.hasPairedClient(),false);
 assert.equal(restored.getPairing().hasPermanent,true);
});

test('legacy token survives additional pairing and can be revoked separately',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'uvu-legacy-pair-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:3}));
 const filePath=path.join(dir,'s.json');
 await fs.writeFile(filePath,JSON.stringify({version:1,nextSeq:1,events:[],cursors:{},modes:{},tokenHash:crypto.createHash('sha256').update('legacy-token').digest('hex')}));
 const store=createBridgeStore({filePath});await store.load();
 const paired=await store.claimPair(store.createPairCode().code,{name:'new'});
 assert.equal(store.isAuthorized('legacy-token'),true);assert.equal(store.isAuthorized(paired),true);
 assert.equal(typeof store.listDevices,'function');
 await store.revokeDevice('legacy');assert.equal(store.isAuthorized('legacy-token'),false);
 assert.equal(store.isAuthorized(paired),true);
});

test('concurrent one-time claims issue only one device and failed disk save leaves code retryable',async t=>{
 const store=createBridgeStore(),pair=store.createPairCode();
 const results=await Promise.allSettled([store.claimPair(pair.code),store.claimPair(pair.code)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(typeof store.listDevices,'function');assert.equal(store.listDevices().length,1);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'uvu-pair-atomic-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:3}));
 const disk=createBridgeStore({filePath:path.join(dir,'s.json')}),code=disk.createPairCode().code;
 const original=fs.writeFile;fs.writeFile=async()=>{throw new Error('disk full');};
 try {await assert.rejects(disk.claimPair(code),/disk full/);assert.equal(disk.hasPairedClient(),false);}finally{fs.writeFile=original;}
 const token=await disk.claimPair(code);assert.equal(disk.isAuthorized(token),true);
});

test('device metadata is bounded, sessions touch last connection and enforce targeted revocation',async()=>{
 let now=1000;const store=createBridgeStore({now:()=>now});
 assert.equal(typeof store.createPermanentPairCode,'function');
 const code=(await store.createPermanentPairCode()).code;
 const token=await store.claimPair(code,{name:'x'.repeat(200)});
 const session=await store.getSession(token);assert.equal(session.device.name.length,80);
 assert.equal(Object.hasOwn(session.device,'tokenHash'),false);
 now+=61000;await store.getSession(token);assert.equal(store.listDevices()[0].lastSeenAt,now);
 await store.revokeToken('unrelated');assert.equal(store.isAuthorized(token),true);
 await store.revokeToken(token);await assert.rejects(store.getSession(token),/paired/i);
});

test('selected permanent mode rejects an outstanding temporary code',async()=>{
 const store=createBridgeStore(),temporary=store.createPairCode();
 const permanent=await store.createPermanentPairCode();
 await assert.rejects(store.claimPair(temporary.code),/invalid|expired/i);
 assert.equal(store.isAuthorized(await store.claimPair(permanent.code)),true);
 await store.setPairingMode('temporary');
 assert.equal(store.isAuthorized(await store.claimPair(temporary.code)),true);
});
