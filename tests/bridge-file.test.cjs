'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const sandbox=vm.createContext({crypto:webcrypto,TextEncoder,structuredClone});
vm.runInContext(fs.readFileSync(require.resolve('../bridge-file.js'),'utf8'),sandbox);
const api=sandbox.UvUBridgeFile;
const floor={id:'f',number:1,role:'assistant',speaker:'A',createdAt:0,extraction:'plain',bodyTag:'',part:1,partCount:1};
async function scene(){return {format:'uvu-bridge-file',version:1,direction:'to-uvu',characterKey:'c',archiveId:'a',events:[{source:'sillytavern',eventId:'s:1',sceneId:'s',kind:'scene_transcript',characterKey:'c',payload:{uvuArchiveId:'a',sceneFormat:'floors-v1',floor,text:'hello',part:1,partCount:1,partHash:await api.hash('hello')}}]};}
test('offline scene file roundtrip preserves floor identities and checksum',async()=>{
 const original=await scene(),file=await api.validate(JSON.stringify(original),{direction:'to-uvu',characterKey:'c',archiveId:'a'});
 assert.equal(file.events[0].payload.floor.number,1);assert.equal(file.events[0].payload.text,'hello');
});
test('offline file rejects wrong wrapper/event target, invalid floors, checksum and missing parts',async()=>{
 const file=await scene(),expected={direction:'to-uvu',characterKey:'c',archiveId:'a'};
 for(const mutate of [f=>{f.characterKey='other';},f=>{f.events[0].characterKey='other';},f=>{f.events[0].payload.uvuArchiveId='other';},f=>{f.events[0].payload.floor.number=0;},f=>{f.events[0].payload.text='tampered';},f=>{f.events[0].payload.partCount=2;}]){
  const bad=structuredClone(file);mutate(bad);await assert.rejects(api.validate(JSON.stringify(bad),expected));
 }
});
test('offline memory file is bounded and cannot disguise another source or executable envelope',async()=>{
 const file={format:'uvu-bridge-file',version:1,direction:'to-tavern',characterKey:'c',archiveId:'a',events:[{source:'uvu',eventId:'m',kind:'memory_packet',characterKey:'c',payload:{archiveId:'a',messages:[{id:'m',text:'hello'}]}}]};
 assert.equal((await api.validate(JSON.stringify(file),{direction:'to-tavern',characterKey:'c',archiveId:'a'})).events.length,1);
 const bad=structuredClone(file);bad.events[0].source='sillytavern';await assert.rejects(api.validate(JSON.stringify(bad),{direction:'to-tavern',characterKey:'c',archiveId:'a'}));
 file.events=Array(2001).fill(file.events[0]);await assert.rejects(api.validate(JSON.stringify(file),{direction:'to-tavern',characterKey:'c',archiveId:'a'}));
});
