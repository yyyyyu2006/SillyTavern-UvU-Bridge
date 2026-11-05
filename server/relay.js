'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {createBridgeStore} = require('./store.js');
const {createRelayHttpServer,validateRelayConfig} = require('./relay-http.js');

async function startRelay({configPath = process.env.UVU_RELAY_CONFIG || path.join(__dirname,'relay-config.json')} = {}) {
    const file = path.resolve(configPath), raw = JSON.parse(await fs.readFile(file,'utf8'));
    const config = validateRelayConfig({...raw,adminSecret:process.env.UVU_RELAY_ADMIN_SECRET || raw.adminSecret});
    const dataFile = path.resolve(path.dirname(file),raw.dataFile || 'data/tt-relay-state.json');
    const store = createBridgeStore({filePath:dataFile});await store.load();
    const port = Number(raw.port) || 8766;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('port must be 1024-65535.');
    const server = createRelayHttpServer({store,config});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    console.info('[UvU TT Relay] Private single-user relay listening on 127.0.0.1:'+port+'. Configure your HTTPS reverse proxy before mobile use.');
    return server;
}
if (require.main === module) startRelay().catch(error=>{console.error('[UvU TT Relay] Startup refused:',error.message);process.exitCode=1;});
module.exports = {startRelay};
