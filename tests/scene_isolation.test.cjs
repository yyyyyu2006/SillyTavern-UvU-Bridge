const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { createBridgeStore } = require('../server/store.js');
function fixture(fetchImpl) {
    const prompts = new Map([['another-extension', 'UNCHANGED']]);
    const context = { extensionSettings: {}, characters: [{ avatar: 'card.png', name: 'A' }], characterId: 0, chatId: 'chat-a',
        setExtensionPrompt: (key, value) => prompts.set(key, value), saveSettingsDebounced: async () => {} };
    const sandbox = vm.createContext({ getContext: () => context, extension_prompt_types: { IN_PROMPT: 0 },
        document: { readyState: 'loading', visibilityState: 'visible', addEventListener() {} }, console, structuredClone, AbortController, AbortSignal,
        setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ token: 'csrf', enabled: true }) })) });
    const source = fs.readFileSync(require.resolve('../index.js'), 'utf8').split('\n').filter(line => !line.startsWith('import ')).join('\n');
    vm.runInContext(fs.readFileSync(require.resolve('../story-text.js'), 'utf8'), sandbox);
    vm.runInContext(source + '\ncontext=getContext(); globalThis.api={settings,updatePrompt,memoryPrompt,pollEvents,applyEnabled,invalidateRequests,request,reviewDraft,deleteReceivedItems,saveReview,renderOnlineReview};', sandbox);
    const settings = sandbox.api.settings();
    Object.assign(settings, { bridgeEnabled: true, injectMemory: true, characterLinks: { 'character:card.png': 'uvu-a' },
        cursorByCharacter: {}, packetsByCharacter: { 'uvu-a': { mode: 'offline', sceneId: 'scene-a', sourceArchiveId: 'archive-a', items: [
            { eventId: 'one', archiveId: 'archive-a', selected: true, text: 'SAVED_MEMORY' },
            { eventId: 'two', archiveId: 'archive-b', selected: true, text: 'OTHER_ARCHIVE' } ] } },
        scene: { id: 'scene-a', stCharacterKey: 'character:card.png', characterKey: 'uvu-a', chatId: 'chat-a', uvuArchiveId: 'archive-a' } });
    return { api: sandbox.api, context, settings, prompts, sandbox };
}

function reviewDom(f) {
    function element(tagName) {
        return { tagName, children: [], dataset: {}, className: '', disabled: false, value: '', listeners: {},
            append(...children) { this.children.push(...children); },
            add(child) { this.children.push(child); },
            replaceChildren() { this.children = []; },
            addEventListener(name, callback) { this.listeners[name] = callback; },
            set textContent(value) { this.text = value; this.children = []; },
            get textContent() { return this.text || ''; } };
    }
    const host = element('host');
    f.sandbox.document.createElement = tagName => element(tagName);
    f.sandbox.document.createTextNode = text => ({ tagName: '#text', text });
    f.sandbox.Option = function (label, value) { return Object.assign(element('option'), { text: label, value }); };
    f.sandbox.testPanel = { querySelector: selector => selector === '[data-online-review]' ? host : null };
    vm.runInContext('panel = testPanel', f.sandbox);
    return host;
}

test('online review keeps an archive selector visible when refresh has no received messages', () => {
    const f = fixture();
    f.settings.packetsByCharacter['uvu-a'] = { items: [] };
    const host = reviewDom(f);
    f.api.renderOnlineReview();
    const label = host.children.find(child => child.tagName === 'label');
    assert.ok(label, 'archive selector label should remain visible');
    assert.equal(label.children[0].tagName, 'select');
    assert.equal(label.children[0].disabled, true);
    assert.match(host.children.map(child => child.text || '').join(' '), /尚未收到在线剧情/);
});

test('active scene can browse and approve another archive without changing scene memory or destination', async () => {
    const f = fixture(), host = reviewDom(f);
    const data = f.settings.packetsByCharacter['uvu-a'];
    data.items = [{eventId:'two',archiveId:'archive-b',text:'OTHER_ARCHIVE',selected:false}];
    f.api.renderOnlineReview();
    const select = host.children.find(child => child.tagName === 'label').children[0];
    assert.equal(select.disabled, false);
    select.value = 'archive-b'; await select.listeners.change();
    const list = host.children.find(child => child.className === 'uvu-bridge-review-list');
    assert.equal(list.children.length, 1);
    assert.equal(list.children[0].children[1].value, 'OTHER_ARCHIVE');
    await f.api.saveReview('uvu-a','archive-b');
    assert.equal(data.items[0].selected, true);
    assert.equal(data.sourceArchiveId, 'archive-a');
    assert.equal(f.settings.scene.uvuArchiveId, 'archive-a');
    assert.equal(f.api.memoryPrompt('uvu-a'), '');
    assert.equal(f.prompts.get('uvu-story-bridge-continuity'), '');
    assert.match(host.children.map(child => child.text || '').join(' '), /本场记忆来源/);
});

