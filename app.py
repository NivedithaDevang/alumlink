from flask import Flask, render_template, request, jsonify, session, redirect, url_for, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import json, os, uuid, datetime, re, secrets, string
from functools import wraps

app = Flask(__name__)
app.secret_key = 'amc_alumlink_secret_2024'
app.config['UPLOAD_FOLDER'] = 'static/uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

os.makedirs('static/uploads', exist_ok=True)
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

# ─── DATA HELPERS ────────────────────────────────────────────────────────────

def load(name):
    path = f'data/{name}.json'
    if not os.path.exists(path):
        return [] if name != 'messages' else {}
    with open(path) as f:
        try: return json.load(f)
        except: return [] if name != 'messages' else {}

def save(name, data):
    with open(f'data/{name}.json', 'w') as f:
        json.dump(data, f, indent=2, default=str)

def now():
    return datetime.datetime.now().isoformat()

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated

def get_user(uid):
    users = load('users')
    return next((u for u in users if u['id'] == uid), None)

def get_user_safe(uid):
    u = get_user(uid)
    if not u: return None
    return {k: v for k, v in u.items() if k != 'password'}

def generate_reset_token():
    """Generate a secure reset token"""
    return secrets.token_urlsafe(32)

def get_user_by_email(email):
    """Get user by email address"""
    users = load('users')
    return next((u for u in users if u['email'].lower() == email.lower()), None)

def is_reset_token_valid(user, token):
    """Check if reset token is valid and not expired"""
    if not user.get('reset_token') or user['reset_token'] != token:
        return False
    if not user.get('reset_token_expiry'):
        return False
    expiry = datetime.datetime.fromisoformat(user['reset_token_expiry'])
    return datetime.datetime.now() < expiry

# ─── AUTH ROUTES ─────────────────────────────────────────────────────────────

@app.route('/')
def index():
    if 'user_id' in session:
        return redirect('/feed')
    return redirect('/login')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        return render_template('login.html')
    data = request.get_json()
    users = load('users')
    user = next((u for u in users if u['email'] == data.get('email')), None)
    if not user or not check_password_hash(user['password'], data.get('password', '')):
        return jsonify({'error': 'Invalid credentials'}), 401
    if user.get('banned'):
        return jsonify({'error': 'Account suspended. Contact admin.'}), 403
    session['user_id'] = user['id']
    session['role'] = user['role']
    return jsonify({'success': True, 'role': user['role']})

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'GET':
        return render_template('register.html')
    data = request.get_json()
    users = load('users')
    if any(u['email'] == data.get('email') for u in users):
        return jsonify({'error': 'Email already registered'}), 400
    role = data.get('role', 'student')
    if role not in ['student', 'alumni']:
        return jsonify({'error': 'Invalid role'}), 400
    uid = str(uuid.uuid4())
    user = {
        'id': uid,
        'email': data['email'],
        'password': generate_password_hash(data['password']),
        'role': role,
        'name': data.get('name', ''),
        'profile_photo': '',
        'bio': '',
        'skills': [],
        'created_at': now(),
        'banned': False,
        'visibility': 'public',
        'saved_posts': [],
        'endorsements': {},
        'recommendations': []
    }
    if role == 'student':
        user.update({'usn': data.get('usn',''), 'dept': data.get('dept',''),
                     'sem': data.get('sem',''), 'dob': data.get('dob','')})
    else:
        user.update({'company': data.get('company',''), 'designation': data.get('designation',''),
                     'batch': data.get('batch',''), 'dept': data.get('dept',''),
                     'location': data.get('location',''), 'experience': []})
    users.append(user)
    save('users', users)
    session['user_id'] = uid
    session['role'] = role
    return jsonify({'success': True})

@app.route('/logout')
def logout():
    session.clear()
    return redirect('/login')

@app.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    if request.method == 'GET':
        return render_template('forgot-password.html')
    data = request.get_json()
    email = data.get('email', '').strip()
    user = get_user_by_email(email)
    if not user:
        return jsonify({'message': 'If an account exists with this email, a reset link has been sent.'}), 200
    
    # Generate reset token (valid for 1 hour)
    reset_token = generate_reset_token()
    reset_expiry = (datetime.datetime.now() + datetime.timedelta(hours=1)).isoformat()
    
    users = load('users')
    for u in users:
        if u['id'] == user['id']:
            u['reset_token'] = reset_token
            u['reset_token_expiry'] = reset_expiry
            break
    save('users', users)
    
    # In a real app, send this via email. For now, return the token to display.
    reset_url = f"{request.host_url}reset-password/{reset_token}"
    return jsonify({'message': 'Reset link sent', 'reset_url': reset_url}), 200

