/**
 * ZeroStack JavaScript SDK
 * Lightweight client for the ZeroStack Backend-as-a-Service.
 *
 * Usage:
 *   import ZeroStack from 'zerostack-sdk';
 *   // or in browser: <script src="zerostack.min.js"></script>
 *
 *   const zs = new ZeroStack({
 *     apiUrl: 'https://zerostack.myapp.fr/api',
 *     wsUrl:  'https://zerostack.myapp.fr',
 *     apiKey: 'zs_...',
 *   });
 *
 *   // Auth
 *   const { user, accessToken } = await zs.auth.register(email, password);
 *   const { user, accessToken } = await zs.auth.login(email, password);
 *   zs.setToken(accessToken);
 *
 *   // Data
 *   const items = await zs.data.list('messages', { limit: 50, filter: { room: 'abc' } });
 *   const item  = await zs.data.create('messages', { text: 'hello' });
 *   const item  = await zs.data.create('messages', { text: 'private' }, { visibility: 'private', allowed: ['guest_xyz'] });
 *   const item  = await zs.data.update('messages', itemId, { text: 'edited' });
 *   const item  = await zs.data.update('messages', itemId, { text: 'edited' }, { allowed: ['guest_a', 'guest_b'] });
 *   await zs.data.delete('messages', itemId);
 *
 *   // Guest identity (for anonymous ownership on public nodes)
 *   zs.setGuestId('guest_abc123');
 *
 *   // Config (owner only, requires setToken)
 *   await zs.config.setPublicNodes({ read: ['messages'], create: ['messages'] });
 *   await zs.config.setNodeTTL({ sessions: 3600, lobbies: 86400 });
 *
 *   // Real-time
 *   zs.realtime.subscribe('messages', (item, event) => console.log(event, item));
 *   zs.realtime.unsubscribe('messages');
 *   zs.realtime.disconnect();
 */

class ZeroStack {
  constructor({ apiUrl, wsUrl, apiKey }) {
    this._apiUrl = apiUrl.replace(/\/+$/, '');
    this._wsUrl = wsUrl;
    this._apiKey = apiKey;
    this._token = null;
    this._guestId = null;

    this.auth = {
      login:    (email, password) => this._request('POST', '/auth/login', { email, password }),
      register: (email, password) => this._request('POST', '/auth/register', { email, password }),
    };

    this.data = {
      list:   (node, opts) => this._list(node, opts),
      create: (node, data, opts) => {
        const { visibility, allowed } = typeof opts === 'string' ? { visibility: opts } : (opts || {});
        return this._request('POST', `/data/${node}`, {
          data, visibility: visibility || 'public',
          ...(allowed && { allowed }),
          ...(this._guestId && !this._token ? { guestId: this._guestId } : {}),
        });
      },
      update: (node, id, data, opts) => {
        const { allowed } = opts || {};
        return this._request('PUT', `/data/${node}/${id}`, {
          data,
          ...(allowed && { allowed }),
          ...(this._guestId && !this._token ? { guestId: this._guestId } : {}),
        });
      },
      delete: (node, id) => this._request('DELETE', `/data/${node}/${id}`,
        this._guestId && !this._token ? { guestId: this._guestId } : undefined
      ),
    };

    this.config = {
      /**
       * Set node visibility: pass arrays of node names for each permission.
       * e.g. zs.config.setPublicNodes({ read: ['messages'], create: ['messages'] })
       */
      setPublicNodes: (publicNodes) => this._request('PUT', '/data/_config', { publicNodes }),
      /**
       * Set TTL per node in seconds.
       * e.g. zs.config.setNodeTTL({ sessions: 3600, lobbies: 86400 })
       */
      setNodeTTL: (nodeTTL) => this._request('PUT', '/data/_config', { nodeTTL }),
    };

    this.realtime = {
      _socket: null,
      _handlers: {},
      subscribe:   (node, callback) => this._subscribe(node, callback),
      unsubscribe: (node) => this._unsubscribe(node),
      disconnect:  () => this._disconnect(),
      on:          (event, callback) => this._on(event, callback),
    };
  }

  // ── Token ───────────────────────────────────────────
  setToken(token) {
    this._token = token;
  }

  clearToken() {
    this._token = null;
  }

  setGuestId(guestId) {
    this._guestId = guestId;
  }

  clearGuestId() {
    this._guestId = null;
  }

  // ── HTTP ────────────────────────────────────────────
  async _request(method, path, body) {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this._apiKey,
    };
    if (this._token) {
      headers['Authorization'] = `Bearer ${this._token}`;
    }
    if (this._guestId && !this._token) {
      headers['x-guest-id'] = this._guestId;
    }

    const res = await fetch(`${this._apiUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json();
    if (!json.success) {
      const err = new Error(json.error || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return json.data;
  }

  async _list(node, { limit, filter, page } = {}) {
    let path = `/data/${node}?limit=${limit || 50}`;
    if (page) path += `&page=${page}`;
    if (filter) path += `&filter=${encodeURIComponent(JSON.stringify(filter))}`;
    return this._request('GET', path);
  }

  // ── WebSocket ───────────────────────────────────────
  _ensureSocket() {
    const rt = this.realtime;
    if (rt._socket) return rt._socket;
    if (typeof io === 'undefined') {
      console.warn('[ZeroStack] socket.io not loaded, real-time unavailable');
      return null;
    }

    const socket = io(this._wsUrl, { auth: { apiKey: this._apiKey } });

    socket.on('data:created', ({ node, item }) => {
      const handler = rt._handlers[node];
      if (handler) handler(item, 'created');
    });

    socket.on('data:updated', ({ node, item }) => {
      const handler = rt._handlers[node];
      if (handler) handler(item, 'updated');
    });

    socket.on('data:deleted', ({ node, item }) => {
      const handler = rt._handlers[node];
      if (handler) handler(item, 'deleted');
    });

    rt._socket = socket;
    return socket;
  }

  _subscribe(node, callback) {
    const socket = this._ensureSocket();
    if (!socket) return;
    this.realtime._handlers[node] = callback;
    socket.emit('subscribe', { node });
  }

  _unsubscribe(node) {
    delete this.realtime._handlers[node];
  }

  _disconnect() {
    const rt = this.realtime;
    if (rt._socket) {
      rt._socket.disconnect();
      rt._socket = null;
    }
    rt._handlers = {};
  }

  _on(event, callback) {
    const socket = this._ensureSocket();
    if (socket) socket.on(event, callback);
  }
}

// Support both module and browser global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZeroStack;
  module.exports.default = ZeroStack;
}
if (typeof window !== 'undefined') {
  window.ZeroStack = ZeroStack;
}

export default ZeroStack;
