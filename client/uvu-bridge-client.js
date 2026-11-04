const BRIDGE_STORAGE_KEY = 'uvu-story-bridge.v1';

export class UvUStoryBridgeClient {
    constructor({ baseUrl, storage = globalThis.localStorage, fetchImpl = globalThis.fetch } = {}) {
        this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
        this.storage = storage;
        this.fetchImpl = fetchImpl;
        this.token = '';
        try { this.token = JSON.parse(this.storage?.getItem(BRIDGE_STORAGE_KEY) || '{}').token || ''; } catch { /* Treat invalid local state as disconnected. */ }
    }

    saveToken(token) {
        this.token = token;
        if (token) this.storage?.setItem(BRIDGE_STORAGE_KEY, JSON.stringify({ token }));
        else this.storage?.removeItem(BRIDGE_STORAGE_KEY);
    }

    async request(path, { method = 'GET', body, auth = true, signal } = {}) {
        if (!this.baseUrl) throw new Error('请先填写酒馆本机地址。');
        const headers = { Accept: 'application/json' };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (auth) {
            if (!this.token) throw new Error('尚未配对酒馆。');
            headers.Authorization = `Bearer ${this.token}`;
        }
        let response;
        try {
            response = await this.fetchImpl(`${this.baseUrl}/v1${path}`, {
                method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal,
            });
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            throw new Error('无法连接本机酒馆。请确认酒馆正在运行、地址正确，并已允许此网页访问本地网络。', { cause: error });
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `酒馆桥接请求失败（HTTP ${response.status}）。`);
        return data;
    }

    async pair(code) {
        const { token } = await this.request('/client/pair', { method: 'POST', body: { code: String(code || '').trim() }, auth: false });
        if (!token) throw new Error('酒馆没有返回配对令牌。');
        this.saveToken(token);
        return token;
    }

    getState(characterKey, signal) {
        return this.request(`/client/state?characterKey=${encodeURIComponent(characterKey)}`, { signal });
    }

    setMode(value, signal) {
        return this.request('/client/state', { method: 'PUT', body: value, signal });
    }

    publish(event, signal) {
        return this.request('/client/events', { method: 'POST', body: event, signal });
    }

    receive({ after = 0, characterKey, signal } = {}) {
        const query = new URLSearchParams({ after: String(after), characterKey: String(characterKey || '') });
        return this.request(`/client/events?${query}`, { signal });
    }

    acknowledge(seq, characterKey, signal) {
        return this.request('/client/ack', { method: 'POST', body: { seq, characterKey }, signal });
    }

    async disconnect(signal) {
        if (this.token) {
            await this.request('/client/revoke', { method: 'POST', body: {}, signal });
            this.saveToken('');
        }
    }
}
