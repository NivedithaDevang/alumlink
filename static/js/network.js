// ─── NETWORK JS ──────────────────────────────────────────────────────────────

let meNet = null;

async function initNetwork() {
  try {
    const r = await fetch('/api/me');
    meNet = await r.json();
  } catch {}
  loadMyConnections();
}

function showTab(name, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(`tab-${name}`)?.classList.remove('hidden');
}

async function loadMyConnections() {
  try {
    const r = await fetch('/api/connections/mine');
    const d = await r.json();

    // Badge
    const total = d.pending_received.length + d.pending_sent.length;
    const badge = document.getElementById('pendingCount');
    if (badge) badge.textContent = total || '';

    // Connections
    const connList = document.getElementById('connectionsList');
    if (!d.connections.length) {
      connList.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><p>No connections yet. Discover people to connect with!</p></div>';
    } else {
      connList.innerHTML = d.connections.map(u => userCard(u, 'connected')).join('');
    }

    // Received
    const recList = document.getElementById('receivedList');
    if (!d.pending_received.length) {
      recList.innerHTML = '<p style="color:#999;font-size:.875rem;padding:.5rem">No pending requests</p>';
    } else {
      recList.innerHTML = d.pending_received.map(u => userCard(u, 'received')).join('');
    }

    // Sent
    const sentList = document.getElementById('sentList');
    if (!d.pending_sent.length) {
      sentList.innerHTML = '<p style="color:#999;font-size:.875rem;padding:.5rem">No sent requests</p>';
    } else {
      sentList.innerHTML = d.pending_sent.map(u => userCard(u, 'sent')).join('');
    }
  } catch {}
}

function userCard(u, status) {
  let actions = '';
  if (status === 'connected') {
    actions = `
      <button class="btn-ghost-sm" onclick="window.location='/messages?with=${u.id}'"><i class="fas fa-comment-dots"></i> Message</button>
      <button class="btn-outline-sm" style="color:#c62828;border-color:#c62828" onclick="removeConn('${u.id}')">Remove</button>`;
  } else if (status === 'received') {
    actions = `
      <button class="btn-primary" style="font-size:.78rem;padding:.35rem .8rem" onclick="respondConn('${u.conn_id}','accept',this)">Accept</button>
      <button class="btn-ghost" style="font-size:.78rem;padding:.35rem .8rem" onclick="respondConn('${u.conn_id}','reject',this)">Decline</button>`;
  } else if (status === 'sent') {
    actions = `<button class="btn-outline-sm" disabled>Request Sent</button>`;
  } else if (status === 'none') {
    actions = `<button class="btn-outline-sm" onclick="sendConnRequest('${u.id}',this)"><i class="fas fa-user-plus"></i> Connect</button>`;
  }

  const headline = u.role === 'alumni'
    ? [u.designation, u.company].filter(Boolean).join(' at ')
    : u.role === 'student'
    ? [u.dept, u.sem ? 'Sem ' + u.sem : ''].filter(Boolean).join(' · ')
    : 'Faculty';

  return `
  <div class="user-card" id="ucard-${u.id}">
    <img src="${avatar(u.profile_photo)}" onclick="window.location='/profile/${u.id}'" alt=""/>
    <h4 onclick="window.location='/profile/${u.id}'">${u.name}</h4>
    <span class="role-badge ${u.role}">${u.role}</span>
    <p>${headline || u.dept || ''}</p>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;justify-content:center">${actions}</div>
  </div>`;
}

async function sendConnRequest(uid, btn) {
  try {
    const r = await fetch('/api/connections/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: uid })
    });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    btn.textContent = 'Request Sent';
    btn.disabled = true;
  } catch {}
}

async function respondConn(cid, action, btn) {
  try {
    await fetch('/api/connections/respond', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cid, action })
    });
    loadMyConnections();
  } catch {}
}

async function removeConn(uid) {
  if (!confirm('Remove this connection?')) return;
  try {
    await fetch('/api/connections/remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid })
    });
    loadMyConnections();
  } catch {}
}

async function discoverSearch() {
  const q = document.getElementById('discoverSearch').value.trim();
  const dept = document.getElementById('discoverDept').value;
  const role = document.getElementById('discoverRole').value;
  const batch = document.getElementById('discoverBatch').value.trim();
  const skill = document.getElementById('discoverSkill').value.trim();

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (dept) params.set('dept', dept);
  if (role) params.set('role', role);
  if (batch) params.set('batch', batch);
  if (skill) params.set('skill', skill);

  const list = document.getElementById('discoverList');
  list.innerHTML = '<div class="loading-posts"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';

  try {
    const r = await fetch(`/api/users/search?${params}`);
    const users = await r.json();
    if (!users.length) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i><p>No users found</p></div>';
      return;
    }
    // Get connection statuses
    const statusMap = {};
    for (const u of users) {
      try {
        const sr = await fetch(`/api/connections/status/${u.id}`);
        const sd = await sr.json();
        statusMap[u.id] = sd.status;
      } catch {}
    }
    list.innerHTML = users.map(u => {
      const st = statusMap[u.id] || 'none';
      const cardStatus = st === 'none' ? 'none' : st === 'pending' ? 'sent' : 'connected';
      return userCard(u, cardStatus);
    }).join('');
  } catch {}
}

document.addEventListener('DOMContentLoaded', initNetwork);