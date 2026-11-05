'use strict';
const {createServer} = require('node:http');
const {createHash, timingSafeEqual} = require('node:crypto');

function validOrigin(origin) {
    if (typeof origin !== 'string' || /[\s*]/.test(origin)) return false;
    try {
        const url = new URL(origin);
        return !url.username && !url.password && !url.search && !url.hash && ['','/'].includes(url.pathname) &&
            ((url.protocol === 'https:' && url.origin === origin) ||
            (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname) && url.origin === origin) ||
            origin === 'http://tauri.localhost' ||
            (url.protocol === 'tauri:' && origin === 'tauri://localhost'));
    } catch {return false;}
}
function validateRelayConfig(input) {
    const config = {...input};
    let publicUrl;
    try {publicUrl = new URL(config.publicUrl);} catch {throw new Error('publicUrl must be the HTTPS relay base URL.');}
    if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/' ||
        (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(publicUrl.hostname))))
        throw new Error('publicUrl must use HTTPS (HTTP loopback is development only).');
    if (typeof config.adminSecret !== 'string' || config.adminSecret.length < 32 || config.adminSecret.length > 512 || /\s/.test(config.adminSecret))
        throw new Error('adminSecret must contain 32-512 non-whitespace characters; generate 32 random bytes.');
    for (const key of ['clientOrigins','uiOrigins']) {
        if (!Array.isArray(config[key]) || config[key].length < 1 || config[key].length > 20 || !config[key].every(validOrigin))
            throw new Error(key+' must list exact HTTPS or local application origins; wildcards and null are forbidden.');
        config[key] = [...new Set(config[key])];
    }
    config.maxPayloadBytes = Math.max(1024, Math.min(65536, Number(config.maxPayloadBytes) || 65536));
    config.requestsPerMinute = Math.max(1, Math.min(1200, Number(config.requestsPerMinute) || 120));
    return config;
}
function equalSecret(actual, expected) {
    const digest = value => createHash('sha256').update(String(value)).digest();
    return timingSafeEqual(digest(actual), digest(expected));
}
function createRelayHttpServer({store, config: input}) {
    const config = validateRelayConfig(input), rates = new Map(), pairRates = new Map();
    function limited(map, key, maximum) {
        const now = Date.now();
        if (map.size > 4096) for (const [id, entry] of map) if (now - entry.at >= 60000) map.delete(id);
        if (!map.has(key) && map.size >= 4096) return true;
        const previous = map.get(key), entry = !previous || now - previous.at >= 60000 ? {at:now,count:0} : previous;
        entry.count++; map.set(key,entry);return entry.count > maximum;
    }
    const server = createServer(async (req,res) => {
        const origin = String(req.headers.origin || '');
        const send = (status, body, cors = true) => {
            if (cors) {
                res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
                res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
                res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, OPTIONS');
                res.setHeader('Access-Control-Max-Age','600');
            }
            res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
            res.setHeader('Content-Type','application/json; charset=utf-8');
            res.writeHead(status).end(status === 204 ? undefined : JSON.stringify(body));
        };
        let url;
        try {url = new URL(req.url,'http://localhost');} catch {return send(400,{error:'Invalid URL.'},false);}
        const isUi = url.pathname.startsWith('/v1/ui/') || url.pathname === '/v1/health';
        if (!isUi && !url.pathname.startsWith('/v1/client/')) return send(404,{error:'Bridge route not found.'},false);
        if (!(isUi ? config.uiOrigins : config.clientOrigins).includes(origin)) return send(403,{error:'This exact origin is not allowed for this route.'},false);
        const ip = String(req.socket.remoteAddress || 'unknown');
        if (limited(rates,ip,config.requestsPerMinute)) return send(429,{error:'Too many requests; retry in one minute.'});
        if (req.method === 'OPTIONS') return send(204,null);
        const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1] || '';
        const pairing = !isUi && url.pathname === '/v1/client/pair' && req.method === 'POST';
        if (isUi ? !equalSecret(token,config.adminSecret) : !pairing && !store.isAuthorized(token))
            return send(401,{error:isUi ? 'Administrator credential required.' : 'This device is not paired.'});
        if (pairing && limited(pairRates,ip,8)) return send(429,{error:'Too many pairing attempts; retry in one minute.'});
        const route = url.pathname.replace(/^\/v1\/(ui|client)\//,''), target = isUi ? 'sillytavern' : 'uvu';
        const read = async (limit = config.maxPayloadBytes) => {
            if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) throw Object.assign(new Error('Content-Type must be application/json.'),{status:415});
            if (Number(req.headers['content-length']) > limit) throw Object.assign(new Error('Request is too large.'),{status:413});
            const chunks = [];let size = 0;
            for await (const chunk of req) {size += chunk.length;if (size > limit) throw Object.assign(new Error('Request is too large.'),{status:413});chunks.push(chunk);}
            try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw Object.assign(new Error('Request body must be valid JSON.'),{status:400});}
        };
        const query = key => url.searchParams.get(key);
        try {
            let result;
            if (url.pathname === '/v1/health' && req.method === 'GET') result = {ok:true,paired:store.hasPairedClient(),...store.getService()};
            else if (route === 'pair' && pairing) {const body=await read(2048);const credential=await store.claimPair(body?.code,body?.device);result={token:credential,...await store.getSession(credential)};}
            else if (route === 'session' && !isUi && req.method === 'GET') result = await store.getSession(token);
            else if (route === 'service' && req.method === 'GET') result = store.getService();
            else if (route === 'service' && isUi && req.method === 'PUT') result = await store.setEnabled((await read(2048))?.enabled);
            else if (route === 'inbox' && req.method === 'GET') result = store.inbox(target);
            else if (route === 'pair-code' && isUi && req.method === 'GET') result = store.createPairCode();
            else if (route === 'pairing' && isUi && req.method === 'GET') result = {...store.getPairing(),devices:store.listDevices()};
            else if (route === 'pairing' && isUi && req.method === 'PUT') result = await store.setPairingMode((await read(2048))?.mode);
            else if (route === 'permanent-code' && isUi && req.method === 'POST') {await read(2048);result=await store.createPermanentPairCode();}
            else if (route === 'revoke-device' && isUi && req.method === 'POST') {await store.revokeDevice((await read(2048))?.id);result={ok:true};}
            else if (route === 'revoke-all' && isUi && req.method === 'POST') {await read(2048);await store.revokeAllDevices();result={ok:true};}
            else if (route === 'revoke' && !isUi && req.method === 'POST') {await store.revokeToken(token);result={ok:true};}
            else if (route === 'state' && req.method === 'GET') result = store.getMode(query('characterKey'));
            else if (route === 'state' && req.method === 'PUT') result = await store.setMode(await read(2048));
            else if (route === 'characters' && isUi && req.method === 'GET') result = {characters:store.listCharacters()};
            else if (route === 'characters' && !isUi && req.method === 'PUT') result = {characters:await store.setCharacters((await read(65536))?.characters)};
            else if (route === 'events' && req.method === 'GET') result = store.listEvents(target,query('after'),query('limit'),query('characterKey'));
            else if (route === 'events' && req.method === 'POST') result = await store.appendEvent(await read(),target);
            else if (route === 'ack' && req.method === 'POST') {const body=await read(2048);result={cursor:await store.acknowledge(target,body?.seq,body?.characterKey)};}
            else return send(404,{error:'Bridge route not found.'});
            return send(200,result);
        } catch(error) {
            const storageError = /^(EACCES|ENOSPC|EROFS|EIO|ENOENT|EPERM)$/.test(error.code || '');
            return send(error.status || (storageError ? 503 : 400),{error:storageError ? 'Relay storage failed; nothing has been acknowledged. Check storage and retry.' : String(error.message || 'Bridge request failed.').slice(0,300)});
        }
    });
    server.requestTimeout = 15000;server.headersTimeout = 10000;server.maxHeadersCount = 40;
    return server;
}
module.exports = {createRelayHttpServer,validateRelayConfig};
