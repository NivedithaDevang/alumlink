// ─── PROFILE JS ──────────────────────────────────────────────────────────────

let profileUser = null;
let meProfile = null;
let isOwner = false;
let currentEditSection = '';

async function initProfile() {
  try {
    const mr = await fetch('/api/me');
    meProfile = await mr.json();
  } catch {}

  const uid = (typeof VIEW_UID !== 'undefined' && VIEW_UID) ? VIEW_UID : meProfile?.id;
  if (!uid) return;
  isOwner = !VIEW_UID || VIEW_UID === meProfile?.id;

  try {
    const r = await fetch(`/api/user/${uid}`);
    profileUser = await r.json();
  } catch { return; }

  renderProfileHeader();
  renderProfileBody();
  loadUserPosts();
  loadConnectionCount();

  if (isOwner) {
    document.getElementById('avatarUploadBtn')?.classList.remove('hidden');
    document.getElementById('editAboutBtn')?.classList.remove('hidden');
    document.getElementById('editSkillsBtn')?.classList.remove('hidden');
    document.getElementById('editExpBtn')?.classList.remove('hidden');
  }
}

function renderProfileHeader() {
  const u = profileUser;
  document.getElementById('profileAvatar').src = avatar(u.profile_photo);
  document.getElementById('profileName').textContent = u.name;

  let headline = '';
  if (u.role === 'alumni') headline = [u.designation, u.company].filter(Boolean).join(' at ');
  else if (u.role === 'student') headline = [u.dept, u.sem ? 'Sem ' + u.sem : ''].filter(Boolean).join(' · ');
  else headline = 'Faculty / Admin';
  document.getElementById('profileHeadline').textContent = headline;

  const locEl = document.getElementById('profileLocation');
  if (u.location) { locEl.querySelector('span').textContent = u.location; locEl.style.display = 'flex'; }
  else locEl.style.display = 'none';

  // Meta badges
  const meta = document.getElementById('profileMeta');
  meta.innerHTML = `<span>${roleBadge(u.role)}</span>` +
    (u.dept ? `<span><i class="fas fa-building" style="color:var(--primary)"></i> ${u.dept}</span>` : '') +
    (u.batch ? `<span><i class="fas fa-calendar" style="color:var(--primary)"></i> Batch ${u.batch}</span>` : '') +
    (u.usn ? `<span><i class="fas fa-id-card" style="color:var(--primary)"></i> ${u.usn}</span>` : '');

  // Actions
  const actions = document.getElementById('profileActions');
  actions.innerHTML = '';
  if (isOwner) {
    actions.innerHTML = `<button class="btn-primary" onclick="openEditModal('main')"><i class="fas fa-pen"></i> Edit Profile</button>`;
  } else {
    renderConnectionAction(actions);
  }
}

async function renderConnectionAction(container) {
  try {
    const r = await fetch(`/api/connections/status/${profileUser.id}`);
    const d = await r.json();
    if (d.status === 'none') {
      container.innerHTML = `<button class="btn-primary" onclick="sendConnRequest()"><i class="fas fa-user-plus"></i> Connect</button>
        <button class="btn-ghost" onclick="messageUser()"><i class="fas fa-comment-dots"></i> Message</button>`;
    } else if (d.status === 'pending' && d.direction === 'sent') {
      container.innerHTML = `<button class="btn-ghost" disabled>Pending</button>`;
    } else if (d.status === 'pending' && d.direction === 'received') {
      container.innerHTML = `
        <button class="btn-primary" onclick="respondConn('${d.id}','accept')">Accept</button>
        <button class="btn-ghost" onclick="respondConn('${d.id}','reject')">Decline</button>`;
    } else if (d.status === 'accepted') {
      container.innerHTML = `<button class="btn-ghost" onclick="messageUser()"><i class="fas fa-comment-dots"></i> Message</button>
        <button class="btn-outline-sm danger" onclick="removeConn()">Remove Connection</button>`;
    }
  } catch {}
}

async function sendConnRequest() {
  try {
    const r = await fetch('/api/connections/request', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({to: profileUser.id})
    });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    renderConnectionAction(document.getElementById('profileActions'));
  } catch {}
}

async function respondConn(id, action) {
  try {
    await fetch('/api/connections/respond', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({id, action})
    });
    renderConnectionAction(document.getElementById('profileActions'));
    loadConnectionCount();
  } catch {}
}

