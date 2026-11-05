// Derived bridge text only; source messages and prompt templates stay untouched.
(function(root) {
    'use strict';
    function fingerprint(value) {
        let hash = 2166136261;
        for (const point of String(value)) { hash ^= point.codePointAt(0); hash = Math.imul(hash, 16777619); }
        return (hash >>> 0).toString(16);
    }
    function clean(value, rules = '') {
        let text = String(value || '').replace(/\r\n/g, '\n');
        text = text.replace(/<(thinking|think|analysis|reasoning|cot|status|statusbar|status_panel|script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
            .replace(/<(thinking|think|analysis|reasoning|cot|status|statusbar|status_panel|script|style)\b[^>]*>[\s\S]*$/gi, '')
            .replace(/<details\b[^>]*>\s*<summary[^>]*>[^<]*(?:状态|思考|思维链|status|reasoning)[\s\S]*?<\/details>/gi, '')
            .replace(/\x60{3}([^\n\x60]*)\n([\s\S]*?)\x60{3}/g, (_, lang, body) => /^(?:js|javascript|ts|typescript|css|json|python|bash|sh|sql|thinking|analysis|reasoning|status)\b/i.test(lang.trim()) ? '' : body)
            .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[图片略]')
            .replace(/<img\b[^>]*>/gi, '[图片略]')
            .replace(/\[图片数据:[\s\S]*?\]/gi, '[图片略]');
        text = text.replace(/^\s*\[[^\]\r\n]{1,80}更新状态为[：:][^\]\r\n]*\]\s*$/gm, '');
        const tags = String(rules).split(/[,，\s]+/).filter(x => /^[a-z][a-z0-9_-]{0,40}$/i.test(x)).slice(0, 20);
        for (const tag of tags) text = text.replace(new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '\\s*>', 'gi'), '');
        text = text.replace(/<(?:br|\/p|\/div|\/li|\/section|\/article|\/tr|\/h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '');
        text = text.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (all, n) => {
            const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
        }).replace(/&(lt|gt|amp|quot|apos|nbsp);/gi, (_, n) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' })[n.toLowerCase()]);
        return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    const BODY_TAGS = ['content', 'maintext', 'main_text', 'main-text', '正文', '正文内容', '正文部分', 'story', 'storytext', 'story_text', 'story-content', 'story_content', 'narrative', 'narration'];
    function extractStory(value, {bodyTags = '', excludeTags = ''} = {}) {
        let source = String(value || '').replace(/\r\n/g, '\n')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/\[\s*UIBOARD(?:\||\s)[^\]]*\]/gi, '')
            .replace(/\x60{3}[^\n]*\n[\s\S]*?\x60{3}/g, '');
        const names = text => String(text).split(/[,，\s]+/u)
            .filter(tag => /^[a-z\u3400-\u9fff][a-z0-9_\-\u3400-\u9fff]{0,40}$/iu.test(tag))
            .map(tag => tag.toLowerCase()).slice(0, 20);
        const blocked = new Set(['think', 'thinking', 'analysis', 'reasoning', 'cot', 'status', 'statusbar', 'status_bar', 'status_panel', 'statusbox', 'status_box', 'uiboard', 'small_theater', 'smalltheater', 'mini_theater', 'theater', '小剧场', '状态栏', '状态', '思考', '思维链', 'script', 'style', 'iframe', 'object', 'svg', ...names(excludeTags)]);
        const tokens = text => [...text.matchAll(/<\s*(\/?)\s*([a-z\u3400-\u9fff][a-z0-9_\-\u3400-\u9fff]*)(?:\s[^<>]*?)?\s*(\/?)>/giu)];
        // Remove known side panels before looking for body wrappers inside them.
        let cut = -1, depth = 0, container = '';
        const ranges = [];
        for (const token of tokens(source)) {
            const name = token[2].toLowerCase(), closing = Boolean(token[1]);
            if (cut < 0 && !closing) {
                const sidePanel = name === 'details' && /^\s*<summary[^>]*>[^<]*(?:状态|思考|思维链|小剧场|番外|status|reasoning)/iu.test(source.slice(token.index + token[0].length));
                const styledPanel = /(?:class|id)\s*=\s*["'][^"']*(?:status[_-]?(?:bar|panel|box)?|small[_-]?theater|状态栏|小剧场)/iu.test(token[0]);
                if (blocked.has(name) || sidePanel || styledPanel) {
                    cut = token.index; container = name; depth = 1;
                    if (token[3]) { ranges.push([cut, token.index + token[0].length]); cut = -1; }
                }
            } else if (cut >= 0 && name === container) {
                if (!closing && !token[3]) depth++;
                else if (closing && --depth === 0) { ranges.push([cut, token.index + token[0].length]); cut = -1; }
            }
        }
        if (cut >= 0) ranges.push([cut, source.length]);
        for (let index = ranges.length - 1; index >= 0; index--) source = source.slice(0, ranges[index][0]) + source.slice(ranges[index][1]);
        const custom = names(bodyTags), candidates = custom.length ? custom : BODY_TAGS;
        for (const name of candidates) {
            let nesting = 0, start = 0, seen = false, malformed = false;
            const bodies = [];
            for (const token of tokens(source)) {
                if (token[2].toLowerCase() !== name) continue;
                seen = true;
                if (!token[1]) {
                    if (token[3]) { malformed = true; continue; }
                    if (nesting++ === 0) start = token.index + token[0].length;
                } else if (nesting > 0) {
                    if (--nesting === 0) bodies.push(source.slice(start, token.index));
                } else malformed = true;
            }
            if (seen) {
                if (nesting || malformed || !bodies.length) return {text: '', mode: 'malformed', tag: name};
                return {text: clean(bodies.join('\n\n')), mode: 'tagged', tag: name};
            }
        }
        source = source.replace(/^\s*\[UIBOARD[^\r\n]*$/gmi, '')
            .replace(/^\s*(?:小剧场|番外剧场|状态栏)\s*[：:][\s\S]*$/mu, '');
        return {text: clean(source), mode: 'plain', tag: ''};
    }
    function segments(value) {
        return clean(value).split(/\n\s*\n/).map(text => text.trim()).filter(Boolean).map((text, index) => ({ id: String(index + 1), text, selected: false }));
    }
    function addMessagePart(pending, key, record) {
        const part = Number(record.messagePart), count = Number(record.messagePartCount);
        if (!Number.isInteger(part) || !Number.isInteger(count) || count < 2 || count > 500 || part < 1 || part > count || typeof record.text !== 'string') {
            throw new Error('在线消息分段无效，未确认本批数据。');
        }
        let entry = pending[key];
        if (!entry) {
            if (Object.keys(pending).length >= 500) throw new Error('未完成的消息分段过多，请检查桥接队列后重试。');
            entry = pending[key] = { count, parts: {}, createdAt: Number(record.createdAt) || 0 };
        }
        if (entry.count !== count) throw new Error('同一线上消息的分段总数不一致，未确认本批数据。');
        if (Object.hasOwn(entry.parts, part) && entry.parts[part] !== record.text) throw new Error('同一线上消息分段内容冲突，未确认本批数据。');
        if (record.text.length > 10000) throw new Error('单个线上消息分段过长，未确认本批数据。');
        const currentSize = Object.values(pending).reduce((total, item) => total + Object.values(item.parts).reduce((size, text) => size + text.length, 0), 0);
        const previousSize = Object.hasOwn(entry.parts, part) ? entry.parts[part].length : 0;
        if (currentSize - previousSize + record.text.length > 2_000_000) throw new Error('未完成的线上消息缓存已达上限；请先恢复完整队列再重试。');
        entry.parts[part] = record.text;
        const complete = Array.from({ length: count }, (_, index) => index + 1).every(index => Object.hasOwn(entry.parts, index));
        if (!complete) return null;
        const text = Array.from({ length: count }, (_, index) => entry.parts[index + 1]).join('');
        delete pending[key];
        return { text, createdAt: entry.createdAt };
    }
    const api = { clean, fingerprint, extractStory, BODY_TAGS, segments, addMessagePart };
    root.UvUBridgeText = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
