// ─── FEED JS ─────────────────────────────────────────────────────────────────

let currentFilter = '';
let meUser = null;
let editingPostId = null;
let selectedType = 'general';

async function initFeed() {
  try {
    const r = await fetch('/api/me');
    meUser = await r.json();
    const av = document.getElementById('createAvatar');
    if (av) av.src = avatar(meUser.profile_photo);
    // Sidebar profile
    loadSidebarProfile();
    loadSuggestions();
  } catch {}
  // Check URL params for type filter
  const params = new URLSearchParams(window.location.search);
  const t = params.get('type');
  if (t) {
    currentFilter = t;
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.type === t);
    });
  }
  loadPosts();
}

async function loadSidebarProfile() {
  if (!meUser) return;
  const el = (id) => document.getElementById(id);
  if (el('sideAvatar')) el('sideAvatar').src = avatar(meUser.profile_photo);
  if (el('sideName')) el('sideName').textContent = meUser.name;
  if (el('sideRole')) { el('sideRole').textContent = meUser.role; el('sideRole').className = `role-badge ${meUser.role}`; }
  if (el('sideDept')) el('sideDept').textContent = meUser.dept || '';
  // Count connections
  try {
    const r = await fetch('/api/connections/mine');
    const d = await r.json();
    if (el('sideConns')) el('sideConns').textContent = d.connections.length;
  } catch {}
  // Count posts
  try {
    const r = await fetch(`/api/posts?user=${meUser.id}`);
    const d = await r.json();
    if (el('sidePosts')) el('sidePosts').textContent = d.length;
  } catch {}
}

async function loadSuggestions() {
  const list = document.getElementById('suggestionsList');
  if (!list) return;
  try {
    const r = await fetch('/api/users/suggestions');
    const users = await r.json();
    if (!users.length) {
      list.innerHTML = '<p style="font-size:.8rem;color:#999;text-align:center">No suggestions yet</p>';
      return;
    }
    list.innerHTML = users.slice(0, 5).map(u => `
      <div class="suggestion-item">
        <img src="${avatar(u.profile_photo)}" onclick="window.location='/profile/${u.id}'"/>
        <div class="suggestion-info">
          <h5 onclick="window.location='/profile/${u.id}'">${u.name}</h5>
          <p>${u.role}${u.dept ? ' · ' + u.dept : ''}</p>
        </div>
        <button class="btn-outline-sm" onclick="connect('${u.id}',this)">+</button>
      </div>`).join('');
  } catch {}
}

async function connect(uid, btn) {
  try {
    const r = await fetch('/api/connections/request', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({to: uid})
    });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    btn.textContent = 'Sent';
    btn.disabled = true;
  } catch {}
}

async function loadPosts() {
  const container = document.getElementById('postsContainer');
  if (!container) return;
  container.innerHTML = '<div class="loading-posts"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
  try {
    const url = `/api/posts${currentFilter ? '?type=' + currentFilter : ''}`;
    const r = await fetch(url);
    const posts = await r.json();
    if (!posts.length) {
      container.innerHTML = '<div class="empty-state card"><i class="fas fa-newspaper"></i><p>No posts yet. Be the first to share!</p></div>';
      return;
    }
    container.innerHTML = posts.map(p => renderPost(p)).join('');
  } catch (e) {
    container.innerHTML = '<div class="empty-state card"><i class="fas fa-exclamation"></i><p>Failed to load posts</p></div>';
  }
}

function renderPost(p) {
  const isMine = meUser && p.author === meUser.id;
  const isAdmin = meUser && meUser.role === 'admin';
  const authorInfo = p.author_info || {};
  const tags = (p.tags || []).map(t => `<span class="post-tag">#${t}</span>`).join('');
  const menuItems = (isMine || isAdmin) ? `
    ${isMine ? `<button onclick="openEditPost('${p.id}')"><i class="fas fa-pen"></i> Edit</button>` : ''}
    <button class="danger" onclick="deletePost('${p.id}')"><i class="fas fa-trash"></i> Delete</button>` : '';

  return `
  <div class="card post-card" id="post-${p.id}">
    <div class="post-header">
      <img src="${avatar(authorInfo.photo)}" class="post-author-avatar" onclick="window.location='/profile/${p.author}'"/>
      <div class="post-author-info">
        <div class="post-author-name" onclick="window.location='/profile/${p.author}'">${authorInfo.name || 'Unknown'}</div>
        <div class="post-author-meta">
          ${roleBadge(authorInfo.role || '')} ${authorInfo.dept ? '· ' + authorInfo.dept : ''} · ${timeAgo(p.created_at)}
          ${p.edited ? '<span class="post-edited">(edited)</span>' : ''}
        </div>
      </div>
      ${postTypeBadge(p.type)}
      ${menuItems ? `
      <div style="position:relative">
        <button class="post-menu-btn" onclick="toggleMenu('menu-${p.id}')"><i class="fas fa-ellipsis-h"></i></button>
        <div class="post-menu" id="menu-${p.id}">${menuItems}</div>
      </div>` : ''}
    </div>
    ${p.title ? `<div class="post-title">${p.title}</div>` : ''}
    <div class="post-content">${p.content}</div>
    ${tags ? `<div class="post-tags">${tags}</div>` : ''}
    <hr class="post-divider"/>
    <div class="post-actions">
      <button class="post-action-btn ${p.liked ? 'liked' : ''}" id="like-${p.id}" onclick="likePost('${p.id}')">
        <i class="fas fa-thumbs-up"></i> <span id="likeCount-${p.id}">${(p.likes || []).length}</span>
      </button>
      <button class="post-action-btn" onclick="toggleComments('${p.id}')">
        <i class="fas fa-comment"></i> ${(p.comments || []).length} Comments
      </button>
      <button class="post-action-btn ${p.saved ? 'saved' : ''}" onclick="savePost('${p.id}',this)">
        <i class="fas fa-bookmark"></i> Save
      </button>
    </div>
    <div class="post-comments" id="comments-${p.id}">
      <div id="commentsList-${p.id}">
        ${(p.comments || []).map(c => renderComment(c)).join('')}
      </div>
      <div class="comment-input">
        <input type="text" id="commentInput-${p.id}" placeholder="Write a comment..." onkeydown="if(event.key==='Enter')submitComment('${p.id}')"/>
        <button onclick="submitComment('${p.id}')"><i class="fas fa-paper-plane"></i></button>
      </div>
    </div>
  </div>`;
}