test('browsing alone never changes source; explicit next-scene selection is unavailable until scene ends', async () => {
    const f = fixture(), host = reviewDom(f);
    f.api.renderOnlineReview();
    let select = host.children.find(child => child.tagName === 'label').children[0];
    select.value = 'archive-b'; await select.listeners.change();
    let source = host.children.find(child => child.dataset.sourceArchive !== undefined);
    assert.equal(source.disabled, true);
    f.settings.scene = null; f.api.renderOnlineReview();
    source = host.children.find(child => child.dataset.sourceArchive !== undefined);
    assert.equal(source.disabled, false);
    assert.equal(f.settings.packetsByCharacter['uvu-a'].sourceArchiveId, 'archive-a');
    await source.listeners.click();
    assert.equal(f.settings.packetsByCharacter['uvu-a'].sourceArchiveId, 'archive-b');
    assert.equal(f.prompts.get('uvu-story-bridge-continuity'), '');
});

test('a source whose copies were deleted stays visible and other archives can be reviewed', async () => {
    const f = fixture(), host = reviewDom(f); f.settings.scene = null;
    f.settings.packetsByCharacter['uvu-a'].sourceArchiveId = 'deleted-archive';
    f.api.renderOnlineReview();
    const select = host.children.find(child => child.tagName === 'label').children[0];
    assert.equal(select.value, 'deleted-archive');
    assert.match(select.children.find(option => option.value === select.value).text, /0 条/);
    select.value = 'archive-b'; await select.listeners.change();
    assert.equal(f.settings.packetsByCharacter['uvu-a'].sourceArchiveId, 'deleted-archive');
    assert.equal(host.children.find(child => child.className === 'uvu-bridge-review-list').children.length, 1);
});

test('explicit source selection rolls back when persistence fails', async () => {
    const f = fixture(), host = reviewDom(f); f.settings.scene = null;
    f.context.saveSettingsDebounced = async () => { throw new Error('quota'); };
    f.api.renderOnlineReview();
    const select = host.children.find(child => child.tagName === 'label').children[0];
    select.value = 'archive-b'; await select.listeners.change();
    const source = host.children.find(child => child.dataset.sourceArchive !== undefined);
    await source.listeners.click();
    assert.equal(f.settings.packetsByCharacter['uvu-a'].sourceArchiveId, 'archive-a');
});

test('only this extension prompt is written and only for the exact scene/chat/archive', () => {
    const f = fixture();
    f.api.updatePrompt(); assert.match(f.prompts.get('uvu-story-bridge-continuity'), /SAVED_MEMORY/);
    assert.doesNotMatch(f.prompts.get('uvu-story-bridge-continuity'), /OTHER_ARCHIVE/);
    f.context.chatId = 'another-chat-same-card'; f.api.updatePrompt(); assert.equal(f.prompts.get('uvu-story-bridge-continuity'), '');
    f.context.chatId = 'chat-a'; f.settings.scene.uvuArchiveId = 'archive-b'; f.api.updatePrompt(); assert.equal(f.prompts.get('uvu-story-bridge-continuity'), '');
    assert.equal(f.prompts.get('another-extension'), 'UNCHANGED');
});

test('latest 50 draft checks do not inject until explicitly saved and survive polling', async () => {
    const f=fixture(); const data=f.settings.packetsByCharacter['uvu-a'];
    data.items=Array.from({length:55},(_,i)=>({eventId:'m'+i,archiveId:'archive-a',text:'正文'+i,selected:false}));
    const draft=f.api.reviewDraft('uvu-a',data);
    assert.equal(Object.values(draft).filter(i=>i.selected).length,50);
    assert.equal(f.api.memoryPrompt('uvu-a'),'');
    draft.m54.text='手动编辑'; draft.m54.selected=false; draft.m54.touched=true;
    data.items.push({eventId:'new',archiveId:'archive-a',text:'新剧情',selected:false});
    assert.equal(f.api.reviewDraft('uvu-a',structuredClone(data)).m54.text,'手动编辑');
    await f.api.saveReview('uvu-a','archive-a');
    assert.doesNotMatch(f.api.memoryPrompt('uvu-a'),/正文54|手动编辑/);
    assert.match(f.api.memoryPrompt('uvu-a'),/正文53/);
});

