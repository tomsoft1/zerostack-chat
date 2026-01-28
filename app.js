// ── ZeroStack instance ──────────────────────────────
const zs = new ZeroStack({
  apiUrl: 'http://localhost:3002/api',
  wsUrl:  'http://localhost:3002',
  apiKey: 'zs_b8b1043e9bc0d7bffcda74b727fd2f80a6a41ca546a8c116ddbfe8e358ad5292',
});

// ── State ───────────────────────────────────────────
let state = {
  user: null,          // { id, email } or null for guest
  refreshToken: null,
  messageIds: new Set(),
  currentRoom: null,   // { id, name }
};

// ── DOM refs ────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const authScreen    = $('#auth-screen');
const roomScreen    = $('#room-screen');
const chatScreen    = $('#chat-screen');
const authForm      = $('#auth-form');
const authError     = $('#auth-error');
const authEmail     = $('#auth-email');
const authPassword  = $('#auth-password');
const authConfirm   = $('#auth-confirm');
const authSubmit    = $('#auth-submit');
const guestBtn      = $('#guest-btn');
const roomListEl    = $('#room-list');
const createRoomBtn = $('#create-room-btn');
const roomUserLabel = $('#room-user-label');
const roomLogoutBtn = $('#room-logout-btn');
const messagesEl    = $('#messages');
const messageForm   = $('#message-form');
const messageInput  = $('#message-input');
const userLabel     = $('#user-label');
const logoutBtn     = $('#logout-btn');
const connStatus    = $('#connection-status');
const backBtn       = $('#back-btn');
const roomTitle     = $('#room-title');

let authMode = 'login';

// ── Screen management ───────────────────────────────
function showScreen(screen) {
  authScreen.style.display = 'none';
  roomScreen.style.display = 'none';
  chatScreen.style.display = 'none';
  screen.style.display = 'flex';
}

// ── Helpers ─────────────────────────────────────────
function getDisplayName() {
  return state.user ? state.user.email : 'Guest_' + getGuestId().slice(-4);
}

function getGuestId() {
  let id = localStorage.getItem('chat_guest_id');
  if (!id) {
    id = 'guest_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('chat_guest_id', id);
  }
  return id;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Auth ────────────────────────────────────────────
function setupAuthTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      authMode = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      authConfirm.hidden = authMode === 'login';
      authSubmit.textContent = authMode === 'login' ? 'Sign In' : 'Create Account';
      authError.hidden = true;
    });
  });
}

async function handleAuth(e) {
  e.preventDefault();
  authError.hidden = true;

  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (authMode === 'register' && password !== authConfirm.value) {
    showAuthError('Passwords do not match');
    return;
  }

  try {
    authSubmit.disabled = true;
    authSubmit.textContent = authMode === 'login' ? 'Signing in...' : 'Creating account...';

    const data = authMode === 'login'
      ? await zs.auth.login(email, password)
      : await zs.auth.register(email, password);

    state.user = data.user;
    state.refreshToken = data.refreshToken;
    zs.setToken(data.accessToken);
    zs.clearGuestId();

    localStorage.setItem('chat_auth', JSON.stringify({
      user: data.user,
      token: data.accessToken,
      refreshToken: data.refreshToken,
    }));

    enterRoomList();
  } catch (err) {
    showAuthError(err.message);
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = authMode === 'login' ? 'Sign In' : 'Create Account';
  }
}

function showAuthError(msg) {
  authError.textContent = msg;
  authError.hidden = false;
}

function enterAsGuest() {
  state.user = null;
  zs.clearToken();
  zs.setGuestId(getGuestId());
  enterRoomList();
}

function logout() {
  state.user = null;
  state.refreshToken = null;
  state.currentRoom = null;
  state.messageIds.clear();
  zs.clearToken();
  zs.realtime.disconnect();
  localStorage.removeItem('chat_auth');
  messagesEl.innerHTML = '';
  showScreen(authScreen);
}

function restoreSession() {
  const saved = localStorage.getItem('chat_auth');
  if (saved) {
    try {
      const { user, token, refreshToken } = JSON.parse(saved);
      state.user = user;
      state.refreshToken = refreshToken;
      zs.setToken(token);
      enterRoomList();
    } catch {
      localStorage.removeItem('chat_auth');
    }
  }
}

// ── Room List ───────────────────────────────────────
function enterRoomList() {
  roomUserLabel.textContent = getDisplayName();
  createRoomBtn.hidden = !state.user;
  showScreen(roomScreen);
  loadRooms();
}

