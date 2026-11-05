'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const values=new Map(),requests=[],prompts=new Map();let ref={kind:'character',characterId:'0',fileName:'chat'};
 const messages=[{mes:'before',name:'A'},{mes:'new',name:'A'}];
 const context={extensionSettings:{},characters:[{avatar:'a.png',name:'A'}],characterId:0,chatId:'chat',chat:[null,messages[1]],name1:'U',name2:'A',setExtensionPrompt:(k,v)=>prompts.set(k,v),saveSettingsDebounced(){}};
 const host={abiVersion:2,api:{extension:{store:{setJson:async({key,value})=>values.set(key,structuredClone(value)),tryGetJson:async({key})=>({found:values.has(key),value:values.get(key)})}},chat:{current:{ref:()=>ref},open:()=>({history:{tail:async()=>({startIndex:0,messages,hasMoreBefore:false}),before:async()=>{throw Error('not expected');}}})}}};
 const sandbox=vm.createContext({__TAURITAVERN__:host,getContext:()=>context,extension_prompt_types:{IN_PROMPT:0},document:{readyState:'loading',visibilityState:'visible',addEventListener(){}},structuredClone,crypto:require('node:crypto').webcrypto,TextEncoder,URL,URLSearchParams,AbortController,AbortSignal,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},console,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({enabled:true,relayId:'r',events:[],characters:[]})};}});
 for(const name of ['story-text.js','platform.js','bridge-file.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+name),'utf8'),sandbox);
 const source=fs.readFileSync(require.resolve('../index.js'),'utf8').split('\n').filter(l=>!l.startsWith('import ')).join('\n');
 vm.runInContext(source+'\ncontext=getContext();durableReady=true;globalThis.api={settings,request,renderTransportUI,pollEvents,setStorageControls,readFileTarget: typeof readFileTarget === "function" ? readFileTarget : undefined,persistSettings,restoreSettings,sceneMessages,sceneFloorParts,startScene,endScene,importBridgeFile,exportBridgeFile,getConnection:()=>ttConnection,setConnection:v=>{ttConnection=v;},setPanel:v=>{panel=v;}};',sandbox);
 Object.assign(sandbox.api.settings(),{characterLinks:{'character:a.png':'c'},uvuCharacters:[{id:'c',name:'C'}],packetsByCharacter:{c:{items:[],sourceArchiveId:'a',mode:'online'}}});
 return {api:sandbox.api,context,host,values,requests,prompts,messages,switchChat:()=>{ref={kind:'character',characterId:'1',fileName:'another'};}};
}
test('TT request uses only configured HTTPS relay admin auth without Tavern CSRF',async()=>{
 const f=fixture();f.api.setConnection({mode:'https',endpoint:'https://relay.example',adminSecret:'s'.repeat(48)});
 await f.api.request('/ui/service');assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'https://relay.example/v1/ui/service');
 assert.equal(f.requests[0].options.headers.Authorization,'Bearer '+'s'.repeat(48));assert.equal(f.requests[0].options.credentials,'omit');
});
test('TT native save and restore work without any relay connection',async()=>{
 const f=fixture();await f.api.persistSettings();assert.equal(f.requests.length,0);assert.ok(f.values.get('settings'));
 f.api.settings().characterLinks={};await f.api.restoreSettings();assert.equal(f.api.settings().characterLinks['character:a.png'],'c');
});
test('TT scene start/end reads official history and preserves absolute floor numbers',async()=>{
 const f=fixture();await f.api.startScene();assert.equal(f.api.settings().scene.startIndex,2);
 const scene=f.api.settings().scene;assert.equal(scene.chatRef.fileName,'chat');
 f.messages.push({mes:'third',name:'A'});f.context.chat.push(f.messages[2]);
 await f.api.endScene();assert.equal(f.api.settings().scene,null);
 const out=f.api.settings().fileOutbox.find(e=>e.kind==='scene_transcript');assert.equal(out.payload.floor.number,3);assert.equal(out.payload.text,'third');
});
test('file import persists unreviewed memory and duplicate receipt without touching remote cursor',async()=>{
 const f=fixture();f.context.chat=f.messages.slice();f.api.settings().cursorByCharacter.c=41;
 const file=JSON.stringify({format:'uvu-bridge-file',version:1,direction:'to-tavern',characterKey:'c',archiveId:'a',events:[{source:'uvu',eventId:'m',kind:'memory_packet',characterKey:'c',payload:{archiveId:'a',messages:[{id:'msg',text:'file memory'}]}}]});
 await f.api.importBridgeFile(file,'c','a');const item=f.api.settings().packetsByCharacter.c.items[0];
 assert.equal(item.selected,false);assert.equal(item.reviewed,false);assert.equal(f.api.settings().cursorByCharacter.c,41);
 const repeated=await f.api.importBridgeFile(file,'c','a');assert.equal(repeated.duplicate,true);assert.equal(f.requests.length,0);
});
test('TT large file scene stages the complete frozen scene with bounded native writes',async()=>{
 const f=fixture();await f.api.startScene();let writes=0;
 const write=f.host.api.extension.store.setJson;
 f.host.api.extension.store.setJson=async value=>{writes++;await write(value);};
 f.messages.push({mes:'x'.repeat(100000),name:'A'});f.context.chat.push(f.messages[2]);
 await f.api.endScene();assert.ok(f.api.settings().fileOutbox.length>10);
 assert.ok(writes<=6,'native writes must not grow once per transport part, actual '+writes);
});
test('failed native file import rolls back both review copies and duplicate receipt',async()=>{
 const f=fixture(),before=JSON.stringify(f.api.settings());
 f.host.api.extension.store.setJson=async()=>{throw Error('disk full');};
 const file=JSON.stringify({format:'uvu-bridge-file',version:1,direction:'to-tavern',characterKey:'c',archiveId:'a',events:[{source:'uvu',eventId:'m',kind:'memory_packet',characterKey:'c',payload:{archiveId:'a',messages:[{id:'msg',text:'file memory'}]}}]});
 await assert.rejects(f.api.importBridgeFile(file,'c','a'),/disk full/);assert.equal(JSON.stringify(f.api.settings()),before);
});