test('deleted received copies disappear from injection, survive replay and leave other archives intact', async () => {
    const f=fixture(async url=>({ok:true,json:async()=>url.includes('/ui/events?')?{events:[{seq:1,characterKey:'uvu-a',kind:'memory_packet',payload:{archiveId:'archive-a',messages:[{id:'one',text:'REPLAY'}]}}]}:{mode:'offline',sceneId:'scene-a',enabled:true}}));
    f.settings.packetsByCharacter['uvu-a'].items[0].eventId='archive-a:one';
    await f.api.deleteReceivedItems('uvu-a','archive-a',['archive-a:one']);
    assert.equal(f.api.memoryPrompt('uvu-a'),'');
    await f.api.pollEvents();
    assert.equal(f.settings.packetsByCharacter['uvu-a'].items.length,1);
    assert.equal(f.settings.packetsByCharacter['uvu-a'].items[0].archiveId,'archive-b');
});

test('updated message revision requires fresh review instead of retaining old approval', async () => {
    const f=fixture(async url=>({ok:true,json:async()=>url.includes('/ui/events?')?{events:[{seq:1,characterKey:'uvu-a',kind:'memory_packet',payload:{archiveId:'archive-a',messages:[{id:'one',revision:'new',text:'UPDATED'}]}}]}:{mode:'offline',sceneId:'scene-a',enabled:true}}));
    f.settings.packetsByCharacter['uvu-a'].items[0].eventId='archive-a:one';
    await f.api.pollEvents();
    const items=f.settings.packetsByCharacter['uvu-a'].items;
    assert.equal(items.length,2); assert.equal(items[0].text,'UPDATED'); assert.equal(items[0].selected,false);
    assert.equal(f.api.memoryPrompt('uvu-a'),'');
});
test('master switch immediately clears prompt and preserves suspended scene without automatic resumption', async () => {
    const f = fixture(); f.api.updatePrompt();
    await f.api.applyEnabled(false);
    assert.equal(f.prompts.get('uvu-story-bridge-continuity'), ''); assert.equal(f.settings.scene.suspended, true);
    await f.api.applyEnabled(true); f.api.updatePrompt();
    assert.equal(f.prompts.get('uvu-story-bridge-continuity'), '');
    assert.equal(f.prompts.get('another-extension'), 'UNCHANGED');
});
test('switch away and back during fetch invalidates old events without advancing cursor', async () => {
    let resolve; const pending = new Promise(r => resolve = r);
    const f = fixture(async () => pending);
    const running = f.api.pollEvents();
    f.context.chatId = 'chat-b'; f.api.invalidateRequests(); f.context.chatId = 'chat-a';
    resolve({ ok: true, json: async () => ({ events: [{ seq: 1, characterKey: 'uvu-a', payload: { text: 'STALE' } }] }) });
    await running; assert.equal(f.settings.cursorByCharacter['uvu-a'], undefined);
    assert.equal(f.settings.packetsByCharacter['uvu-a'].items.length, 2);
});
test('service disable never reactivates offline mode on enable', async () => {
    const store = createBridgeStore();
    await store.setMode({ characterKey: 'a', mode: 'offline', sceneId: 's', archiveId: 'archive' });
    assert.equal(store.getMode('a').archiveId, 'archive');
    await store.setEnabled(false); assert.equal(store.getMode('a').mode, 'online');
    await assert.rejects(store.setMode({ characterKey: 'a', mode: 'offline' }), /disabled/);
    await store.setEnabled(true); assert.equal(store.getMode('a').mode, 'online');
});

test('review save and received-copy deletion roll back on settings failure', async () => {
    const f=fixture(), before=JSON.stringify(f.settings.packetsByCharacter['uvu-a']);
    f.context.saveSettingsDebounced=async()=>{throw new Error('quota');};
    await assert.rejects(f.api.deleteReceivedItems('uvu-a','archive-a',['one']),/quota/);
    assert.equal(JSON.stringify(f.settings.packetsByCharacter['uvu-a']),before);
    const draft=f.api.reviewDraft('uvu-a',f.settings.packetsByCharacter['uvu-a']);
    draft.one.text='UNSAVED'; draft.one.touched=true;
    await assert.rejects(f.api.saveReview('uvu-a','archive-a'),/quota/);
    assert.equal(JSON.stringify(f.settings.packetsByCharacter['uvu-a']),before);
    assert.doesNotMatch(f.api.memoryPrompt('uvu-a'),/UNSAVED/);
});

