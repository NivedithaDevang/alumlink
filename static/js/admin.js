// ─── ADMIN JS ────────────────────────────────────────────────────────────────

let allUsers = [];
let allPosts = [];

async function initAdmin() {
  loadAdminUsers();
}

function adminTab(name, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(`admin-tab-${name}`)?.classList.remove('hidden');

  if (name === 'reports') loadAdminReports();
  if (name === 'posts') loadAdminPosts();
}

async function loadAdminUsers() {
  try {
    const r = await fetch('/api/admin/users');
    allUsers = await r.json();
    renderUsersTable(allUsers);
  } catch {}
}

function renderUsersTable(users) {
  const el = document.getElementById('adminUsersList');
  if (!users.length) {
    el.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><p>No users found</p></div>';
    return;
  }
  el.innerHTML = `
  <table>
    <thead>
      <tr>
        <th>User</th><th>Role</th><th>Department</th><th>Joined</th><th>Reports</th><th>Status</th><th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${users.map(u => `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:.6rem">
              <img src="${avatar(u.profile_photo)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--border)"/>
              <div>
                <div style="font-weight:700;font-size:.875rem">${u.name || '—'}</div>
                <div style="font-size:.75rem;color:#999">${u.email}</div>
              </div>
            </div>
          </td>
          <td><span class="role-badge ${u.role}">${u.role}</span></td>
          <td>${u.dept || '—'}</td>
          <td style="font-size:.78rem;color:#999">${new Date(u.created_at).toLocaleDateString()}</td>
          <td>${u.report_count > 0 ? `<span style="color:#c62828;font-weight:700">${u.report_count}</span>` : '0'}</td>
          <td>${u.banned ? '<span class="banned-badge">Banned</span>' : '<span style="color:#2e7d32;font-size:.78rem;font-weight:700">Active</span>'}</td>
          <td>
            <div style="display:flex;gap:.4rem;flex-wrap:wrap">
              <a href="/profile/${u.id}" class="btn-ghost-sm" target="_blank"><i class="fas fa-eye"></i></a>
              <button class="btn-outline-sm" onclick="openReportModal('${u.id}')"><i class="fas fa-flag"></i> Report</button>
              ${u.role !== 'admin' ? `
                <button class="btn-outline-sm ${u.banned ? '' : 'danger'}" 
                  style="${u.banned ? '' : 'color:#c62828;border-color:#c62828'}"
                  onclick="toggleBan('${u.id}', ${!u.banned})">
                  ${u.banned ? 'Unban' : 'Ban'}
                </button>` : ''}
            </div>
          </td>
        </tr>`).join('')}
    </tbody>
  </table>`;
}

function filterAdminUsers() {
  const q = document.getElementById('userSearchInput').value.toLowerCase();
  const role = document.getElementById('userRoleFilter').value;
  const filtered = allUsers.filter(u => {
    const matchQ = !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
    const matchRole = !role || u.role === role;
    return matchQ && matchRole;
  });
  renderUsersTable(filtered);
}

async function toggleBan(uid, banned) {
  const action = banned ? 'ban' : 'unban';
  if (!confirm(`Are you sure you want to ${action} this user?`)) return;
  try {
    const r = await fetch('/api/admin/ban', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: uid, banned })
    });
    const d = await r.json();
    if (d.success) loadAdminUsers();
  } catch {}
}

function openReportModal(uid) {
  document.getElementById('reportUserId').value = uid;
  document.getElementById('reportReason').value = '';
  document.getElementById('reportModal').classList.remove('hidden');
}

async function submitReport() {
  const uid = document.getElementById('reportUserId').value;
  const reason = document.getElementById('reportReason').value.trim();
  if (!reason) { alert('Please provide a reason'); return; }
  try {
    await fetch('/api/admin/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: uid, reason })
    });
    document.getElementById('reportModal').classList.add('hidden');
    alert('Report submitted successfully');
    loadAdminUsers();
  } catch {}
}

