// Optional browser integration: actual panels and store, simulated HTTP host.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const {createBridgeStore}=require('../server/store.js');
const root=path.resolve(__dirname,'..'),uvu=path.resolve(root,'../UvU');
(async()=>{
 const store=createBridgeStore(),browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const errors=[];let offline=false;
 async function routing(context){await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),body=req.postData()?req.postDataJSON():{},method=req.method();let data={};
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type'};
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="extensions_settings"></div>'});
  if(url.pathname==='/csrf-token')data={token:'csrf'};
  if(url.pathname.includes('/client/')){
   if(offline)return route.abort();
   const token=(req.headers().authorization || '').replace(/^Bearer /,'');
   if(!url.pathname.endsWith('/pair') && !store.isAuthorized(token))return route.fulfill({status:401,json:{error:'revoked'},headers});
   if(url.pathname.endsWith('/pair')){const token=await store.claimPair(body.code,body.device);data={token,...await store.getSession(token)};}
   if(url.pathname.endsWith('/session'))data=await store.getSession(token);
   if(url.pathname.endsWith('/characters'))data={characters:await store.setCharacters(body.characters)};
   if(url.pathname.endsWith('/inbox'))data=store.inbox('uvu');
   if(url.pathname.endsWith('/service'))data=store.getService();
   if(url.pathname.endsWith('/events'))data=store.listEvents('uvu',url.searchParams.get('after'),100,url.searchParams.get('characterKey'));
   if(url.pathname.endsWith('/revoke')){await store.revokeToken(token);data={ok:true};}
  }else{
   if(url.pathname.endsWith('/extension-state'))data=method==='PUT'?await store.putUiState('test',body):store.getUiState('test');
   if(url.pathname.endsWith('/service'))data=store.getService();
   if(url.pathname.endsWith('/pairing'))data=method==='PUT'?await store.setPairingMode(body.mode):{...store.getPairing(),devices:store.listDevices()};
   if(url.pathname.endsWith('/permanent-code'))data=await store.createPermanentPairCode();
   if(url.pathname.endsWith('/revoke-device')){await store.revokeDevice(body.id);data={ok:true};}
   if(url.pathname.endsWith('/revoke-all')){await store.revokeAllDevices();data={ok:true};}
   if(url.pathname.endsWith('/characters'))data={characters:store.listCharacters()};
   if(url.pathname.endsWith('/events'))data=store.listEvents('sillytavern',0,100,'');
  }
  return route.fulfill({json:data,headers});
 });}
 async function phone(context,name){
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  async function initialize(){
   await page.goto('https://uvu-pair.local/');const html=fs.readFileSync(path.join(uvu,'index.html'),'utf8'),start=html.indexOf('<div id="uvu-story-bridge-screen"'),end=html.indexOf('<div id="wallpaper-screen"',start);
   await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1">'+html.slice(start,end).replace('class="screen"','class="screen active"'));
   for(const css of ['css/base.css','css/layout.css','css/settings.css'])await page.addStyleTag({content:fs.readFileSync(path.join(uvu,css),'utf8')});
   await page.evaluate(()=>{window.db={characters:[],uvuStoryBridgeSettings:{}};window.currentChatType='private';window.currentChatId='none';window.saveData=async()=>{};});
   for(const js of ['js/modules/bridge_text.js','js/modules/story_bridge.js'])await page.addScriptTag({content:fs.readFileSync(path.join(uvu,js),'utf8')});
   await page.evaluate(()=>setupUvUStoryBridge());await page.locator('#uvu-bridge-device-name').fill(name);
  }
  await initialize();return {page,initialize};
 }
 try{
  const a=await browser.newContext({viewport:{width:320,height:844}}),b=await browser.newContext({viewport:{width:390,height:844}});await routing(a);await routing(b);
  const tavern=await a.newPage();tavern.on('pageerror',e=>errors.push(e.message));await tavern.goto('https://pairing.local/');
  await tavern.evaluate(()=>{window.getContext=()=>window.testContext;window.extension_prompt_types={IN_PROMPT:0};window.testContext={extensionSettings:{},characters:[],chatId:'',setExtensionPrompt(){},saveSettingsDebounced(){},eventSource:{on(){}},eventTypes:{CHAT_CHANGED:'chat'}};});
  await tavern.addStyleTag({content:fs.readFileSync(path.join(root,'style.css'),'utf8')});
  await tavern.addScriptTag({content:fs.readFileSync(path.join(root,'story-text.js'),'utf8')});
  const nl=String.fromCharCode(10);
  await tavern.addScriptTag({content:fs.readFileSync(path.join(root,'index.js'),'utf8').split(nl).filter(l=>!l.startsWith('import ')).join(nl)});
  if(process.env.UVU_DRAFT_EVIDENCE){
   const evidence=path.resolve(process.env.UVU_DRAFT_EVIDENCE);fs.mkdirSync(evidence,{recursive:true});
   await tavern.setViewportSize({width:402,height:874});
   await tavern.locator('.uvu-bridge-panel').screenshot({path:path.join(evidence,'st-plugin.png')});
   await tavern.setViewportSize({width:320,height:844});
  }
  await tavern.getByText('配对与设备',{exact:true}).click();
  await tavern.getByText('永久配对与已绑定设备',{exact:true}).click();
  await tavern.getByRole('button',{name:'生成 / 重置永久码',exact:true}).click();
  await tavern.waitForFunction(()=>document.querySelector('[data-permanent-code]').textContent.length===32);
  const code=await tavern.locator('[data-permanent-code]').innerText();assert.equal(code.length,32);
  const first=await phone(a,'Chrome'),second=await phone(b,'Edge');
  for(const p of [first.page,second.page]){await p.locator('#uvu-bridge-pair-code').fill(code);await p.locator('#uvu-bridge-pair').click();await p.waitForFunction(()=>UvUStoryBridge.connectionSnapshot().phase==='connected');}
  assert.equal(store.listDevices().length,2);
  const readToken=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('uvu-story-bridge.v1')).token);
  const tokenA=await readToken(first.page),tokenB=await readToken(second.page);assert.notEqual(tokenA,tokenB);
  await first.initialize();await first.page.waitForFunction(()=>UvUStoryBridge.connectionSnapshot().phase==='connected');assert.equal(await readToken(first.page),tokenA);
  offline=true;await first.page.locator('#uvu-bridge-reconnect').click();await first.page.waitForFunction(()=>UvUStoryBridge.connectionSnapshot().phase==='waiting');assert.equal(await readToken(first.page),tokenA);
  offline=false;await first.page.locator('#uvu-bridge-reconnect').click();await first.page.waitForFunction(()=>UvUStoryBridge.connectionSnapshot().phase==='connected');
  tavern.on('dialog',d=>d.accept());await tavern.getByRole('button',{name:'生成 / 重置永久码',exact:true}).click();await tavern.waitForFunction(old=>document.querySelector('[data-permanent-code]').textContent!==old,code);
  assert.equal(store.isAuthorized(tokenA),true);assert.equal(store.isAuthorized(tokenB),true);await assert.rejects(store.claimPair(code));
  await tavern.getByRole('button',{name:'刷新设备',exact:true}).click();assert.equal(await tavern.locator('.uvu-bridge-device').count(),2);
  const edge=tavern.locator('.uvu-bridge-device').filter({hasText:'Edge'});await edge.getByRole('button',{name:'解除绑定',exact:true}).click();await tavern.waitForFunction(()=>document.querySelectorAll('.uvu-bridge-device').length===1);
  assert.equal(store.isAuthorized(tokenA),true);assert.equal(store.isAuthorized(tokenB),false);
  await second.page.locator('#uvu-bridge-reconnect').click();await second.page.waitForFunction(()=>UvUStoryBridge.connectionSnapshot().phase==='revoked');
  for(const p of [tavern,first.page,second.page])assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);console.log('PASS permanent code UI -> two independent devices -> reload reconnect -> offline binding retained -> code rotation -> revoke-one, narrow layout, no page errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