test('manual refresh reports counts and rejects disabled or unbound requests', async () => {
    const f=fixture(async()=>({ok:true,json:async()=>({events:[],mode:'offline',sceneId:'scene-a',enabled:true})}));
    const result=await f.api.pollEvents({manual:true});
    assert.equal(result.received,0); assert.equal(result.total,1);
    f.settings.bridgeEnabled=false;
    await assert.rejects(f.api.pollEvents({manual:true}),/启用/);
});

test('editing legacy received text retains its original source for unchanged retransfers', async () => {
    const f=fixture(async url=>({ok:true,json:async()=>url.includes('/ui/events?')?{events:[{seq:1,characterKey:'uvu-a',kind:'memory_packet',payload:{archiveId:'archive-a',messages:[{id:'one',text:'SAVED_MEMORY'}]}}]}:{mode:'offline',sceneId:'scene-a',enabled:true}}));
    const data=f.settings.packetsByCharacter['uvu-a']; data.items[0].eventId='archive-a:one';
    const draft=f.api.reviewDraft('uvu-a',data); draft['archive-a:one'].text='REVIEW_EDIT'; draft['archive-a:one'].touched=true;
    await f.api.saveReview('uvu-a','archive-a'); await f.api.pollEvents();
    assert.equal(f.settings.packetsByCharacter['uvu-a'].items[0].text,'REVIEW_EDIT');
    assert.equal(f.settings.packetsByCharacter['uvu-a'].items[0].selected,true);
});

test('an acknowledgement failure cannot leave an obsolete approved prompt injected', async () => {
    const f=fixture(async url=>({ok:!url.endsWith('/ui/ack'),status:500,json:async()=>url.endsWith('/csrf-token')?{token:'csrf'}:url.includes('/ui/events?')?{events:[{seq:1,characterKey:'uvu-a',kind:'memory_packet',payload:{archiveId:'archive-a',messages:[{id:'one',text:'UPDATED'}]}}]}:{mode:'offline',sceneId:'scene-a',enabled:true}}));
    f.settings.packetsByCharacter['uvu-a'].items[0].eventId='archive-a:one';
    f.api.updatePrompt(); assert.match(f.prompts.get('uvu-story-bridge-continuity'),/SAVED_MEMORY/);
    await f.api.pollEvents();
    assert.equal(f.prompts.get('uvu-story-bridge-continuity'),'');
});

test('manual refresh recovers an empty local list behind a stale saved cursor using the real relay queue', async () => {
    const store=createBridgeStore();
    await store.appendEvent({source:'uvu',eventId:'sent',characterKey:'uvu-a',kind:'memory_packet',payload:{archiveId:'archive-a',messages:[{id:'one',text:'RECOVERED',createdAt:1}]}},'uvu');
    const f=fixture(async raw=>{
        const url=new URL(raw,'http://localhost');
        const result=url.pathname.endsWith('/ui/events')?store.listEvents('sillytavern',url.searchParams.get('after'),100,'uvu-a'):url.pathname.endsWith('/csrf-token')?{token:'csrf'}:store.getMode('uvu-a');
        return {ok:true,json:async()=>result};
    });
    f.settings.cursorByCharacter['uvu-a']=99;
    f.settings.packetsByCharacter['uvu-a']={sourceArchiveId:'archive-a',items:[]};
    const result=await f.api.pollEvents({manual:true});
    assert.equal(result.received,1); assert.equal(result.total,1);
    assert.equal(f.settings.cursorByCharacter['uvu-a'],1);
    assert.equal(f.settings.packetsByCharacter['uvu-a'].items[0].text,'RECOVERED');
    assert.equal(f.api.memoryPrompt('uvu-a'),'');
});

test('manual replay preserves approved edits and deletion markers without duplicating received messages', async () => {
    const store=createBridgeStore();
    for (const id of ['one','deleted']) await store.appendEvent({source:'uvu',eventId:id,characterKey:'uvu-a',kind:'memory_packet',payload:{archiveId:'archive-a',messages:[{id,text:'SOURCE_'+id}]}},'uvu');
    const f=fixture(async raw=>{
        const url=new URL(raw,'http://localhost');
        return {ok:true,json:async()=>url.pathname.endsWith('/ui/events')?store.listEvents('sillytavern',url.searchParams.get('after'),100,'uvu-a'):url.pathname.endsWith('/csrf-token')?{token:'csrf'}:store.getMode('uvu-a')};
    });
    const data=f.settings.packetsByCharacter['uvu-a'];
    data.items=[{eventId:'archive-a:one',archiveId:'archive-a',text:'APPROVED_EDIT',sourceText:'SOURCE_one',selected:true,reviewed:true}];
    data.deletedEventIds=['archive-a:deleted']; f.settings.cursorByCharacter['uvu-a']=2;
    await f.api.pollEvents({manual:true});
    assert.equal(f.settings.packetsByCharacter['uvu-a'].items.length,1);
    assert.equal(f.settings.packetsByCharacter['uvu-a'].items[0].text,'APPROVED_EDIT');
    assert.equal(f.settings.packetsByCharacter['uvu-a'].items[0].selected,true);
});

