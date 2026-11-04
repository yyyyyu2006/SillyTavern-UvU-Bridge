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
        const nextYaml = enableServerPlugin(originalYaml);
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
        if (!Number.isInteger(Number(cors.clientPort)) || Number(cors.clientPort) < 1024 || Number(cors.clientPort) > 65535) cors.clientPort = 8765;

        stdout.write(`\n即将执行：\n- 修改 ${yamlPath}，启用服务端插件\n- 更新 ${corsPath}，添加来源 ${origin}，并启用仅监听 127.0.0.1:${cors.clientPort} 的客户端接口\n- 不会修改 SillyTavern 全局 CORS、公开酒馆端口、聊天记录或提示词\n- 修改前在酒馆目录创建带时间戳的配置备份\n\n`);
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
