'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function fixture(t, configYaml = 'port: 8000\nenableServerPlugins: false # leave comment\n') {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uvu-bridge-setup-'));
    const tavern = path.join(root, 'SillyTavern');
    const plugin = path.join(tavern, 'plugins', 'uvu-story-bridge');
    await fs.mkdir(path.join(plugin, 'server'), { recursive: true });
    await fs.mkdir(path.join(tavern, 'public'), { recursive: true });
    await fs.writeFile(path.join(tavern, 'config.yaml'), configYaml, 'utf8');
    await fs.writeFile(path.join(plugin, 'server', 'index.js'), '', 'utf8');
    await fs.writeFile(path.join(plugin, 'server', 'config.example.json'), JSON.stringify({ allowedOrigins: ['https://default.example'], maxPayloadBytes: 65536 }), 'utf8');
    await fs.copyFile(path.join(__dirname, '../setup-server-plugin.js'), path.join(plugin, 'setup-server-plugin.js'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { tavern, plugin };
}

test('setup script applies changes only after explicit confirmation and backs up prior settings', async t => {
    const { tavern, plugin } = await fixture(t);
    const run = spawnSync(process.execPath, [path.join(plugin, 'setup-server-plugin.js')], { input: 'https://uvu.example\nAPPLY\n', encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const yaml = await fs.readFile(path.join(tavern, 'config.yaml'), 'utf8');
    assert.match(yaml, /enableServerPlugins: true # leave comment/);
    assert.match(yaml, /origin:\n\s+- "https:\/\/uvu\.example"/);
    assert.match(yaml, /methods:\n\s+- OPTIONS\n\s+- GET\n\s+- POST\n\s+- PUT/);
    assert.match(yaml, /allowedHeaders:\n\s+- Content-Type\n\s+- Authorization/);
    assert.match(run.stdout, /全局 CORS 会允许该网页来源/);
    const cors = JSON.parse(await fs.readFile(path.join(plugin, 'server', 'config.json'), 'utf8'));
    assert.deepEqual(cors.allowedOrigins, ['https://default.example', 'https://uvu.example']);
    assert.ok((await fs.readdir(tavern)).some(name => name.startsWith('config.yaml.uvu-bridge-') && name.endsWith('.bak')));
});

test('setup script cancellation leaves files unchanged', async t => {
    const { tavern, plugin } = await fixture(t);
    const before = await fs.readFile(path.join(tavern, 'config.yaml'), 'utf8');
    const run = spawnSync(process.execPath, [path.join(plugin, 'setup-server-plugin.js')], { input: 'https://uvu.example\nno\n', encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(await fs.readFile(path.join(tavern, 'config.yaml'), 'utf8'), before);
    await assert.rejects(fs.access(path.join(plugin, 'server', 'config.json')));
});

test('setup script merges CORS entries without removing existing origins or methods', async t => {
    const initial = [
        'port: 8000',
        'enableServerPlugins: true',
        'cors:',
        '  enabled: true',
        '  origin:',
        '    - "https://existing.example"',
        '  methods:',
        '    - OPTIONS',
        '    - DELETE',
        '  allowedHeaders: []',
        ''
    ].join('\n');
    const { tavern, plugin } = await fixture(t, initial);
    const run = spawnSync(process.execPath, [path.join(plugin, 'setup-server-plugin.js')], { input: 'https://uvu.example\nAPPLY\n', encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const yaml = await fs.readFile(path.join(tavern, 'config.yaml'), 'utf8');
    assert.match(yaml, /- "https:\/\/existing\.example"/);
    assert.match(yaml, /- "https:\/\/uvu\.example"/);
    assert.match(yaml, /- DELETE/);
    assert.equal((yaml.match(/- OPTIONS/g) || []).length, 1);
    assert.equal((yaml.match(/- POST/g) || []).length, 1);
});

test('setup script refuses an unrecognized CORS value without changing files', async t => {
    const initial = 'port: 8000\nenableServerPlugins: false\ncors:\n  enabled: true\n  origin: null\n  methods:\n    - OPTIONS\n  allowedHeaders: []\n';
    const { tavern, plugin } = await fixture(t, initial);
    const run = spawnSync(process.execPath, [path.join(plugin, 'setup-server-plugin.js')], { input: 'https://uvu.example\nAPPLY\n', encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /无法安全识别 cors\.origin/);
    assert.equal(await fs.readFile(path.join(tavern, 'config.yaml'), 'utf8'), initial);
    await assert.rejects(fs.access(path.join(plugin, 'server', 'config.json')));
});
