// ─── MESSAGES JS — FINAL ─────────────────────────────────────────────────────

let meMsg = null;
let currentChatUserId = null;
let currentRoom = null;
let socket = null;
let typingTimeout = null;
let allConvs = []; // cache for search filtering

// ── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Step 1 — load current user
  try {
    const r = await fetch('/api/me');
    if (!r.ok) { window.location.href = '/login'; return; }
    meMsg = await r.json();
  } catch (e) {
    showError('conversationsList', 'Could not load your account. Please refresh.');
    return;
  }

  // Step 2 — load conversations
  await loadConversations();

  // Step 3 — socket
  initSocket();

  // Step 4 — if URL has ?with=uid, open that chat
  const params = new URLSearchParams(window.location.search);
  const withUid = params.get('with');
  if (withUid) {
    await openChat(withUid);
  }
});

// ── SOCKET ────────────────────────────────────────────────────────────────────

function initSocket() {
  try {
    socket = io({ transports: ['polling', 'websocket'] });
    socket.on('connect', () => {
      socket.emit('join', { room: meMsg.id });
      if (currentRoom) socket.emit('join', { room: currentRoom });
    });
    socket.on('new_message', (msg) => {
      const msgRoom = [msg.from, msg.to].sort().join('_');
      if (currentRoom && msgRoom === currentRoom && msg.from !== meMsg.id) {
        removePlaceholder();
        appendMessage(msg);
      }
      loadConversations();
    });
    socket.on('typing', (data) => {
      if (data.from !== currentChatUserId) return;
      const ti = document.getElementById('typingIndicator');
      if (!ti) return;
      ti.classList.remove('hidden');
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => ti.classList.add('hidden'), 2000);
    });
  } catch (e) { /* socket unavailable, HTTP only */ }
}

// ── CONVERSATIONS ─────────────────────────────────────────────────────────────

async function loadConversations() {
  const list = document.getElementById('conversationsList');
  if (!list) return;
  try {
    const r = await fetch('/api/messages/conversations');
    const data = await r.json();
    allConvs = data;
    renderConversations(data);
  } catch (e) {
    list.innerHTML = `<div style="padding:1.5rem;text-align:center;color:#f88;font-size:.82rem">
      Failed to load.<br/>
      <button onclick="loadConversations()"
        style="margin-top:.5rem;background:none;border:1px solid #f88;color:#f88;
               padding:.25rem .7rem;border-radius:12px;cursor:pointer;font-size:.75rem">Retry</button>
    </div>`;
  }
}

function renderConversations(convs) {
  const list = document.getElementById('conversationsList');
  if (!list) return;
  if (!convs.length) {
    list.innerHTML = `
      <div style="padding:2rem 1rem;text-align:center;color:rgba(255,255,255,.45);font-size:.82rem;line-height:1.8">
        <i class="fas fa-comments" style="font-size:2rem;opacity:.3;display:block;margin-bottom:.5rem"></i>
        No conversations yet.<br/>
        <span style="font-size:.75rem">Click <strong style="color:var(--accent)">✏ New Chat</strong> above<br/>or connect with people in <a href="/network" style="color:var(--accent)">Network</a></span>
      </div>`;
    return;
  }
  list.innerHTML = convs.map(c => {
    const active = currentChatUserId === c.user.id ? 'active' : '';
    const photo = c.user.profile_photo || '/static/images/default-avatar.png';
    const lastText = c.last_message && c.last_message.content
      ? esc(c.last_message.content).slice(0, 40) + (c.last_message.content.length > 40 ? '…' : '')
      : '<span style="opacity:.5;font-style:italic">No messages yet</span>';
    return `<div class="conv-item ${active}" id="conv-${c.user.id}" onclick="openChat('${c.user.id}')">
      <img src="${photo}" alt="" onerror="this.src='/static/images/default-avatar.png'" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.2);flex-shrink:0"/>
      <div class="conv-info">
        <div class="conv-name">${esc(c.user.name)}</div>
        <div class="conv-last">${lastText}</div>
      </div>
      ${c.unread > 0 ? `<span class="conv-badge">${c.unread}</span>` : ''}
    </div>`;
  }).join('');
}

function filterConvs(q) {
  if (!q.trim()) { renderConversations(allConvs); return; }
  const filtered = allConvs.filter(c =>
    c.user.name.toLowerCase().includes(q.toLowerCase())
  );
  renderConversations(filtered);
}

