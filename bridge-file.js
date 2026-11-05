(function(root) {
    'use strict';
    const MAX_BYTES = 16 * 1024 * 1024;
    const bytes = value => new TextEncoder().encode(value).length;
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    async function hash(text) {
        const digest = await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
        return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
    }
    async function validate(input, expected) {
        if (!expected?.characterKey || !expected?.archiveId) throw new Error('请明确选择目标角色 ID 与存档 ID。');
        if (typeof input !== 'string' || bytes(input) > MAX_BYTES) throw new Error('交接文件超过 16 MiB。');
        let file;try {file=JSON.parse(input);} catch {throw new Error('交接文件必须是有效 JSON。');}
        if (!object(file) || file.format !== 'uvu-bridge-file' || file.version !== 1 ||
            !['to-uvu','to-tavern'].includes(file.direction) || file.direction !== expected.direction ||
            file.characterKey !== expected.characterKey || file.archiveId !== expected.archiveId ||
            typeof file.characterKey !== 'string' || file.characterKey.length > 200 || typeof file.archiveId !== 'string' || file.archiveId.length > 200 ||
            !Array.isArray(file.events) || file.events.length < 1 || file.events.length > 2000)
            throw new Error('交接文件格式、方向或目标角色 / 存档不一致。');
        const scenes = new Map(), ids = new Set(), messages = new Map();
        for (const event of file.events) {
            const source = file.direction === 'to-tavern' ? 'uvu' : 'sillytavern';
            const kinds = file.direction === 'to-tavern' ? ['memory_packet','phone_exchange'] : ['scene_transcript','scene_summary','scene_cancelled','handoff_receipt'];
            if (!object(event) || event.source !== source || !kinds.includes(event.kind) || event.characterKey !== file.characterKey ||
                typeof event.eventId !== 'string' || !event.eventId || event.eventId.length > 160 || !object(event.payload) ||
                (event.payload.uvuArchiveId || event.payload.archiveId) !== file.archiveId ||
                (event.payload.uvuArchiveId !== undefined && event.payload.uvuArchiveId !== file.archiveId) ||
                (event.payload.archiveId !== undefined && event.payload.archiveId !== file.archiveId) ||
                (file.direction === 'to-tavern' && event.payload.archiveId !== file.archiveId) || bytes(JSON.stringify(event)) > 65536 || bytes(JSON.stringify(event.payload)) > 49152)
                throw new Error('交接事件身份、来源、类型或大小无效。');
            if (ids.has(event.eventId)) throw new Error('交接文件包含重复事件 ID。');ids.add(event.eventId);
            if (file.direction === 'to-tavern') {
                if (!Array.isArray(event.payload.messages) || event.payload.messages.length > 500) throw new Error('线上交接消息无效。');
                for (const record of event.payload.messages) {
                    const id=record?.sourceMessageId || record?.id;
                    if (!object(record) || typeof id !== 'string' || !id || id.length > 300 || typeof record.text !== 'string') throw new Error('线上交接消息缺少正文或身份。');
                    if (record.messagePart !== undefined || record.messagePartCount !== undefined) {
                        const {messagePart:part,messagePartCount:count}=record;
                        if (!Number.isInteger(part) || !Number.isInteger(count) || count<2 || count>500 || part<1 || part>count || record.text.length>10000) throw new Error('线上交接分段无效。');
                        const key=JSON.stringify([id,record.revision || 'legacy']), group=messages.get(key) || {count,parts:new Map()};
                        if (group.count!==count || group.parts.has(part)) throw new Error('线上交接分段冲突。');
                        group.parts.set(part,record.text);messages.set(key,group);
                    }
                }
            }
            if (event.kind !== 'scene_transcript') continue;
            const p=event.payload;
            if (typeof event.sceneId !== 'string' || !event.sceneId || event.sceneId.length>160 || typeof p.text !== 'string' ||
                !Number.isInteger(p.part) || !Number.isInteger(p.partCount) || p.partCount<1 || p.partCount>2000 || p.part<1 || p.part>p.partCount ||
                !/^[a-f0-9]{64}$/.test(p.partHash || '') || p.partHash !== await hash(p.text)) throw new Error('剧情分段或 SHA-256 校验失败。');
            if (p.sceneFormat !== undefined && p.sceneFormat !== 'floors-v1') throw new Error('未知剧情楼层格式。');
            if (p.sceneFormat === 'floors-v1') {
                const f=p.floor;
                if (!object(f) || typeof f.id !== 'string' || !f.id || f.id.length>160 || !Number.isInteger(f.number) || f.number<1 ||
                    !['user','assistant'].includes(f.role) || typeof f.speaker!=='string' || f.speaker.length>120 || !Number.isFinite(f.createdAt) || f.createdAt<0 || f.createdAt>8640000000000000 ||
                    !['plain','tagged'].includes(f.extraction) || typeof f.bodyTag!=='string' || f.bodyTag.length>41 || !Number.isInteger(f.part) || !Number.isInteger(f.partCount) || f.partCount<1 || f.partCount>2000 || f.part<1 || f.part>f.partCount)
                    throw new Error('剧情楼层元数据无效。');
            }
            const group=scenes.get(event.sceneId) || {count:p.partCount,parts:new Map()};
            if (group.count !== p.partCount || group.parts.has(p.part)) throw new Error('剧情分段重复或数量冲突。');
            group.parts.set(p.part,p);scenes.set(event.sceneId,group);
        }
        for (const group of messages.values()) if (group.parts.size!==group.count) throw new Error('线上消息分段未收齐，未导入。');
        for (const group of scenes.values()) {
            if (group.parts.size !== group.count) throw new Error('剧情分段未收齐，未导入。');
            let previous=null;
            const seenFloors=new Set();
            for (let index=1;index<=group.count;index++) {
                const p=group.parts.get(index),f=p.floor;
                if (Boolean(f)!==Boolean(group.parts.get(1).floor) || p.sceneFormat!==group.parts.get(1).sceneFormat) throw new Error('剧情楼层格式混合。');
                if (!f) continue;
                if (!previous || previous.id!==f.id) {
                    if (seenFloors.has(f.id)) throw new Error('剧情楼层 ID 重复。');
                    seenFloors.add(f.id);
                    if (f.part!==1 || previous && (previous.part!==previous.partCount || f.number<=previous.number)) throw new Error('剧情楼层顺序或分段不完整。');
                } else {
                    for (const key of ['number','speaker','role','createdAt','extraction','bodyTag','partCount']) if (previous[key]!==f[key]) throw new Error('剧情楼层身份冲突。');
                    if (f.part!==previous.part+1) throw new Error('剧情楼层分段顺序无效。');
                }
                previous=f;
            }
            if (previous && previous.part!==previous.partCount) throw new Error('剧情最后楼层不完整。');
        }
        return file;
    }
    root.UvUBridgeFile={validate,hash,MAX_BYTES};
})(globalThis);