async function removeConn() {
  if (!confirm('Remove connection?')) return;
  await fetch('/api/connections/remove', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({uid: profileUser.id})
  });
  renderConnectionAction(document.getElementById('profileActions'));
}

async function messageUser() {
  try {
    const r = await fetch('/api/messages/request', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({to: profileUser.id})
    });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    window.location.href = `/messages?with=${profileUser.id}`;
  } catch {}
}

function renderProfileBody() {
  const u = profileUser;
  // Bio
  document.getElementById('profileBio').textContent = u.bio || 'No bio yet.';

  // Skills
  const skillsEl = document.getElementById('skillsList');
  const endorsements = u.endorsements || {};
  if (u.skills && u.skills.length) {
    skillsEl.innerHTML = u.skills.map(s => {
      const count = (endorsements[s] || []).length;
      const endorsed = meProfile && (endorsements[s] || []).includes(meProfile.id);
      const endBtn = !isOwner ? `<button class="skill-endorse" onclick="endorseSkill('${u.id}','${s}',this)" title="Endorse"><i class="fas fa-thumbs-up"></i> ${count}</button>` : `<span style="font-size:.72rem;color:#999">${count}</span>`;
      return `<div class="skill-chip">${s} ${endBtn}</div>`;
    }).join('');
  } else {
    skillsEl.innerHTML = '<span style="color:#999;font-size:.875rem">No skills listed</span>';
  }

  // Alumni: Experience
  if (u.role === 'alumni' && u.experience && u.experience.length) {
    document.getElementById('expSection').classList.remove('hidden');
    document.getElementById('editExpBtn')?.classList.remove('hidden');
    document.getElementById('expList').innerHTML = u.experience.map(e => `
      <div class="exp-item">
        <h4>${e.title || ''}</h4>
        <p>${e.company || ''} ${e.period ? '· ' + e.period : ''}</p>
        ${e.description ? `<p style="margin-top:.35rem;font-size:.85rem">${e.description}</p>` : ''}
      </div>`).join('');
  }

  // Recommendations
  const recsEl = document.getElementById('recsList');
  if (!isOwner && meProfile) {
    document.getElementById('addRecBtn')?.classList.remove('hidden');
  }
  if (u.recommendations && u.recommendations.length) {
    recsEl.innerHTML = u.recommendations.map(r => `
      <div class="rec-item">
        <div class="rec-from">
          <img src="${avatar(r.from_photo)}" onclick="window.location='/profile/${r.from}'"/>
          <span>${r.from_name}</span>
        </div>
        <div class="rec-text">${r.text}</div>
      </div>`).join('');
  } else {
    recsEl.innerHTML = '<span style="color:#999;font-size:.875rem">No recommendations yet</span>';
  }

  // Details card
  const details = document.getElementById('profileDetails');
  let detailsHTML = '';
  if (u.email) detailsHTML += `<div class="detail-item"><i class="fas fa-envelope"></i><span>${u.email}</span></div>`;
  if (u.role === 'student') {
    if (u.usn) detailsHTML += `<div class="detail-item"><i class="fas fa-id-card"></i><span>USN: ${u.usn}</span></div>`;
    if (u.dept) detailsHTML += `<div class="detail-item"><i class="fas fa-building"></i><span>Dept: ${u.dept}</span></div>`;
    if (u.sem) detailsHTML += `<div class="detail-item"><i class="fas fa-book"></i><span>Semester: ${u.sem}</span></div>`;
    if (u.dob) detailsHTML += `<div class="detail-item"><i class="fas fa-birthday-cake"></i><span>DOB: ${u.dob}</span></div>`;
  } else if (u.role === 'alumni') {
    if (u.company) detailsHTML += `<div class="detail-item"><i class="fas fa-building"></i><span>${u.company}</span></div>`;
    if (u.designation) detailsHTML += `<div class="detail-item"><i class="fas fa-briefcase"></i><span>${u.designation}</span></div>`;
    if (u.batch) detailsHTML += `<div class="detail-item"><i class="fas fa-graduation-cap"></i><span>Batch: ${u.batch}</span></div>`;
    if (u.dept) detailsHTML += `<div class="detail-item"><i class="fas fa-university"></i><span>Dept: ${u.dept}</span></div>`;
    if (u.location) detailsHTML += `<div class="detail-item"><i class="fas fa-map-marker-alt"></i><span>${u.location}</span></div>`;
  }
  details.innerHTML = detailsHTML || '<span style="color:#999;font-size:.875rem">No details</span>';
}

