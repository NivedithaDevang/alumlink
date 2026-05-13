// ─── GLOBAL UTILITIES ────────────────────────────────────────────────────────

function timeAgo(dt) {
  const d = new Date(dt), now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function avatar(url, name = '') {
  if (url) return url;
  return '/static/images/default-avatar.png';
}

function roleBadge(role) {
  return `<span class="role-badge ${role}">${role}</span>`;
}

function postTypeBadge(type) {
  const labels = { job: 'Job', internship: 'Internship', career_advice: 'Career Advice', course: 'Course', general: 'General' };
  return `<span class="post-type-badge type-${type}">${labels[type] || type}</span>`;
}

// ─── NAVBAR INIT ──────────────────────────────────────────────────────────────

let currentUser = null;

async function initNavbar() {
  const navName = document.getElementById('navName');
  const navAvatar = document.getElementById('navAvatar');
  if (!navName) return;
  try {
    const r = await fetch('/api/me');
    if (!r.ok) return;
    currentUser = await r.json();
    navName.textContent = currentUser.name || currentUser.email;
    navAvatar.src = avatar(currentUser.profile_photo);
    loadNotifCount();
    setInterval(loadNotifCount, 30000);
  } catch {}
}

async function loadNotifCount() {
  try {
    const r = await fetch('/api/notifications/count');
    const d = await r.json();
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (d.count > 0) {
      badge.textContent = d.count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch {}
}

// ─── GLOBAL SEARCH ────────────────────────────────────────────────────────────

let searchTimeout = null;
const globalSearch = document.getElementById('globalSearch');
const searchDropdown = document.getElementById('searchDropdown');

if (globalSearch) {
  globalSearch.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = globalSearch.value.trim();
    if (!q) { searchDropdown.innerHTML = ''; return; }
    searchTimeout = setTimeout(() => doGlobalSearch(q), 300);
  });
  document.addEventListener('click', (e) => {
    if (!globalSearch.contains(e.target)) searchDropdown.innerHTML = '';
  });
}

async function doGlobalSearch(q) {
  try {
    const r = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
    const users = await r.json();
    if (!users.length) {
      searchDropdown.innerHTML = '<div style="padding:1rem;color:#999;text-align:center;font-size:.875rem">No results found</div>';
      return;
    }
    searchDropdown.innerHTML = users.slice(0, 6).map(u => `
      <div class="search-result-item" onclick="window.location='/profile/${u.id}'">
        <img src="${avatar(u.profile_photo)}" alt=""/>
        <div>
          <div style="font-weight:700;font-size:.875rem">${u.name}</div>
          <div style="font-size:.75rem;color:#999">${u.role} ${u.dept ? '· ' + u.dept : ''}</div>
        </div>
      </div>`).join('');
  } catch {}
}

// ─── SOCKET.IO GLOBAL ─────────────────────────────────────────────────────────

let socket = null;
function initSocket() {
  socket = io();
  socket.on('connect', () => {
    if (currentUser) socket.emit('join', { room: currentUser.id });
  });
  socket.on('new_message', () => {
    loadNotifCount();
  });
}

// ─── ON LOAD ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  if (typeof io !== 'undefined') initSocket();
});