@app.route('/reset-password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    if request.method == 'GET':
        # Check if token is valid before showing form
        users = load('users')
        user = next((u for u in users if u.get('reset_token') == token), None)
        if not user or not is_reset_token_valid(user, token):
            return render_template('reset-password.html', error='Invalid or expired reset link', token=None)
        return render_template('reset-password.html', token=token)
    
    data = request.get_json()
    new_password = data.get('password', '').strip()
    
    if len(new_password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    
    users = load('users')
    user = next((u for u in users if u.get('reset_token') == token), None)
    
    if not user:
        return jsonify({'error': 'Invalid reset link'}), 400
    
    if not is_reset_token_valid(user, token):
        return jsonify({'error': 'Reset link has expired'}), 400
    
    # Update password and clear reset token
    for u in users:
        if u['id'] == user['id']:
            u['password'] = generate_password_hash(new_password)
            u['reset_token'] = None
            u['reset_token_expiry'] = None
            break
    save('users', users)
    
    return jsonify({'success': True, 'message': 'Password reset successfully'}), 200

# ─── PAGES ───────────────────────────────────────────────────────────────────

@app.route('/feed')
@login_required
def feed():
    return render_template('feed.html')

@app.route('/profile')
@login_required
def profile_self():
    return render_template('profile.html')

@app.route('/profile/<uid>')
@login_required
def profile_view(uid):
    return render_template('profile.html', view_uid=uid)

@app.route('/messages')
@login_required
def messages_page():
    return render_template('messages.html')

@app.route('/network')
@login_required
def network_page():
    return render_template('network.html')

@app.route('/notifications')
@login_required
def notifications_page():
    return render_template('notifications.html')

@app.route('/search')
@login_required
def search_page():
    return render_template('search.html')

@app.route('/admin')
@login_required
def admin_page():
    if session.get('role') != 'admin':
        return redirect('/feed')
    return render_template('admin.html')

@app.route('/saved')
@login_required
def saved_page():
    return render_template('saved.html')

# ─── API: USER ────────────────────────────────────────────────────────────────

@app.route('/api/me')
@login_required
def api_me():
    u = get_user_safe(session['user_id'])
    return jsonify(u)

@app.route('/api/user/<uid>')
@login_required
def api_user(uid):
    u = get_user_safe(uid)
    if not u: return jsonify({'error': 'Not found'}), 404
    return jsonify(u)

@app.route('/api/profile/update', methods=['POST'])
@login_required
def update_profile():
    data = request.get_json()
    users = load('users')
    for u in users:
        if u['id'] == session['user_id']:
            allowed = ['name','bio','skills','company','designation','batch','dept',
                       'sem','usn','dob','location','experience','visibility']
            for k in allowed:
                if k in data: u[k] = data[k]
            break
    save('users', users)
    return jsonify({'success': True})

@app.route('/api/profile/photo', methods=['POST'])
@login_required
def upload_photo():
    if 'photo' not in request.files:
        return jsonify({'error': 'No file'}), 400
    file = request.files['photo']
    if file and allowed_file(file.filename):
        ext = file.filename.rsplit('.', 1)[1].lower()
        filename = f"{session['user_id']}.{ext}"
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        url = f'/static/uploads/{filename}'
        users = load('users')
        for u in users:
            if u['id'] == session['user_id']:
                u['profile_photo'] = url
                break
        save('users', users)
        return jsonify({'url': url})
    return jsonify({'error': 'Invalid file'}), 400

@app.route('/api/users/search')
@login_required
def search_users():
    q = request.args.get('q', '').lower()
    role = request.args.get('role', '')
    dept = request.args.get('dept', '')
    batch = request.args.get('batch', '')
    skill = request.args.get('skill', '').lower()
    users = load('users')
    results = []
    for u in users:
        if u['id'] == session['user_id']: continue
        if u.get('banned'): continue
        if role and u['role'] != role: continue
        if dept and u.get('dept', '').lower() != dept.lower(): continue
        if batch and u.get('batch', '') != batch: continue
        if skill and not any(skill in s.lower() for s in u.get('skills', [])): continue
        if q and q not in u.get('name', '').lower() and q not in u.get('email', '').lower(): continue
        safe = {k: v for k, v in u.items() if k != 'password'}
        results.append(safe)
    return jsonify(results)

@app.route('/api/users/suggestions')
@login_required
def suggestions():
    me = get_user(session['user_id'])
    users = load('users')
    conns = load('connections')
    connected_ids = set()
    for c in conns:
        if c['status'] == 'accepted':
            if c['from'] == session['user_id']: connected_ids.add(c['to'])
            if c['to'] == session['user_id']: connected_ids.add(c['from'])
    results = []
    for u in users:
        if u['id'] == session['user_id']: continue
        if u['id'] in connected_ids: continue
        if u.get('banned'): continue
        score = 0
        if u.get('dept') == me.get('dept'): score += 2
        if set(u.get('skills', [])) & set(me.get('skills', [])): score += 1
        safe = {k: v for k, v in u.items() if k != 'password'}
        safe['score'] = score
        results.append(safe)
    results.sort(key=lambda x: -x['score'])
    return jsonify(results[:10])

# ─── API: POSTS ───────────────────────────────────────────────────────────────

@app.route('/api/posts', methods=['GET'])
@login_required
def get_posts():
    posts = load('posts')
    users = load('users')
    ptype = request.args.get('type', '')
    uid = request.args.get('user', '')
    user_map = {u['id']: {'name': u.get('name',''), 'photo': u.get('profile_photo',''),
                           'role': u['role'], 'dept': u.get('dept','')} for u in users}
    result = []
    for p in reversed(posts):
        if ptype and p.get('type') != ptype: continue
        if uid and p.get('author') != uid: continue
        p2 = dict(p)
        p2['author_info'] = user_map.get(p['author'], {})
        p2['liked'] = session['user_id'] in p.get('likes', [])
        result.append(p2)
    return jsonify(result)

@app.route('/api/posts', methods=['POST'])
@login_required
def create_post():
    data = request.get_json()
    posts = load('posts')
    post = {
        'id': str(uuid.uuid4()),
        'author': session['user_id'],
        'type': data.get('type', 'general'),
        'title': data.get('title', ''),
        'content': data.get('content', ''),
        'tags': data.get('tags', []),
        'likes': [],
        'comments': [],
        'created_at': now(),
        'edited': False
    }
    posts.append(post)
    save('posts', posts)
    return jsonify(post)

@app.route('/api/posts/<pid>', methods=['PUT'])
@login_required
def edit_post(pid):
    data = request.get_json()
    posts = load('posts')
    for p in posts:
        if p['id'] == pid and p['author'] == session['user_id']:
            p['title'] = data.get('title', p['title'])
            p['content'] = data.get('content', p['content'])
            p['type'] = data.get('type', p['type'])
            p['tags'] = data.get('tags', p['tags'])
            p['edited'] = True
            save('posts', posts)
            return jsonify(p)
    return jsonify({'error': 'Not found or unauthorized'}), 404

@app.route('/api/posts/<pid>', methods=['DELETE'])
@login_required
def delete_post(pid):
    posts = load('posts')
    me = get_user(session['user_id'])
    posts = [p for p in posts if not (p['id'] == pid and (p['author'] == session['user_id'] or me['role'] == 'admin'))]
    save('posts', posts)
    return jsonify({'success': True})

@app.route('/api/posts/<pid>/like', methods=['POST'])
@login_required
def like_post(pid):
    posts = load('posts')
    for p in posts:
        if p['id'] == pid:
            if session['user_id'] in p['likes']:
                p['likes'].remove(session['user_id'])
                liked = False
            else:
                p['likes'].append(session['user_id'])
                liked = True
                _notify(p['author'], session['user_id'], 'like', f'liked your post', pid)
            save('posts', posts)
            return jsonify({'liked': liked, 'count': len(p['likes'])})
    return jsonify({'error': 'Not found'}), 404

@app.route('/api/posts/<pid>/comment', methods=['POST'])
@login_required
def comment_post(pid):
    data = request.get_json()
    posts = load('posts')
    me = get_user_safe(session['user_id'])
    for p in posts:
        if p['id'] == pid:
            comment = {
                'id': str(uuid.uuid4()),
                'author': session['user_id'],
                'author_name': me.get('name', ''),
                'author_photo': me.get('profile_photo', ''),
                'content': data.get('content', ''),
                'created_at': now()
            }
            p['comments'].append(comment)
            _notify(p['author'], session['user_id'], 'comment', 'commented on your post', pid)
            save('posts', posts)
            return jsonify(comment)
    return jsonify({'error': 'Not found'}), 404

@app.route('/api/posts/<pid>/save', methods=['POST'])
@login_required
def save_post(pid):
    users = load('users')
    for u in users:
        if u['id'] == session['user_id']:
            saved = u.get('saved_posts', [])
            if pid in saved:
                saved.remove(pid)
                msg = 'unsaved'
            else:
                saved.append(pid)
                msg = 'saved'
            u['saved_posts'] = saved
            save('users', users)
            return jsonify({'status': msg})
    return jsonify({'error': 'Error'}), 400

# ─── API: CONNECTIONS ─────────────────────────────────────────────────────────

@app.route('/api/connections/request', methods=['POST'])
@login_required
def send_request():
    data = request.get_json()
    to_id = data.get('to')
    conns = load('connections')
    exists = any(
        (c['from'] == session['user_id'] and c['to'] == to_id) or
        (c['from'] == to_id and c['to'] == session['user_id'])
        for c in conns
    )
    if exists:
        return jsonify({'error': 'Request already exists'}), 400
    conn = {'id': str(uuid.uuid4()), 'from': session['user_id'], 'to': to_id,
            'status': 'pending', 'created_at': now()}
    conns.append(conn)
    save('connections', conns)
    me = get_user_safe(session['user_id'])
    _notify(to_id, session['user_id'], 'connection', f'{me["name"]} sent you a connection request', conn['id'])
    return jsonify(conn)

@app.route('/api/connections/respond', methods=['POST'])
@login_required
def respond_request():
    data = request.get_json()
    cid = data.get('id')
    action = data.get('action')
    conns = load('connections')
    for c in conns:
        if c['id'] == cid and c['to'] == session['user_id']:
            c['status'] = 'accepted' if action == 'accept' else 'rejected'
            save('connections', conns)
            if action == 'accept':
                me = get_user_safe(session['user_id'])
                _notify(c['from'], session['user_id'], 'connection_accepted',
                        f'{me["name"]} accepted your connection request', cid)
            return jsonify(c)
    return jsonify({'error': 'Not found'}), 404

@app.route('/api/connections/remove', methods=['POST'])
@login_required
def remove_connection():
    data = request.get_json()
    uid = data.get('uid')
    conns = load('connections')
    conns = [c for c in conns if not (
        (c['from'] == session['user_id'] and c['to'] == uid) or
        (c['from'] == uid and c['to'] == session['user_id'])
    )]
    save('connections', conns)
    return jsonify({'success': True})

@app.route('/api/connections/status/<uid>')
@login_required
def connection_status(uid):
    conns = load('connections')
    for c in conns:
        if (c['from'] == session['user_id'] and c['to'] == uid) or \
           (c['from'] == uid and c['to'] == session['user_id']):
            return jsonify({'status': c['status'], 'id': c['id'],
                            'direction': 'sent' if c['from'] == session['user_id'] else 'received'})
    return jsonify({'status': 'none'})

@app.route('/api/connections/mine')
@login_required
def my_connections():
    conns = load('connections')
    result = {'connections': [], 'pending_sent': [], 'pending_received': []}
    for c in conns:
        if c['status'] == 'accepted':
            other = c['to'] if c['from'] == session['user_id'] else c['from'] if c['to'] == session['user_id'] else None
            if other:
                u = get_user_safe(other)
                if u: result['connections'].append(u)
        elif c['status'] == 'pending':
            if c['from'] == session['user_id']:
                u = get_user_safe(c['to'])
                if u: result['pending_sent'].append({**u, 'conn_id': c['id']})
            elif c['to'] == session['user_id']:
                u = get_user_safe(c['from'])
                if u: result['pending_received'].append({**u, 'conn_id': c['id']})
    return jsonify(result)

# ─── API: MESSAGES ────────────────────────────────────────────────────────────

@app.route('/api/messages/conversations')
@login_required
def get_conversations():
    me_id = session['user_id']
    messages_data = load('messages')
    conns = load('connections')
    users = load('users')

    # Build connected IDs set
    connected_ids = set()
    for c in conns:
        if c['status'] == 'accepted':
            if c['from'] == me_id: connected_ids.add(c['to'])
            if c['to'] == me_id: connected_ids.add(c['from'])

    seen = set()
    convs = []

    # 1. Add all existing message threads (regardless of connection status)
    for key, msgs in messages_data.items():
        parts = key.split('_')
        if len(parts) != 2: continue
        if me_id not in parts: continue
        other_id = parts[0] if parts[1] == me_id else parts[1]
        if other_id == me_id: continue
        other = get_user_safe(other_id)
        if not other: continue
        last = msgs[-1] if msgs else {}
        unread = sum(1 for m in msgs if m.get('to') == me_id and not m.get('read'))
        convs.append({'user': other, 'last_message': last, 'unread': unread})
        seen.add(other_id)

    # 2. Add accepted connections with no messages yet
    for uid in connected_ids:
        if uid in seen: continue
        other = get_user_safe(uid)
        if not other: continue
        convs.append({'user': other, 'last_message': {}, 'unread': 0})
        seen.add(uid)

    # Sort by most recent message
    def sort_key(c):
        lm = c.get('last_message') or {}
        return lm.get('created_at', '') if isinstance(lm, dict) else ''
    convs.sort(key=sort_key, reverse=True)
    return jsonify(convs)

@app.route('/api/messages/<uid>')
@login_required
def get_messages(uid):
    me_id = session['user_id']
    messages = load('messages')
    key = '_'.join(sorted([me_id, uid]))
    msgs = messages.get(key, [])
    # Mark received messages as read
    changed = False
    for m in msgs:
        if m.get('to') == me_id and not m.get('read'):
            m['read'] = True
            changed = True
    if changed:
        save('messages', messages)
    return jsonify(msgs)

@app.route('/api/messages/request', methods=['POST'])
@login_required
def message_request():
    data = request.get_json()
    to_id = data.get('to')
    conns = load('connections')
    connected = any(
        c['status'] == 'accepted' and (
            (c['from'] == session['user_id'] and c['to'] == to_id) or
            (c['from'] == to_id and c['to'] == session['user_id'])
        ) for c in conns
    )
    if not connected:
        return jsonify({'error': 'Must be connected to message'}), 403
    return jsonify({'allowed': True})

# ─── API: NOTIFICATIONS ───────────────────────────────────────────────────────

def _notify(to_id, from_id, ntype, message, ref_id=''):
    if to_id == from_id: return
    notifs = load('notifications')
    notifs.append({'id': str(uuid.uuid4()), 'to': to_id, 'from': from_id,
                   'type': ntype, 'message': message, 'ref_id': ref_id,
                   'read': False, 'created_at': now()})
    save('notifications', notifs)

@app.route('/api/notifications')
@login_required
def get_notifications():
    notifs = load('notifications')
    mine = [n for n in reversed(notifs) if n['to'] == session['user_id']]
    for n in mine:
        u = get_user_safe(n['from'])
        n['from_info'] = {'name': u.get('name',''), 'photo': u.get('profile_photo','')} if u else {}
    return jsonify(mine)

@app.route('/api/notifications/read', methods=['POST'])
@login_required
def mark_read():
    notifs = load('notifications')
    for n in notifs:
        if n['to'] == session['user_id']: n['read'] = True
    save('notifications', notifs)
    return jsonify({'success': True})

@app.route('/api/notifications/count')
@login_required
def notif_count():
    notifs = load('notifications')
    count = sum(1 for n in notifs if n['to'] == session['user_id'] and not n['read'])
    return jsonify({'count': count})

# ─── API: ENDORSEMENTS & RECOMMENDATIONS ─────────────────────────────────────

@app.route('/api/endorse', methods=['POST'])
@login_required
def endorse():
    data = request.get_json()
    uid = data.get('user_id')
    skill = data.get('skill')
    users = load('users')
    for u in users:
        if u['id'] == uid:
            if 'endorsements' not in u: u['endorsements'] = {}
            if skill not in u['endorsements']: u['endorsements'][skill] = []
            if session['user_id'] not in u['endorsements'][skill]:
                u['endorsements'][skill].append(session['user_id'])
            save('users', users)
            return jsonify({'success': True})
    return jsonify({'error': 'User not found'}), 404

@app.route('/api/recommend', methods=['POST'])
@login_required
def recommend():
    data = request.get_json()
    uid = data.get('user_id')
    text = data.get('text', '')
    users = load('users')
    me = get_user_safe(session['user_id'])
    for u in users:
        if u['id'] == uid:
            if 'recommendations' not in u: u['recommendations'] = []
            u['recommendations'].append({
                'from': session['user_id'],
                'from_name': me.get('name',''),
                'from_photo': me.get('profile_photo',''),
                'text': text,
                'created_at': now()
            })
            save('users', users)
            _notify(uid, session['user_id'], 'recommendation', f'{me["name"]} wrote you a recommendation')
            return jsonify({'success': True})
    return jsonify({'error': 'User not found'}), 404

# ─── API: ADMIN ───────────────────────────────────────────────────────────────

@app.route('/api/admin/report', methods=['POST'])
@login_required
def report_user():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.get_json()
    reports = load('reports')
    reports.append({
        'id': str(uuid.uuid4()),
        'reporter': session['user_id'],
        'reported_user': data.get('user_id'),
        'reason': data.get('reason', ''),
        'created_at': now(),
        'resolved': False
    })
    save('reports', reports)
    return jsonify({'success': True})

@app.route('/api/admin/ban', methods=['POST'])
@login_required
def ban_user():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.get_json()
    users = load('users')
    for u in users:
        if u['id'] == data.get('user_id'):
            u['banned'] = data.get('banned', True)
            save('users', users)
            return jsonify({'success': True})
    return jsonify({'error': 'Not found'}), 404

@app.route('/api/admin/users')
@login_required
def admin_users():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    users = load('users')
    reports = load('reports')
    report_counts = {}
    for r in reports:
        uid = r['reported_user']
        report_counts[uid] = report_counts.get(uid, 0) + 1
    result = [{**{k: v for k, v in u.items() if k != 'password'},
               'report_count': report_counts.get(u['id'], 0)} for u in users]
    return jsonify(result)

@app.route('/api/admin/reports')
@login_required
def admin_reports():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    reports = load('reports')
    for r in reports:
        r['reporter_info'] = get_user_safe(r['reporter'])
        r['reported_info'] = get_user_safe(r['reported_user'])
    return jsonify(reports)

@app.route('/api/admin/delete_post', methods=['POST'])
@login_required
def admin_delete_post():
    if session.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.get_json()
    posts = load('posts')
    posts = [p for p in posts if p['id'] != data.get('post_id')]
    save('posts', posts)
    return jsonify({'success': True})

@app.route('/api/admin/create', methods=['POST'])
@login_required
def create_admin():
    # Only allow first admin creation or existing admin
    if session.get('role') != 'admin':
        users = load('users')
        if any(u['role'] == 'admin' for u in users):
            return jsonify({'error': 'Unauthorized'}), 403
    data = request.get_json()
    users = load('users')
    if any(u['email'] == data.get('email') for u in users):
        return jsonify({'error': 'Email already exists'}), 400
    uid = str(uuid.uuid4())
    users.append({
        'id': uid, 'email': data['email'],
        'password': generate_password_hash(data['password']),
        'role': 'admin', 'name': data.get('name', 'Admin'),
        'profile_photo': '', 'bio': '', 'skills': [],
        'created_at': now(), 'banned': False,
        'dept': data.get('dept', ''), 'faculty_id': data.get('faculty_id', '')
    })
    save('users', users)
    return jsonify({'success': True})

# ─── SAVED POSTS ─────────────────────────────────────────────────────────────

@app.route('/api/saved_posts')
@login_required
def get_saved():
    me = get_user(session['user_id'])
    saved_ids = me.get('saved_posts', [])
    posts = load('posts')
    users = load('users')
    user_map = {u['id']: {'name': u.get('name',''), 'photo': u.get('profile_photo',''), 'role': u['role']} for u in users}
    result = []
    for p in posts:
        if p['id'] in saved_ids:
            p2 = dict(p)
            p2['author_info'] = user_map.get(p['author'], {})
            p2['liked'] = session['user_id'] in p.get('likes', [])
            result.append(p2)
    return jsonify(result)


@app.route('/api/messages/send', methods=['POST'])
@login_required
def send_message_http():
    data = request.get_json() or {}
    to_id = data.get('to', '').strip()
    content = (data.get('content') or '').strip()
    from_id = session['user_id']
    if not content:
        return jsonify({'error': 'Message cannot be empty'}), 400
    if not to_id:
        return jsonify({'error': 'Recipient required'}), 400
    if to_id == from_id:
        return jsonify({'error': 'Cannot message yourself'}), 400
    # Verify recipient exists
    recipient = get_user(to_id)
    if not recipient:
        return jsonify({'error': 'User not found'}), 404
    room = '_'.join(sorted([from_id, to_id]))
    messages = load('messages')
    msg = {
        'id': str(uuid.uuid4()),
        'from': from_id,
        'to': to_id,
        'content': content,
        'read': False,
        'created_at': now()
    }
    if room not in messages:
        messages[room] = []
    messages[room].append(msg)
    save('messages', messages)
    me = get_user_safe(from_id)
    sender_name = me.get('name', 'Someone') if me else 'Someone'
    _notify(to_id, from_id, 'message', sender_name + ' sent you a message')
    msg['sender_info'] = {
        'name': me.get('name', '') if me else '',
        'photo': me.get('profile_photo', '') if me else ''
    }
    try:
        socketio.emit('new_message', msg, room=room)
    except Exception:
        pass
    return jsonify(msg)


@app.route('/api/debug/messages')
@login_required  
def debug_messages():
    me_id = session['user_id']
    conns = load('connections')
    users = load('users')
    messages = load('messages')
    accepted = [c for c in conns if c['status'] == 'accepted' and (c['from'] == me_id or c['to'] == me_id)]
    pending = [c for c in conns if c['status'] == 'pending' and (c['from'] == me_id or c['to'] == me_id)]
    all_users = [{'id': u['id'], 'name': u.get('name',''), 'role': u['role']} for u in users if u['id'] != me_id]
    return jsonify({
        'my_id': me_id,
        'total_users': len(users),
        'other_users': all_users,
        'accepted_connections': len(accepted),
        'pending_connections': len(pending),
        'message_threads': list(messages.keys()),
        'connections_raw': accepted
    })

# ─── SOCKET.IO ────────────────────────────────────────────────────────────────

# Map socket session id -> user_id
sid_user_map = {}

@socketio.on('connect')
def on_connect():
    uid = session.get('user_id')
    if uid:
        sid_user_map[request.sid] = uid
        join_room(uid)

@socketio.on('disconnect')
def on_disconnect():
    sid_user_map.pop(request.sid, None)

@socketio.on('join')
def on_join(data):
    room = data.get('room')
    if room:
        join_room(room)
    # Also register user
    uid = session.get('user_id')
    if uid:
        sid_user_map[request.sid] = uid

@socketio.on('send_message')
def handle_message(data):
    from_id = session.get('user_id') or sid_user_map.get(request.sid)
    to_id = data.get('to')
    content = data.get('content', '').strip()
    if not content or not to_id or not from_id: return
    room = '_'.join(sorted([from_id, to_id]))
    messages = load('messages')
    msg = {'id': str(uuid.uuid4()), 'from': from_id, 'to': to_id,
           'content': content, 'read': False, 'created_at': now()}
    if room not in messages: messages[room] = []
    messages[room].append(msg)
    save('messages', messages)
    me = get_user_safe(from_id)
    msg['sender_info'] = {'name': me.get('name','') if me else '', 'photo': me.get('profile_photo','') if me else ''}
    emit('new_message', msg, room=room)
    if me:
        _notify(to_id, from_id, 'message', f'{me["name"]} sent you a message')

@socketio.on('typing')
def handle_typing(data):
    from_id = session.get('user_id') or sid_user_map.get(request.sid)
    room = data.get('room')
    if room:
        emit('typing', {'from': from_id}, room=room, include_self=False)

if __name__ == '__main__':
    # Create default admin
    users = load('users')
    if not any(u['role'] == 'admin' for u in users):
        users.append({
            'id': str(uuid.uuid4()), 'email': 'admin@amc.edu',
            'password': generate_password_hash('admin123'),
            'role': 'admin', 'name': 'AMC Admin', 'profile_photo': '',
            'bio': 'Administrative Management College Faculty',
            'skills': [], 'created_at': now(), 'banned': False,
            'dept': 'Administration', 'faculty_id': 'FAC001'
        })
        save('users', users)
        print("Default admin created: admin@amc.edu / admin123")
    socketio.run(app, debug=True, port=5000)