async function loadUserPosts() {
  const el = document.getElementById('userPostsList');
  try {
    const r = await fetch(`/api/posts?user=${profileUser.id}`);
    const posts = await r.json();
    if (!posts.length) { el.innerHTML = '<p style="color:#999;font-size:.875rem">No posts yet</p>'; return; }
    // Simple lightweight post rendering for profile
    el.innerHTML = posts.map(p => `
      <div style="border-bottom:1px solid var(--border);padding:.75rem 0;">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem">
          ${postTypeBadge(p.type)}
          <span style="font-size:.75rem;color:#999">${timeAgo(p.created_at)}</span>
        </div>
        ${p.title ? `<div style="font-weight:700;margin-bottom:.2rem">${p.title}</div>` : ''}
        <div style="font-size:.875rem;color:#444;white-space:pre-wrap">${p.content.length > 200 ? p.content.slice(0,200)+'...' : p.content}</div>
      </div>`).join('');
  } catch {}
}

async function loadConnectionCount() {
  try {
    const r = await fetch('/api/connections/mine');
    const d = await r.json();
    const el = document.getElementById('connectionCountText');
    if (el) el.textContent = `${d.connections.length} connection${d.connections.length !== 1 ? 's' : ''}`;
  } catch {}
}

// ─── EDIT MODAL ───────────────────────────────────────────────────────────────

