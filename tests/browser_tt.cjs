'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createServer}=require('node:http'),{once}=require('node:events');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const {createBridgeStore}=require('../server/store.js');
const {createRelayHttpServer}=require('../server/relay-http.js');
const root=path.resolve(__dirname,'..');

(async()=>{
 const ui=createServer((_req,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font:14px sans-serif;margin:12px;background:#1f2023;color:#eee}button,input,select,textarea{font:inherit}button{cursor:pointer}input,select,textarea{background:#313337;color:#eee;border:1px solid #777;padding:5px}</style><div id="extensions_settings"></div>'));
 ui.listen(0,'127.0.0.1');await once(ui,'listening');const origin='http://127.0.0.1:'+ui.address().port;
 const store=createBridgeStore();await store.setCharacters([{id:'c',name:'Test role'}]);
 const adminSecret='browser-test-only-'.repeat(4);
 const relay=createRelayHttpServer({store,config:{publicUrl:'https://relay.example',adminSecret,uiOrigins:[origin],clientOrigins:[origin],requestsPerMinute:500}});
 relay.listen(0,'127.0.0.1');await once(relay,'listening');const endpoint='http://127.0.0.1:'+relay.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:320,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(()=>{
  window.testMessages=[{mes:'Old message',name:'A'},{mes:'Boundary',name:'A'}];
  window.testContext={extensionSettings:{},characters:[{avatar:'a.png',name:'A'}],characterId:0,chatId:'chat-a',chat:[null,window.testMessages[1]],name1:'User',name2:'A',setExtensionPrompt(key,value){window.lastPrompt=value;},saveSettingsDebounced(){},eventSource:{on(){}},eventTypes:{CHAT_CHANGED:'changed'}};
  window.getContext=()=>window.testContext;window.extension_prompt_types={IN_PROMPT:0};
  const ref={kind:'character',characterId:'0',fileName:'chat-a'};
  window.__TAURITAVERN__={abiVersion:2,ready:Promise.resolve(),iosPolicy:{profile:'full',capabilities:{extensions:{third_party_execution:true},scripting:{prompt_injections:true}}},api:{
   extension:{store:{async setJson({key,value}){localStorage.setItem('tt-test:'+key,JSON.stringify(value));},async tryGetJson({key}){const raw=localStorage.getItem('tt-test:'+key);return raw ? {found:true,value:JSON.parse(raw)} : {found:false};}}},
   chat:{current:{ref:()=>ref},open(pinned){if(pinned.fileName!==ref.fileName)throw Error('wrong chat');return {history:{async tail(){return {startIndex:0,messages:structuredClone(window.testMessages),hasMoreBefore:false};},async before(){throw Error('unexpected before');}}};}},
  }};
 });
 async function initialize(){
  await page.goto(origin);await page.addStyleTag({content:fs.readFileSync(path.join(root,'style.css'),'utf8')});
  for(const name of ['story-text.js','platform.js','bridge-file.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,name),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'index.js'),'utf8').split('\n').filter(line=>!line.startsWith('import ')).join('\n')});
  await page.waitForFunction(()=>document.querySelector('[data-action="start-scene"]')?.disabled===false);
 }
 try{
  await initialize();assert.equal(await page.locator('[data-tt-config]').isVisible(),true);
  await page.locator('[data-file-character]').fill('c');await page.locator('[data-file-archive]').fill('a');
  const file={format:'uvu-bridge-file',version:1,direction:'to-tavern',characterKey:'c',archiveId:'a',events:[{source:'uvu',eventId:'m1',kind:'memory_packet',characterKey:'c',payload:{archiveId:'a',messages:[{id:'msg1',text:'Imported file source'}]}}]};
  await page.locator('[data-file-input]').setInputFiles({name:'handoff.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
  await page.getByRole('button',{name:'导入线上交接文件',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tt-test:settings')).packetsByCharacter.c.items.length===1);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tt-test:settings')).packetsByCharacter.c.items[0].reviewed),false);
  await page.getByText('UvU → 酒馆：线上记忆审核',{exact:true}).click();
  await page.getByRole('button',{name:'保存勾选与编辑',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tt-test:settings')).packetsByCharacter.c.items[0].reviewed);
  await page.locator('[data-inject-memory]').check();await page.getByRole('button',{name:'开始线下剧情',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tt-test:settings')).scene?.startIndex===2);
  assert.match(await page.evaluate(()=>window.lastPrompt),/Imported file source/);
  await page.evaluate(()=>{const message={mes:'<content>Third floor scene</content><status>excluded</status>',name:'A'};testMessages.push(message);testContext.chat.push(message);});
  await page.getByRole('button',{name:'结束并导出',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tt-test:settings')).scene===null);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'下载待交接剧情 JSON',exact:true}).click();
  const download=await downloadPromise,exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.equal(exported.events[0].payload.floor.number,3);assert.equal(exported.events[0].payload.text,'Third floor scene');
  await initialize();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tt-test:settings')).packetsByCharacter.c.items[0].reviewed),true);
  await page.locator('[data-tt-mode]').selectOption('https');await page.locator('[data-tt-endpoint]').fill(endpoint);await page.locator('[data-tt-secret]').fill(adminSecret);
  await page.getByRole('button',{name:'保存 TT 连接',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-bridge-status]').textContent.includes('HTTPS 连接已保存'));
  await page.getByText('永久配对与已绑定设备',{exact:true}).click();await page.getByRole('button',{name:'生成 / 重置永久码',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-permanent-code]').textContent.length===32);
  const code=await page.locator('[data-permanent-code]').innerText();
  const device=await page.evaluate(async({endpoint,code})=>{const r=await fetch(endpoint+'/v1/client/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,device:{name:'Browser UvU'}})});if(!r.ok)throw Error('pair '+r.status);return r.json();},{endpoint,code});
  assert.ok(device.token);assert.notEqual(device.token,adminSecret);
  await page.evaluate(async({endpoint,token})=>{const r=await fetch(endpoint+'/v1/client/events',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({source:'uvu',kind:'memory_packet',eventId:'relay-message',characterKey:'c',payload:{archiveId:'a',messages:[{id:'remote',text:'Real relay source'}]}})});if(!r.ok)throw Error('send '+r.status);},{endpoint,token:device.token});
  await page.getByText('UvU → 酒馆：线上记忆审核',{exact:true}).click();await page.getByRole('button',{name:'刷新线上存档',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tt-test:settings')).packetsByCharacter.c.items.some(item=>item.text==='Real relay source'));
  const artifactDir=path.resolve(root,'../uvu-verification-deps/artifacts');fs.mkdirSync(artifactDir,{recursive:true});
  for(const width of [320,390,1280]){
   await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal overflow '+width);
   await page.screenshot({path:path.join(artifactDir,'tt-panel-'+width+'.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log('PASS TT browser: file import/review/native reload, pinned sparse-history floor export/download, actual relay config/admin/device pair/event receive, 320/390/1280 layout, no page errors.');
 }finally{await browser.close();await new Promise(resolve=>relay.close(resolve));await new Promise(resolve=>ui.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