function chooseReview(f, host, id) {
    f.api.renderOnlineReview();
    const select = host.children.find(child => child.tagName === 'label').children[0];
    select.value = id; return select.listeners.change();
}

test('browsing and edits survive refresh and chat switches without leaking drafts to other chats', async () => {
    const f = fixture(async()=>({ok:true,json:async()=>({events:[],mode:'offline',sceneId:'scene-a',enabled:true})}));
    const host = reviewDom(f), data = f.settings.packetsByCharacter['uvu-a'];
    await chooseReview(f,host,'archive-b');
    const draft = f.api.reviewDraft('uvu-a',data); draft.two.text='DRAFT_B'; draft.two.touched=true;
    await f.api.pollEvents({manual:true});
    assert.equal(host.children.find(child=>child.tagName==='label').children[0].value,'archive-b');
    assert.equal(f.api.reviewDraft('uvu-a',data).two.text,'DRAFT_B');
    f.context.chatId='chat-b'; f.api.renderOnlineReview();
    assert.equal(host.children.find(child=>child.tagName==='label').children[0].value,'archive-a');
    await chooseReview(f,host,'archive-b');
    assert.equal(f.api.reviewDraft('uvu-a',data).two.text,'OTHER_ARCHIVE');
    f.context.chatId='chat-a'; f.api.renderOnlineReview();
    assert.equal(f.api.reviewDraft('uvu-a',data).two.text,'DRAFT_B');
    assert.equal(f.settings.scene.uvuArchiveId,'archive-a');
});

test('deleting a browsed archive rolls back on failure and preserves source memory and tombstones on success', async () => {
    const f=fixture(), host=reviewDom(f); await chooseReview(f,host,'archive-b');
    const before=JSON.stringify(f.settings.packetsByCharacter['uvu-a']);
    f.context.saveSettingsDebounced=async()=>{throw new Error('quota');};
    await assert.rejects(f.api.deleteReceivedItems('uvu-a','archive-b',['two']),/quota/);
    assert.equal(JSON.stringify(f.settings.packetsByCharacter['uvu-a']),before);
    f.context.saveSettingsDebounced=async()=>{};
    await f.api.deleteReceivedItems('uvu-a','archive-b',['two']);
    const data=f.settings.packetsByCharacter['uvu-a'];
    assert.equal(data.items.length,1); assert.equal(data.items[0].archiveId,'archive-a');
    assert.equal(data.deletedEventIds[0],'two');
    assert.match(f.prompts.get('uvu-story-bridge-continuity'),/SAVED_MEMORY/);
    assert.equal(f.settings.scene.uvuArchiveId,'archive-a');
});

test('old review controls cannot save or delete after switching to another chat of the same character', async () => {
    const f=fixture(), host=reviewDom(f); f.api.renderOnlineReview();
    const list=host.children.find(child=>child.className==='uvu-bridge-review-list');
    const remove=list.children[0].children[2];
    const actions=host.children.find(child=>child.className==='uvu-bridge-row');
    const before=JSON.stringify(f.settings.packetsByCharacter['uvu-a']);
    f.sandbox.confirm=()=>true; f.context.chatId='chat-b';
    await remove.listeners.click(); await actions.children[0].listeners.click();
    assert.equal(JSON.stringify(f.settings.packetsByCharacter['uvu-a']),before);
});

test('preview distinguishes inspected archive from actual injection and clears for another chat', async () => {
    const f=fixture(),host=reviewDom(f); await chooseReview(f,host,'archive-b');
    let preview=host.children.find(child=>child.tagName==='details').children[1].text;
    assert.match(preview,/SAVED_MEMORY/); assert.doesNotMatch(preview,/OTHER_ARCHIVE/);
    assert.match(preview,/不属于本场来源/);
    f.context.chatId='chat-b'; f.api.renderOnlineReview();
    preview=host.children.find(child=>child.tagName==='details').children[1].text;
    assert.doesNotMatch(preview,/SAVED_MEMORY|OTHER_ARCHIVE/);
});