// ── NEW CHAT PANEL ────────────────────────────────────────────────────────────

function showNewChatPanel() {
  document.getElementById('chatEmpty').classList.add('hidden');
  document.getElementById('chatWindow').classList.add('hidden');
  document.getElementById('newChatPanel').classList.remove('hidden');
  document.getElementById('newChatPanel').style.display = 'flex';
  document.getElementById('newChatSearch').focus();
  document.getElementById('newChatResults').innerHTML = `
    <p style="color:var(--text-muted);font-size:.82rem;padding:.5rem 0">
      <i class="fas fa-search"></i> Type a name to search all users
    </p>`;
}

function hideNewChatPanel() {
  document.getElementById('newChatPanel').classList.add('hidden');
  document.getElementById('newChatPanel').style.display = 'none';
  if (currentChatUserId) {
    document.getElementById('chatWindow').classList.remove('hidden');
  } else {
    document.getElementById('chatEmpty').classList.remove('hidden');
  }
}

let searchDebounce = null;
async function searchUsersForChat(q) {
  clearTimeout(searchDebounce);
  const res = document.getElementById('newChatResults');
  if (!q.trim()) {
    res.innerHTML = `<p style="color:var(--text-muted);font-size:.82rem">Type a name to search</p>`;
    return;
  }
  searchDebounce = setTimeout(async () => {
    res.innerHTML = `<div style="color:var(--text-muted);font-size:.82rem;padding:.5rem 0"><i class="fas fa-spinner fa-spin"></i> Searching...</div>`;
    try {
      const r = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
      const users = await r.json();
      if (!users.length) {
        res.innerHTML = `<p style="color:var(--text-muted);font-size:.85rem">No users found for "${esc(q)}"</p>`;
        return;
      }
      res.innerHTML = users.map(u => `
        <div onclick="startChatWith('${u.id}')"
             style="display:flex;align-items:center;gap:.75rem;padding:.75rem;border-radius:10px;
                    cursor:pointer;transition:background .15s;margin-bottom:.35rem;border:1px solid var(--border)"
             onmouseover="this.style.background='var(--accent-light)'"
             onmouseout="this.style.background=''"
        >
          <img src="${u.profile_photo || '/static/images/default-avatar.png'}" alt=""
               style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid var(--border)"
               onerror="this.src='/static/images/default-avatar.png'"/>
          <div>
            <div style="font-weight:700;font-size:.9rem">${esc(u.name)}</div>
            <div style="font-size:.75rem;color:var(--text-muted)">${u.role}${u.dept ? ' · ' + u.dept : ''}</div>
          </div>
          <i class="fas fa-comment-dots" style="margin-left:auto;color:var(--accent);font-size:1.1rem"></i>
        </div>`).join('');
    } catch (e) {
      res.innerHTML = `<p style="color:var(--red);font-size:.82rem">Search failed. Try again.</p>`;
    }
  }, 300);
}

async function startChatWith(uid) {
  document.getElementById('newChatPanel').classList.add('hidden');
  document.getElementById('newChatPanel').style.display = 'none';
  await openChat(uid);
}

// ── OPEN CHAT ─────────────────────────────────────────────────────────────────

async function openChat(uid) {
  if (!meMsg) return;

  currentChatUserId = uid;
  currentRoom = [meMsg.id, uid].sort().join('_');

  if (socket && socket.connected) socket.emit('join', { room: currentRoom });

  // Fetch user info
  let chatUser = null;
  try {
    const r = await fetch(`/api/user/${uid}`);
    if (!r.ok) throw new Error();
    chatUser = await r.json();
  } catch {
    alert('Could not load user info. Please try again.');
    return;
  }

  // Show chat window
  document.getElementById('chatEmpty').classList.add('hidden');
  document.getElementById('newChatPanel').classList.add('hidden');
  document.getElementById('newChatPanel').style.display = 'none';
  document.getElementById('chatWindow').classList.remove('hidden');
  document.getElementById('chatWindow').style.display = 'flex';

  // Fill header
  const av = document.getElementById('chatAvatar');
  av.src = chatUser.profile_photo || '/static/images/default-avatar.png';
  av.onerror = () => { av.src = '/static/images/default-avatar.png'; };
  document.getElementById('chatName').textContent = chatUser.name;
  const roleEl = document.getElementById('chatRole');
  roleEl.textContent = chatUser.role;
  roleEl.className = `role-badge ${chatUser.role}`;
  document.getElementById('chatProfileBtn').href = `/profile/${uid}`;

  // Highlight sidebar item
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
  const convEl = document.getElementById(`conv-${uid}`);
  if (convEl) convEl.classList.add('active');

  await loadMessages(uid);
  document.getElementById('msgInput').focus();
}