async function loadAdminReports() {
  const el = document.getElementById('adminReportsList');
  try {
    const r = await fetch('/api/admin/reports');
    const reports = await r.json();
    if (!reports.length) {
      el.innerHTML = '<div class="empty-state"><i class="fas fa-flag"></i><p>No reports filed</p></div>';
      return;
    }
    el.innerHTML = reports.map(rep => `
      <div class="report-item">
        <div style="flex:1">
          <div style="font-weight:700;font-size:.875rem">Reported User: ${rep.reported_info?.name || 'Unknown'}</div>
          <div style="font-size:.78rem;color:#999;margin:.2rem 0">By: ${rep.reporter_info?.name || 'Unknown'} · ${new Date(rep.created_at).toLocaleDateString()}</div>
          <div style="font-size:.875rem;margin-top:.35rem;background:var(--bg);padding:.5rem;border-radius:6px">${rep.reason}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:.4rem">
          <a href="/profile/${rep.reported_user}" class="btn-ghost-sm" target="_blank"><i class="fas fa-eye"></i> View</a>
          <button class="btn-outline-sm" style="color:#c62828;border-color:#c62828" onclick="toggleBan('${rep.reported_user}', true)">Ban User</button>
        </div>
      </div>`).join('');
  } catch {}
}

async function loadAdminPosts() {
  const el = document.getElementById('adminPostsList');
  el.innerHTML = '<div class="loading-posts"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
  try {
    const r = await fetch('/api/posts');
    const posts = await r.json();
    const users = {};
    if (!posts.length) {
      el.innerHTML = '<div class="empty-state"><i class="fas fa-newspaper"></i><p>No posts yet</p></div>';
      return;
    }
    el.innerHTML = `
    <table>
      <thead><tr><th>Author</th><th>Type</th><th>Content</th><th>Date</th><th>Actions</th></tr></thead>
      <tbody>
        ${posts.map(p => `
          <tr>
            <td style="font-size:.875rem">${p.author_info?.name || '—'}</td>
            <td><span class="post-type-badge type-${p.type}">${p.type}</span></td>
            <td style="max-width:300px;font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${p.title ? `<strong>${p.title}</strong> — ` : ''}${p.content.slice(0, 80)}${p.content.length > 80 ? '...' : ''}
            </td>
            <td style="font-size:.75rem;color:#999">${new Date(p.created_at).toLocaleDateString()}</td>
            <td>
              <button class="btn-outline-sm" style="color:#c62828;border-color:#c62828" onclick="adminDeletePost('${p.id}')">
                <i class="fas fa-trash"></i> Delete
              </button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  } catch {}
}

async function adminDeletePost(pid) {
  if (!confirm('Delete this post?')) return;
  try {
    await fetch('/api/admin/delete_post', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: pid })
    });
    loadAdminPosts();
  } catch {}
}

async function createAdmin() {
  const msg = document.getElementById('adminCreateMsg');
  msg.className = 'alert hidden';
  const data = {
    name: document.getElementById('newAdminName').value.trim(),
    email: document.getElementById('newAdminEmail').value.trim(),
    password: document.getElementById('newAdminPwd').value,
    dept: document.getElementById('newAdminDept').value.trim(),
    faculty_id: document.getElementById('newAdminFacId').value.trim()
  };
  if (!data.name || !data.email || !data.password) {
    msg.textContent = 'Name, email and password are required';
    msg.className = 'alert alert-error';
    return;
  }
  try {
    const r = await fetch('/api/admin/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const d = await r.json();
    if (d.error) {
      msg.textContent = d.error;
      msg.className = 'alert alert-error';
      return;
    }
    msg.textContent = 'Admin account created successfully!';
    msg.className = 'alert alert-success';
    document.getElementById('newAdminName').value = '';
    document.getElementById('newAdminEmail').value = '';
    document.getElementById('newAdminPwd').value = '';
    document.getElementById('newAdminDept').value = '';
    document.getElementById('newAdminFacId').value = '';
    loadAdminUsers();
  } catch {}
}

document.addEventListener('DOMContentLoaded', initAdmin);