#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { stdin, stdout } = require('node:process');

const pluginRoot = path.resolve(__dirname);
const tavernRoot = path.resolve(pluginRoot, '../..');
const yamlPath = path.join(tavernRoot, 'config.yaml');
const corsPath = path.join(pluginRoot, 'server', 'config.json');
const examplePath = path.join(pluginRoot, 'server', 'config.example.json');

function enableServerPlugin(yaml) {
    const lines = yaml.split(/\r?\n/);
    const keys = lines.map((line, index) => ({ line, index })).filter(item => /^enableServerPlugins\s*:/i.test(item.line));
    if (keys.length > 1) throw new Error('config.yaml 中有多个顶层 enableServerPlugins 设置，请先手动整理。');
    if (!keys.length) {
        const newline = yaml.includes('\r\n') ? '\r\n' : '\n';
        const separator = yaml.endsWith('\n') ? '' : newline;
        return `${yaml}${separator}enableServerPlugins: true${newline}`;
    }
    const { line, index } = keys[0];
    if (!/^enableServerPlugins\s*:\s*(?:true|false)(?:\s*(?:#.*)?)$/i.test(line)) {
        throw new Error('无法安全识别 config.yaml 的 enableServerPlugins 值，请手动检查该行。');
    }
    lines[index] = line.replace(/^(enableServerPlugins\s*:\s*)false/i, '$1true');
    return lines.join(yaml.includes('\r\n') ? '\r\n' : '\n');
}

function configureCors(yaml, origin) {
    const newline = yaml.includes('\r\n') ? '\r\n' : '\n';
    const lines = yaml.split(/\r?\n/);
    const start = lines.findIndex(line => /^cors\s*:\s*(?:#.*)?$/.test(line));
    if (start < 0) {
        const separator = yaml && !yaml.endsWith('\n') ? newline : '';
        return `${yaml}${separator}cors:${newline}  enabled: true${newline}  origin:${newline}    - ${JSON.stringify(origin)}${newline}  methods:${newline}    - OPTIONS${newline}    - GET${newline}    - POST${newline}    - PUT${newline}  allowedHeaders:${newline}    - Content-Type${newline}    - Authorization${newline}`;
    }

    let end = lines.length;
    for (let index = start + 1; index < lines.length; index++) {
        const line = lines[index];
        if (line.trim() && !line.trimStart().startsWith('#') && !/^\s/.test(line)) {
            end = index;
            break;
        }
    }
    const block = lines.slice(start + 1, end);
    const keyLines = new Map();
    block.forEach((line, index) => {
        const match = /^(\s+)(enabled|origin|methods|allowedHeaders)\s*:\s*(.*?)\s*(?:#.*)?$/i.exec(line);
        if (!match) return;
        const key = match[2].toLowerCase();
        if (keyLines.has(key)) throw new Error(`config.yaml 的 cors.${key} 出现重复设置，请先手动整理。`);
        keyLines.set(key, { index, indent: match[1], value: match[3] });
    });

    const enabled = keyLines.get('enabled');
    if (!enabled) throw new Error('config.yaml 缺少 cors.enabled，无法安全配置 CORS。');
    if (!/^(?:true|false)$/i.test(enabled.value)) throw new Error('无法安全识别 cors.enabled，请先手动检查 config.yaml。');
    if (enabled.value.toLowerCase() === 'false') block[enabled.index] = block[enabled.index].replace(/:\s*false\b/i, ': true');

    const desired = {
        origin: [origin],
        methods: ['OPTIONS', 'GET', 'POST', 'PUT'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    };
    for (const [key, values] of Object.entries(desired)) {
        const setting = keyLines.get(key.toLowerCase());
        if (!setting) throw new Error(`config.yaml 缺少 cors.${key}，无法安全配置 CORS。`);
        const keyLine = block[setting.index];
        const colon = keyLine.indexOf(':');
        const prefix = keyLine.slice(0, colon + 1);
        const inline = setting.value.trim();
        if (inline && inline !== '[]') {
            if (!inline.startsWith('[') || !inline.endsWith(']')) throw new Error(`无法安全识别 cors.${key} 的 YAML 格式，请先手动检查。`);
            const existing = inline.slice(1, -1).split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
            const merged = [...existing];
            for (const value of values) {
                const found = merged.some(item => key === 'origin' ? item === value : item.toLowerCase() === value.toLowerCase());
                if (!found) merged.push(value);
            }
            block[setting.index] = `${prefix} [${merged.map(value => JSON.stringify(value)).join(', ')}]`;
            continue;
        }
        if (inline === '[]') {
            const comment = /\s+#.*$/.exec(keyLine)?.[0] || '';
            block[setting.index] = `${prefix}${comment}`;
        }

        const keyIndent = setting.indent.length;
        const listIndexes = [];
        for (let index = setting.index + 1; index < block.length; index++) {
            const line = block[index];
            if (!line.trim() || line.trimStart().startsWith('#')) continue;
            const indent = /^\s*/.exec(line)[0].length;
            if (indent <= keyIndent) break;
            if (/^\s+-\s+/.test(line)) listIndexes.push(index);
        }
        const existing = listIndexes.map(index => block[index].replace(/^\s+-\s+/, '').split(/\s+#/, 1)[0].trim().replace(/^['"]|['"]$/g, ''));
        const missing = values.filter(value => !existing.some(item => key === 'origin' ? item === value : item.toLowerCase() === value.toLowerCase()));
        if (!missing.length) continue;
        const itemIndent = listIndexes.length ? /^\s*/.exec(block[listIndexes[listIndexes.length - 1]])[0] : `${setting.indent}  `;
        const insertion = listIndexes.length ? listIndexes[listIndexes.length - 1] + 1 : setting.index + 1;
        block.splice(insertion, 0, ...missing.map(value => `${itemIndent}- ${key === 'origin' ? JSON.stringify(value) : value}`));
        for (const item of keyLines.values()) if (item.index >= insertion) item.index += missing.length;
    }

    lines.splice(start + 1, end - start - 1, ...block);
    return lines.join(newline);
}

function normalizeOrigin(value) {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.origin === 'null' || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
        throw new Error('请输入完整的 HTTPS 网站来源，例如 https://yyyyyu2006.github.io，不要包含路径。');
    }
    return url.origin;
}

async function main() {
    if (path.basename(pluginRoot) !== 'uvu-story-bridge' || !(await exists(path.join(pluginRoot, 'server', 'index.js')))) {
        throw new Error('请先将仓库克隆到 <SillyTavern>/plugins/uvu-story-bridge，再运行本脚本。');
    }
    let originalYaml;
    try { originalYaml = await fs.readFile(yamlPath, 'utf8'); }
    catch { throw new Error(`找不到 ${yamlPath}；请确认脚本位于酒馆 plugins/uvu-story-bridge 目录。`); }

    const rl = readline.createInterface({ input: stdin, output: stdout });
    const answers = [];
    const waiters = [];
    rl.on('line', line => {
        const resolve = waiters.shift();
        if (resolve) resolve(line);
        else answers.push(line);
    });
    const ask = prompt => {
        stdout.write(prompt);
        return answers.length ? Promise.resolve(answers.shift()) : new Promise(resolve => waiters.push(resolve));
    };
    try {
        const origin = normalizeOrigin(await ask('输入 UvU 网站来源（HTTPS 域名，不带路径）: '));
        const nextYaml = configureCors(enableServerPlugin(originalYaml), origin);
        let originalCors = null;
        let cors;
        try {
            originalCors = await fs.readFile(corsPath, 'utf8');
            cors = JSON.parse(originalCors);
        } catch (error) {
            if (error.code !== 'ENOENT') throw new Error(`无法读取 server/config.json：${error.message}`);
            cors = JSON.parse(await fs.readFile(examplePath, 'utf8'));
        }
        if (!Array.isArray(cors.allowedOrigins)) throw new Error('server/config.json 的 allowedOrigins 必须是数组。');
        cors.allowedOrigins = [...new Set([...cors.allowedOrigins.map(String), origin])];

        stdout.write(`\n即将执行：\n- 修改 ${yamlPath}，启用服务端插件，并在全局 CORS 中添加来源 ${origin}、OPTIONS/GET/POST/PUT 方法及 Content-Type/Authorization 请求头\n- 全局 CORS 会允许该网页来源向酒馆 API 发起跨域请求；桥接插件仍限制回环连接并要求配对令牌\n- 更新 ${corsPath}，添加相同来源白名单\n- 修改前在酒馆目录创建带时间戳的配置备份\n- 不会公开酒馆端口，也不会改动聊天记录或提示词\n\n`);
        if ((await ask('确认应用这些本机配置？输入 APPLY 继续: ')).trim() !== 'APPLY') {
            stdout.write('已取消；没有修改配置。\n');
            return;
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const yamlBackup = `${yamlPath}.uvu-bridge-${stamp}.bak`;
        const corsBackup = originalCors === null ? null : `${corsPath}.uvu-bridge-${stamp}.bak`;
        await fs.copyFile(yamlPath, yamlBackup);
        if (corsBackup) await fs.copyFile(corsPath, corsBackup);
        try {
            await fs.writeFile(yamlPath, nextYaml, 'utf8');
            await fs.writeFile(corsPath, `${JSON.stringify(cors, null, 2)}\n`, 'utf8');
        } catch (error) {
            await fs.writeFile(yamlPath, originalYaml, 'utf8').catch(() => {});
            if (originalCors !== null) await fs.writeFile(corsPath, originalCors, 'utf8').catch(() => {});
            else await fs.rm(corsPath, { force: true }).catch(() => {});
            throw error;
        }
        stdout.write(`配置完成。备份：${yamlBackup}${corsBackup ? ` 和 ${corsBackup}` : ''}\n请重启 SillyTavern；然后在扩展管理器安装并启用 UvU Story Bridge UI 扩展。\n`);
    } finally {
        rl.close();
    }
}

async function exists(filePath) {
    try { await fs.access(filePath); return true; }
    catch { return false; }
}

main().catch(error => {
    console.error(`安装配置未完成：${error.message}`);
    process.exitCode = 1;
});