function renderComment(c) {
  return `
  <div class="comment-item">
    <img src="${avatar(c.author_photo)}" class="comment-avatar"/>
    <div class="comment-bubble">
      <div class="comment-author">${c.author_name}</div>
      <div>${c.content}</div>
    </div>
  </div>`;
}

function toggleMenu(id) {
  const m = document.getElementById(id);
  document.querySelectorAll('.post-menu.open').forEach(el => { if (el.id !== id) el.classList.remove('open'); });
  m.classList.toggle('open');
  document.addEventListener('click', function handler(e) {
    if (!m.contains(e.target)) { m.classList.remove('open'); document.removeEventListener('click', handler); }
  }, { once: false });
}

async function likePost(pid) {
  try {
    const r = await fetch(`/api/posts/${pid}/like`, { method: 'POST' });
    const d = await r.json();
    const btn = document.getElementById(`like-${pid}`);
    const count = document.getElementById(`likeCount-${pid}`);
    if (btn) btn.classList.toggle('liked', d.liked);
    if (count) count.textContent = d.count;
  } catch {}
}

function toggleComments(pid) {
  const el = document.getElementById(`comments-${pid}`);
  el.classList.toggle('open');
}

async function submitComment(pid) {
  const input = document.getElementById(`commentInput-${pid}`);
  const content = input.value.trim();
  if (!content) return;
  try {
    const r = await fetch(`/api/posts/${pid}/comment`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ content })
    });
    const comment = await r.json();
    const list = document.getElementById(`commentsList-${pid}`);
    list.insertAdjacentHTML('beforeend', renderComment(comment));
    input.value = '';
  } catch {}
}

async function savePost(pid, btn) {
  try {
    const r = await fetch(`/api/posts/${pid}/save`, { method: 'POST' });
    const d = await r.json();
    btn.classList.toggle('saved', d.status === 'saved');
    btn.innerHTML = `<i class="fas fa-bookmark"></i> ${d.status === 'saved' ? 'Saved' : 'Save'}`;
  } catch {}
}

async function deletePost(pid) {
  if (!confirm('Delete this post?')) return;
  try {
    await fetch(`/api/posts/${pid}`, { method: 'DELETE' });
    const el = document.getElementById(`post-${pid}`);
    if (el) el.remove();
  } catch {}
}

function filterPosts(type, btn) {
  currentFilter = type;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadPosts();
}

// ─── POST MODAL ───────────────────────────────────────────────────────────────

function openPostModal(type = 'general') {
  selectedType = type;
  document.getElementById('postModal').classList.remove('hidden');
  document.getElementById('postTitle').value = '';
  document.getElementById('postContent').value = '';
  document.getElementById('postTags').value = '';
  document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
}

function closePostModal() {
  document.getElementById('postModal').classList.add('hidden');
}

function selectType(type, btn) {
  selectedType = type;
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function submitPost() {
  const title = document.getElementById('postTitle').value.trim();
  const content = document.getElementById('postContent').value.trim();
  const tagsRaw = document.getElementById('postTags').value;
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  if (!content) { alert('Content is required'); return; }
  const btn = document.getElementById('postSubmitBtn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/posts', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ type: selectedType, title, content, tags })
    });
    const post = await r.json();
    closePostModal();
    loadPosts();
  } catch {}
  btn.disabled = false;
}

// ─── EDIT POST ────────────────────────────────────────────────────────────────

async function openEditPost(pid) {
  // Fetch current post
  const r = await fetch('/api/posts');
  const posts = await r.json();
  const p = posts.find(x => x.id === pid);
  if (!p) return;
  document.getElementById('editPostId').value = pid;
  document.getElementById('editPostType').value = p.type;
  document.getElementById('editPostTitle').value = p.title || '';
  document.getElementById('editPostContent').value = p.content;
  document.getElementById('editPostTags').value = (p.tags || []).join(', ');
  document.getElementById('editPostModal').classList.remove('hidden');
}

async function saveEditPost() {
  const pid = document.getElementById('editPostId').value;
  const tagsRaw = document.getElementById('editPostTags').value;
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  const data = {
    type: document.getElementById('editPostType').value,
    title: document.getElementById('editPostTitle').value.trim(),
    content: document.getElementById('editPostContent').value.trim(),
    tags
  };
  try {
    await fetch(`/api/posts/${pid}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(data)
    });
    document.getElementById('editPostModal').classList.add('hidden');
    loadPosts();
  } catch {}
}

// Close modals on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden');
  }
});

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('postsContainer')) initFeed();
  if (document.getElementById('savedPostsList')) {
    fetch('/api/me').then(r => r.json()).then(u => { meUser = u; });
  }
});