test('TT rejects a static Pages site before sending relay credentials',async()=>{
 const f=fixture();f.api.setConnection({mode:'https',endpoint:'https://yyyyyu2006.github.io/UvU',adminSecret:'s'.repeat(48)});
 await assert.rejects(f.api.request('/ui/service'),/GitHub Pages|静态网页/);assert.equal(f.requests.length,0);
});
test('TT reads and validates packet target without importing, binding or approving',async()=>{
 const f=fixture();const before=JSON.stringify(f.api.settings());
 const text=JSON.stringify({format:'uvu-bridge-file',version:1,direction:'to-tavern',characterKey:'new-c',archiveId:'new-a',events:[{source:'uvu',eventId:'m',kind:'memory_packet',characterKey:'new-c',payload:{archiveId:'new-a',messages:[{id:'m',text:'text'}]}}]});
 const target=await f.api.readFileTarget(text);assert.equal(target.characterKey,'new-c');assert.equal(target.archiveId,'new-a');assert.equal(JSON.stringify(f.api.settings()),before);
 await assert.rejects(f.api.readFileTarget(text.replace('to-tavern','to-uvu')),/格式|方向|目标/);
});

test('unsaved TT transport choice pauses actions and polling until saved or reverted',async()=>{
 for(const saved of ['file','https']){
  const f=fixture(),nodes=new Map(),controls=[];
  const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{textContent:'',dataset:{},disabled:false,options:[{value:''}]});return nodes.get(selector);};
  for(const action of ['start-scene','import-file','export-file','pair','retry-storage','save-tt']){const n=node('[data-action="'+action+'"]');n.dataset.action=action;controls.push(n);}
  for(const field of ['mode','endpoint','secret']){const n=node('[data-tt-'+field+']');n.value=field==='mode'?saved:'';controls.push(n);}
  f.api.setPanel({querySelector:node,querySelectorAll:selector=>selector==='button, input, select, textarea'?controls:[]});
  const connection={mode:saved,endpoint:'https://relay.example',adminSecret:'s'.repeat(48)};f.api.setConnection(connection);
  const preview=saved==='file'?'https':'file';node('[data-tt-mode]').value=preview;f.api.renderTransportUI(preview);
  assert.match(node('[data-tt-pending]').textContent,/尚未保存/);assert.equal(node('[data-tt-pending]').hidden,false);
  assert.match(node('[data-tt-pending]').textContent,saved==='file'?/当前已保存：文件/:/当前已保存：HTTPS/);
  for(const action of ['start-scene','import-file','export-file','pair','retry-storage'])assert.equal(node('[data-action="'+action+'"]').disabled,true,action);
  assert.equal(node('[data-action="save-tt"]').disabled,false);assert.equal(f.api.getConnection().mode,saved);
  await f.api.pollEvents();assert.equal(f.requests.length,0);await assert.rejects(f.api.request('/ui/service'),/尚未保存/);
  f.api.setStorageControls(true);assert.equal(node('[data-action="start-scene"]').disabled,true);
  node('[data-tt-mode]').value=saved;f.api.renderTransportUI(saved);
  assert.equal(node('[data-tt-pending]').hidden,true);assert.equal(node('[data-action="start-scene"]').disabled,false);
  await f.api.request('/ui/service');assert.equal(f.requests.length,saved==='file'?0:1);
 }
});
