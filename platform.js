(function (root) {
    'use strict';
    const NAMESPACE = 'uvu-story-bridge';
    const host = () => root.__TAURITAVERN__;
    function inspect() {
        const tt = host();
        if (!tt) return {kind: 'st', canInject: true};
        const capabilities = tt.iosPolicy?.capabilities;
        return {kind: 'tt', abiVersion: tt.abiVersion, profile: tt.iosPolicy?.profile || '',
            canExecute: capabilities?.extensions?.third_party_execution !== false,
            canInject: capabilities?.scripting?.prompt_injections !== false,
            hasStorage: typeof tt.api?.extension?.store?.setJson === 'function' && typeof tt.api?.extension?.store?.tryGetJson === 'function',
            hasHistory: typeof tt.api?.chat?.current?.ref === 'function' && typeof tt.api?.chat?.open === 'function'};
    }
    function assertSupported() {
        const info = inspect();
        if (info.kind !== 'tt') return info;
        if (info.abiVersion !== 2) throw new Error('TT Host ABI 2 is required; update TauriTavern.');
        if (!info.canExecute) throw new Error('TT iOS policy disables third-party extensions; this build cannot run the bridge.');
        if (!info.hasStorage || !info.hasHistory) throw new Error('TT 缺少可靠存储或完整历史 API，请更新宿主。');
        return info;
    }
    function currentRef() {
        if (inspect().kind !== 'tt') return null;
        assertSupported();
        const ref = host().api.chat.current.ref();
        if (!ref || (ref.kind === 'character' ? ref.characterId == null || !ref.fileName : ref.kind !== 'group' || !ref.chatId))
            throw new Error('TT 当前聊天缺少稳定 ChatRef，请先打开聊天。');
        return structuredClone(ref);
    }
    function sameRef(a, b) {
        return !!a && !!b && a.kind === b.kind && (a.kind === 'character'
            ? a.characterId === b.characterId && a.fileName === b.fileName : a.chatId === b.chatId);
    }
    async function readHistory(context, pinned = currentRef()) {
        if (inspect().kind !== 'tt') {
            if (!Array.isArray(context.chat) || context.chat.some(message => !message)) throw new Error('聊天历史不完整，未导出。');
            return context.chat.slice();
        }
        assertSupported();
        if (!sameRef(currentRef(), pinned)) throw new Error('TT 聊天已改变，请返回原聊天重试。');
        const handle = host().api.chat.open(structuredClone(pinned));
        if (!handle?.history?.tail || !handle.history.before) throw new Error('TT 缺少完整历史分页 API。');
        const pages = [], limit = 100;
        let page = await handle.history.tail({limit}), end = null;
        for (let count = 0; count < 2000; count++) {
            if (!sameRef(currentRef(), pinned)) throw new Error('读取期间 TT 聊天已改变，未导出。');
            if (!page || !Number.isInteger(page.startIndex) || page.startIndex < 0 || !Array.isArray(page.messages) ||
                page.messages.length > limit || page.messages.some(message => !message || typeof message !== 'object') ||
                typeof page.hasMoreBefore !== 'boolean') throw new Error('TT 历史分页无效或不完整。');
            if (end !== null && page.startIndex + page.messages.length !== end) throw new Error('TT 历史分页重叠或缺失。');
            if (page.hasMoreBefore && (!page.messages.length || page.startIndex === 0)) throw new Error('TT 历史分页没有前进。');
            pages.unshift(page.messages);
            if (!page.hasMoreBefore) {
                if (page.startIndex !== 0) throw new Error('TT 历史不完整，未导出。');
                const result = pages.flat();
                // Do not export stale disk data while the host still has unsaved messages.
                if (Array.isArray(context.chat) && context.chat.length !== result.length) throw new Error('TT 聊天保存尚未完成，请稍后重试。');
                for (let index = 0; index < result.length; index++) {
                    const live = context.chat?.[index];
                    if (live && (String(live.mes || '') !== String(result[index].mes || '') || Boolean(live.is_user) !== Boolean(result[index].is_user)))
                        throw new Error('TT 聊天包含尚未保存的修改，请保存后重试。');
                }
                return result;
            }
            end = page.startIndex;
            page = await handle.history.before(page, {limit});
        }
        throw new Error('TT 历史超过 200000 条安全读取上限，请分聊天交接。');
    }
    async function loadState(key = 'settings') {
        assertSupported();
        const record = await host().api.extension.store.tryGetJson({namespace: NAMESPACE, key});
        return record?.found ? structuredClone(record.value) : null;
    }
    async function saveState(value, key = 'settings') {
        assertSupported();
        const snapshot = structuredClone(value), api = host().api.extension.store;
        await api.setJson({namespace: NAMESPACE, key, value: snapshot});
        const receipt = await api.tryGetJson({namespace: NAMESPACE, key});
        if (!receipt?.found || JSON.stringify(receipt.value) !== JSON.stringify(snapshot)) throw new Error('TT 存储未确认保存，请重试。');
    }
    function normalizeEndpoint(input) {
        const value = String(input || '').trim();
        const url = new URL(value);
        if (url.username || url.password || url.search || url.hash || !url.hostname ||
            (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))))
            throw new Error('TT 中继必须使用 HTTPS；只有本机开发可使用 HTTP 回环地址。');
        return url.href.replace(/\/+$/, '');
    }
    root.UvUBridgePlatform = {inspect, assertSupported, currentRef, sameRef, readHistory, loadState, saveState, normalizeEndpoint};
})(globalThis);