function openEditModal(section) {
  currentEditSection = section;
  const modal = document.getElementById('editModal');
  const body = document.getElementById('editModalBody');
  const title = document.getElementById('editModalTitle');
  modal.classList.remove('hidden');
  const u = profileUser;

  if (section === 'main') {
    title.textContent = 'Edit Profile';
    body.innerHTML = `
      <div class="form-group"><label>Full Name</label><input type="text" id="edit_name" value="${u.name || ''}"/></div>
      <div class="form-group"><label>Bio</label><textarea id="edit_bio" rows="4">${u.bio || ''}</textarea></div>
      ${u.role === 'alumni' ? `
        <div class="form-group"><label>Company</label><input id="edit_company" value="${u.company || ''}"/></div>
        <div class="form-group"><label>Designation</label><input id="edit_designation" value="${u.designation || ''}"/></div>
        <div class="form-group"><label>Location</label><input id="edit_location" value="${u.location || ''}"/></div>
        <div class="form-group"><label>Batch</label><input id="edit_batch" value="${u.batch || ''}"/></div>` : ''}
      ${u.role === 'student' ? `
        <div class="form-group"><label>USN</label><input id="edit_usn" value="${u.usn || ''}"/></div>
        <div class="form-group"><label>Semester</label>
          <select id="edit_sem">${[1,2,3,4,5,6,7,8].map(s=>`<option ${u.sem==s?'selected':''}>${s}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Date of Birth</label><input type="date" id="edit_dob" value="${u.dob || ''}"/></div>` : ''}
      <div class="form-group"><label>Department</label>
        <select id="edit_dept">
          ${['BCA','BBA','MBA','MCA','B.Com','M.Com','B.Sc','Other'].map(d=>`<option ${u.dept===d?'selected':''}>${d}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Visibility</label>
        <select id="edit_visibility">
          <option value="public" ${u.visibility==='public'?'selected':''}>Public</option>
          <option value="connections" ${u.visibility==='connections'?'selected':''}>Connections Only</option>
        </select>
      </div>`;
  } else if (section === 'about') {
    title.textContent = 'Edit About';
    body.innerHTML = `<div class="form-group"><label>Bio</label><textarea id="edit_bio" rows="6">${u.bio || ''}</textarea></div>`;
  } else if (section === 'skills') {
    title.textContent = 'Edit Skills';
    body.innerHTML = `<div class="form-group"><label>Skills (comma separated)</label>
      <input type="text" id="edit_skills" value="${(u.skills || []).join(', ')}"/></div>
      <p style="font-size:.78rem;color:#999">e.g. Python, JavaScript, Management, Finance</p>`;
  } else if (section === 'experience') {
    title.textContent = 'Edit Experience';
    const exp = u.experience || [];
    body.innerHTML = `<div id="expEntries">
      ${exp.map((e,i) => expForm(e,i)).join('')}
    </div>
    <button class="btn-outline-sm" style="margin-top:.75rem" onclick="addExpEntry()"><i class="fas fa-plus"></i> Add Experience</button>`;
  }
}

function expForm(e = {}, i = 0) {
  return `<div class="exp-entry" id="expEntry-${i}" style="border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:.75rem;">
    <div class="form-group"><label>Job Title</label><input class="exp-title" value="${e.title || ''}"/></div>
    <div class="form-group"><label>Company</label><input class="exp-company" value="${e.company || ''}"/></div>
    <div class="form-group"><label>Period (e.g. 2020-2022)</label><input class="exp-period" value="${e.period || ''}"/></div>
    <div class="form-group"><label>Description</label><textarea class="exp-desc" rows="2">${e.description || ''}</textarea></div>
    <button class="btn-danger" style="font-size:.75rem;padding:.3rem .6rem" onclick="this.closest('.exp-entry').remove()">Remove</button>
  </div>`;
}

let expCount = 10;
function addExpEntry() {
  document.getElementById('expEntries').insertAdjacentHTML('beforeend', expForm({}, ++expCount));
}

async function saveEdit() {
  const u = profileUser;
  let data = {};
  if (currentEditSection === 'main') {
    data.name = document.getElementById('edit_name')?.value;
    data.bio = document.getElementById('edit_bio')?.value;
    data.dept = document.getElementById('edit_dept')?.value;
    data.visibility = document.getElementById('edit_visibility')?.value;
    if (u.role === 'alumni') {
      data.company = document.getElementById('edit_company')?.value;
      data.designation = document.getElementById('edit_designation')?.value;
      data.location = document.getElementById('edit_location')?.value;
      data.batch = document.getElementById('edit_batch')?.value;
    }
    if (u.role === 'student') {
      data.usn = document.getElementById('edit_usn')?.value;
      data.sem = document.getElementById('edit_sem')?.value;
      data.dob = document.getElementById('edit_dob')?.value;
    }
  } else if (currentEditSection === 'about') {
    data.bio = document.getElementById('edit_bio')?.value;
  } else if (currentEditSection === 'skills') {
    const raw = document.getElementById('edit_skills')?.value || '';
    data.skills = raw.split(',').map(s => s.trim()).filter(Boolean);
  } else if (currentEditSection === 'experience') {
    const entries = document.querySelectorAll('.exp-entry');
    data.experience = Array.from(entries).map(el => ({
      title: el.querySelector('.exp-title')?.value || '',
      company: el.querySelector('.exp-company')?.value || '',
      period: el.querySelector('.exp-period')?.value || '',
      description: el.querySelector('.exp-desc')?.value || ''
    })).filter(e => e.title);
  }
  try {
    await fetch('/api/profile/update', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(data)
    });
    closeEditModal();
    // Reload profile
    const r = await fetch(`/api/user/${profileUser.id}`);
    profileUser = await r.json();
    renderProfileHeader();
    renderProfileBody();
  } catch {}
}

function closeEditModal() {
  document.getElementById('editModal').classList.add('hidden');
}

// ─── PHOTO UPLOAD ─────────────────────────────────────────────────────────────

async function uploadPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('photo', file);
  try {
    const r = await fetch('/api/profile/photo', { method: 'POST', body: fd });
    const d = await r.json();
    if (d.url) {
      document.getElementById('profileAvatar').src = d.url;
      document.getElementById('navAvatar') && (document.getElementById('navAvatar').src = d.url);
    }
  } catch {}
}

// ─── ENDORSEMENTS ────────────────────────────────────────────────────────────

async function endorseSkill(uid, skill, btn) {
  try {
    await fetch('/api/endorse', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({user_id: uid, skill})
    });
    // Refresh
    const r = await fetch(`/api/user/${uid}`);
    profileUser = await r.json();
    renderProfileBody();
  } catch {}
}

// ─── RECOMMENDATIONS ─────────────────────────────────────────────────────────

function openRecModal() {
  document.getElementById('recModal').classList.remove('hidden');
}

async function submitRec() {
  const text = document.getElementById('recText').value.trim();
  if (!text) return;
  try {
    await fetch('/api/recommend', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({user_id: profileUser.id, text})
    });
    document.getElementById('recModal').classList.add('hidden');
    document.getElementById('recText').value = '';
    // Reload
    const r = await fetch(`/api/user/${profileUser.id}`);
    profileUser = await r.json();
    renderProfileBody();
  } catch {}
}

document.addEventListener('DOMContentLoaded', initProfile);