// ── LOAD MESSAGES ─────────────────────────────────────────────────────────────

async function loadMessages(uid) {
  const box = document.getElementById('chatMessages');
  if (!box) return;
  box.innerHTML = `<div class="msg-placeholder" style="text-align:center;padding:3rem 1rem;color:var(--text-muted)">
    <i class="fas fa-spinner fa-spin" style="font-size:1.5rem"></i>
    <div style="margin-top:.5rem;font-size:.85rem">Loading messages...</div>
  </div>`;
  try {
    const r = await fetch(`/api/messages/${uid}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const msgs = await r.json();
    box.innerHTML = '';
    if (!msgs.length) {
      box.innerHTML = `<div class="msg-placeholder" style="text-align:center;padding:3rem 1rem;color:var(--text-muted)">
        <i class="fas fa-comment-dots" style="font-size:2.5rem;display:block;margin-bottom:.75rem;opacity:.2"></i>
        <div style="font-size:.9rem;font-weight:600">No messages yet</div>
        <div style="font-size:.78rem;margin-top:.25rem">Be the first to say hello! 👋</div>
      </div>`;
      return;
    }
    msgs.forEach(m => appendMessage(m, false));
    scrollBottom();
  } catch (e) {
    box.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--red);font-size:.85rem">
      <i class="fas fa-exclamation-circle"></i> Failed to load messages.<br/>
      <button onclick="loadMessages('${uid}')"
        style="margin-top:.5rem;background:none;border:1px solid var(--red);color:var(--red);
               padding:.3rem .7rem;border-radius:12px;cursor:pointer;font-size:.78rem">Retry</button>
    </div>`;
  }
}

// ── APPEND MESSAGE ────────────────────────────────────────────────────────────

function removePlaceholder() {
  const ph = document.querySelector('.msg-placeholder');
  if (ph) ph.remove();
}

function appendMessage(msg, scroll = true) {
  const box = document.getElementById('chatMessages');
  if (!box) return;
  removePlaceholder();
  const isMine = msg.from === meMsg.id;
  const photo = isMine
    ? (meMsg.profile_photo || '/static/images/default-avatar.png')
    : (msg.sender_info && msg.sender_info.photo ? msg.sender_info.photo : '/static/images/default-avatar.png');
  const time = fmtTime(msg.created_at);
  const div = document.createElement('div');
  div.className = `msg-bubble ${isMine ? 'mine' : ''}`;
  div.innerHTML = `
    <img src="${photo}" alt="" onerror="this.src='/static/images/default-avatar.png'"/>
    <div>
      <div class="msg-text">${esc(msg.content)}</div>
      <div class="msg-time">${time}</div>
    </div>`;
  box.appendChild(div);
  if (scroll) scrollBottom();
}

// ── SEND MESSAGE ──────────────────────────────────────────────────────────────

async function sendMessage() {
  const input = document.getElementById('msgInput');
  const content = (input.value || '').trim();
  if (!content || !currentChatUserId) return;
  input.value = '';
  input.focus();

  // Show immediately (optimistic)
  appendMessage({ from: meMsg.id, to: currentChatUserId, content, created_at: new Date().toISOString() });

  // Save via HTTP (always reliable)
  try {
    const r = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: currentChatUserId, content })
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      console.error('Send failed:', d.error || r.status);
    }
  } catch (e) {
    console.error('Send error:', e);
  }

  // Real-time notify via socket
  if (socket && socket.connected) {
    socket.emit('send_message', { to: currentChatUserId, content });
  }

  loadConversations();
}

function handleMsgKey(e) {
  if (e.key === 'Enter') { sendMessage(); return; }
  if (socket && socket.connected && currentRoom) {
    socket.emit('typing', { room: currentRoom });
  }
}

// ── UTILS ─────────────────────────────────────────────────────────────────────

function scrollBottom() {
  const b = document.getElementById('chatMessages');
  if (b) b.scrollTop = b.scrollHeight;
}

function fmtTime(dt) {
  try { return new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (el) el.innerHTML = `<div style="padding:1.5rem;color:var(--red);font-size:.85rem;text-align:center">${msg}</div>`;
}