async function loadRooms() {
  roomListEl.innerHTML = '<div class="room-empty">Loading...</div>';
  try {
    const data = await zs.data.list('rooms', { limit: 100 });
    const items = Array.isArray(data) ? data : (data.items || []);
    roomListEl.innerHTML = '';
    if (items.length === 0) {
      roomListEl.innerHTML = '<div class="room-empty">No rooms yet</div>';
    } else {
      items.forEach((item) => {
        const d = item.data || {};
        const el = document.createElement('div');
        el.className = 'room-item';
        el.innerHTML = `
          <div>
            <div class="room-name">${escapeHtml(d.name || 'Unnamed')}</div>
            <div class="room-creator">by ${escapeHtml(d.createdBy || 'Unknown')}</div>
          </div>
          <span class="room-arrow">→</span>
        `;
        el.addEventListener('click', () => joinRoom(item._id, d.name || 'Unnamed'));
        roomListEl.appendChild(el);
      });
    }
  } catch (err) {
    console.error('Failed to load rooms:', err);
    roomListEl.innerHTML = '<div class="room-empty">Failed to load rooms</div>';
  }
}

async function createRoom() {
  const name = prompt('Room name:');
  if (!name || !name.trim()) return;

  try {
    const item = await zs.data.create('rooms', {
      name: name.trim(),
      createdBy: state.user.email,
    });
    joinRoom(item._id, name.trim());
  } catch (err) {
    console.error('Failed to create room:', err);
    alert('Failed to create room: ' + err.message);
  }
}

function joinRoom(roomId, roomName) {
  state.currentRoom = { id: roomId, name: roomName };
  state.messageIds.clear();
  enterChat();
}

// ── Chat ────────────────────────────────────────────
function enterChat() {
  roomTitle.textContent = state.currentRoom.name;
  userLabel.textContent = getDisplayName();
  showScreen(chatScreen);
  loadMessages();

  zs.realtime.subscribe('messages', (item) => {
    if (item.data && item.data.room === state.currentRoom?.id) {
      appendMessage(item);
      scrollToBottom();
    }
  });

  zs.realtime.on('connect', () => {
    connStatus.textContent = 'Connected';
    connStatus.className = 'status connected';
  });
  zs.realtime.on('disconnect', () => {
    connStatus.textContent = 'Disconnected';
    connStatus.className = 'status';
  });
  zs.realtime.on('connect_error', () => {
    connStatus.textContent = 'Connection error';
    connStatus.className = 'status';
  });
}

function goBackToRooms() {
  state.currentRoom = null;
  state.messageIds.clear();
  messagesEl.innerHTML = '';
  zs.realtime.disconnect();
  enterRoomList();
}

async function loadMessages() {
  try {
    const data = await zs.data.list('messages', {
      limit: 50,
      filter: { room: state.currentRoom.id },
    });
    const items = Array.isArray(data) ? data : (data.items || []);
    const sorted = items.reverse();
    messagesEl.innerHTML = '';
    if (sorted.length === 0) {
      messagesEl.innerHTML = '<div class="messages-empty">No messages yet. Say hello!</div>';
    } else {
      sorted.forEach((item) => appendMessage(item));
    }
    scrollToBottom();
  } catch (err) {
    console.error('Failed to load messages:', err);
    messagesEl.innerHTML = '<div class="messages-empty">Failed to load messages</div>';
  }
}

function appendMessage(item) {
  if (state.messageIds.has(item._id)) return;
  state.messageIds.add(item._id);

  const empty = messagesEl.querySelector('.messages-empty');
  if (empty) empty.remove();

  const d = item.data || {};
  const author = d.author || 'Guest';
  const text = d.text || '';
  const time = item.createdAt ? new Date(item.createdAt) : new Date();
  const isOwn = d.author === getDisplayName();

  const el = document.createElement('div');
  el.className = `message ${isOwn ? 'own' : 'other'}`;
  el.innerHTML = `
    <span class="author">${escapeHtml(author)}</span>
    <div class="bubble">${escapeHtml(text)}</div>
    <span class="time">${formatTime(time)}</span>
  `;

  messagesEl.appendChild(el);
}

async function sendMessage(e) {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = '';

  const messageData = {
    text,
    author: getDisplayName(),
    room: state.currentRoom.id,
    timestamp: Date.now(),
  };

  try {
    await zs.data.create('messages', messageData);
  } catch (err) {
    console.error('Failed to send message:', err);
    const el = document.createElement('div');
    el.className = 'system-message';
    el.textContent = 'Failed to send message. Try again.';
    messagesEl.appendChild(el);
    scrollToBottom();
  }
}

// ── Init ────────────────────────────────────────────
setupAuthTabs();
authForm.addEventListener('submit', handleAuth);
guestBtn.addEventListener('click', enterAsGuest);
messageForm.addEventListener('submit', sendMessage);
logoutBtn.addEventListener('click', logout);
roomLogoutBtn.addEventListener('click', logout);
createRoomBtn.addEventListener('click', createRoom);
backBtn.addEventListener('click', goBackToRooms);
restoreSession();
