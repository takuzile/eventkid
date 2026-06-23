const STATUS = {
  draft:  { label: '下書き', cls: 'badge-draft' },
  open:   { label: '受付中', cls: 'badge-open' },
  closed: { label: '締切',   cls: 'badge-closed' },
};

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { location.href = '/auth/line'; return null; }
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
  return data;
}

async function init() {
  const me = await fetch('/auth/me').then(r => r.ok ? r.json() : null);
  if (!me) { document.getElementById('login-view').hidden = false; return; }

  document.getElementById('user-name').textContent = me.displayName;
  document.getElementById('app-view').hidden = false;
  document.getElementById('logout-btn').onclick = async () => {
    await fetch('/auth/logout', { method: 'POST' });
    location.reload();
  };
  loadEvents();
}

async function loadEvents() {
  const events = await apiFetch('/api/events');
  if (!events) return;
  const list = document.getElementById('event-list');
  const empty = document.getElementById('empty-msg');
  if (!events.length) { list.innerHTML = ''; empty.hidden = false; return; }
  empty.hidden = true;
  list.innerHTML = events.map(e => {
    const s = STATUS[e.status] || STATUS.draft;
    const desc = e.description ? `<div class="event-card-desc">${esc(e.description)}</div>` : '';
    return `
    <div class="event-card" onclick="location.href='/admin/event.html?id=${e.id}'">
      <span class="badge ${s.cls}">${s.label}</span>
      <div class="event-card-name">${esc(e.name)}</div>
      ${desc}
      <div class="event-card-meta">
        <span>参加者 ${e.participant_count ?? 0}名</span>
        <span>未回答 ${e.unresponded_count ?? 0}名</span>
        <span>${new Date(e.created_at).toLocaleDateString('ja-JP')}</span>
      </div>
    </div>`;
  }).join('');
}

function openCreate() {
  document.getElementById('create-overlay').classList.add('open');
}
function closeCreate() {
  document.getElementById('create-overlay').classList.remove('open');
  document.getElementById('create-form').reset();
  document.getElementById('seg-toggle').classList.remove('on');
}
function onOverlayClick(e) {
  if (e.target === e.currentTarget) closeCreate();
}

async function submitCreate(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const segmented = document.getElementById('seg-toggle').classList.contains('on');
  try {
    const event = await apiFetch('/api/events', {
      method: 'POST',
      body: {
        name: fd.get('name'),
        description: fd.get('description') || null,
        segmented,
      },
    });
    if (!event) return;
    closeCreate();
    location.href = `/admin/event.html?id=${event.id}`;
  } catch (e) { alert(e.message); }
}

init();
