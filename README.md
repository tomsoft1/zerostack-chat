# ZeroStack Chat

A real-time multi-room chat application built entirely on [ZeroStack](https://github.com/tomsoft1/zerostack), a Backend-as-a-Service platform. This project serves as a demo showcasing what can be built with ZeroStack without writing any backend code.

## What it does

- **Authentication**: Sign up, log in, or join as a guest
- **Chat rooms**: Browse existing rooms or create new ones (registered users only)
- **Real-time messaging**: Messages appear instantly via WebSocket subscriptions
- **Guest identity**: Anonymous users get a persistent guest ID for message ownership

## How it works

The entire app is a single-page frontend (HTML + CSS + JS) — there is no custom backend. All data storage, authentication, and real-time events are handled by ZeroStack through the [ZeroStack SDK](https://github.com/tomsoft1/zerostack-sdk).

### Architecture

```
Browser  ──  ZeroStack SDK  ──  ZeroStack API  ──  MongoDB
                                     │
                              Socket.io (real-time)
```

### Data model

Two ZeroStack nodes (collections) are used:

- **`rooms`** — Each document stores `{ name, createdBy }`. Public read, only authenticated users can create.
- **`messages`** — Each document stores `{ text, author, room, timestamp }`. Public read and create so guests can participate.

### ZeroStack features used

| Feature | Usage |
|---------|-------|
| `zs.auth.login/register` | User authentication |
| `zs.data.list` | Fetch rooms and messages (with filters) |
| `zs.data.create` | Create rooms and send messages |
| `zs.setGuestId` | Anonymous guest identity |
| `zs.realtime.subscribe` | Live message updates via WebSocket |

## Setup

1. **Run a ZeroStack instance** (see [ZeroStack repo](https://github.com/tomsoft1/zerostack))

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure** — Edit `app.js` and set your ZeroStack URL and API key:

   ```js
   const zs = new ZeroStack({
     apiUrl: 'http://localhost:3002/api',
     wsUrl:  'http://localhost:3002',
     apiKey: 'zs_your_api_key',
   });
   ```

4. **Configure public nodes** in the ZeroStack dashboard for your app:
   - Public Read: `messages, rooms`
   - Public Create: `messages`

5. **Open** `index.html` in a browser (or serve with any static file server)

## License

MIT
