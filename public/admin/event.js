const eventId = new URLSearchParams(location.search).get('id');
if (!eventId) location.href = '/admin/';

const STATUS = {
  draft:  { label: '下書き', cls: 'badge-draft' },
  open:   { label: '受付中', cls: 'badge-open' },
  closed: { label: '締切',   cls: 'badge-closed' },
};
const FT_LABEL = { text:'テキスト', select:'選択（単一）', multiselect:'選択（複数）', number:'数値', bool:'はい/いいえ', date:'日付' };

let currentEvent = null;
let liffId = null;

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
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

// ── Overlay ────────────────────────────────────────────────────────────────

function openOverlay(id) { document.getElementById(id).classList.add('open'); }
function closeOverlay(id) { document.getElementById(id).classList.remove('open'); }
function onOverlay(e, id) { if (e.target === e.currentTarget) closeOverlay(id); }

// ── Event ──────────────────────────────────────────────────────────────────

async function loadEvent() {
  currentEvent = await apiFetch(`/api/events/${eventId}`);
  if (!currentEvent) return;
  const s = STATUS[currentEvent.status] || STATUS.draft;
  document.getElementById('topbar-title').textContent = currentEvent.name;
  document.getElementById('topbar-badge').innerHTML = `<span class="badge ${s.cls}">${s.label}</span>`;
  document.getElementById('event-desc').textContent = currentEvent.description || '';
  document.title = currentEvent.name + ' — EventKit';
  document.getElementById('liff-url-display').textContent =
    `https://liff.line.me/${liffId}?event_id=${eventId}`;
}

function openEditSheet() {
  if (!currentEvent) return;
  const f = document.getElementById('edit-form');
  f.name.value = currentEvent.name;
  f.description.value = currentEvent.description || '';
  openOverlay('edit-overlay');
}

async function submitEdit(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  try {
    await apiFetch(`/api/events/${eventId}`, {
      method: 'PUT',
      body: { name: fd.get('name'), description: fd.get('description') || null },
    });
    closeOverlay('edit-overlay');
    loadEvent();
  } catch (e) { alert(e.message); }
}

async function changeStatus(status) {
  const label = STATUS[status]?.label || status;
  if (!confirm(`ステータスを「${label}」に変更しますか？`)) return;
  try {
    await apiFetch(`/api/events/${eventId}`, { method: 'PUT', body: { status } });
    loadEvent();
  } catch (e) { alert(e.message); }
}

async function deleteEvent() {
  if (!confirm(`「${currentEvent?.name}」を削除しますか？この操作は取り消せません。`)) return;
  try {
    await apiFetch(`/api/events/${eventId}`, { method: 'DELETE' });
    location.href = '/admin/';
  } catch (e) { alert(e.message); }
}

function copyLiffUrl() {
  const text = document.getElementById('liff-url-display').textContent;
  navigator.clipboard.writeText(text).then(() => alert('コピーしました'));
}

// ── Segments ────────────────────────────────────────────────────────────────

async function loadSegments() {
  const segs = await apiFetch(`/api/events/${eventId}/segments`);
  if (!segs) return;
  const el = document.getElementById('seg-list');
  if (!segs.length) { el.innerHTML = '<div class="empty-msg">区間がありません</div>'; return; }
  el.innerHTML = segs.map(s => `
    <div class="list-item">
      <div class="list-item-main">
        <div class="list-item-title">${esc(s.name)}</div>
        <div class="list-item-sub">${[fmtDt(s.starts_at), fmtDt(s.ends_at)].filter(Boolean).join(' — ') || '日時未設定'}</div>
      </div>
      <div class="list-actions">
        <button class="btn btn-ghost" style="font-size:12px;padding:.3rem .7rem" onclick="openSegSheet(${s.id})">編集</button>
        <button class="btn btn-danger" style="font-size:12px;padding:.3rem .7rem" onclick="deleteSeg(${s.id})">削除</button>
      </div>
    </div>`).join('');
}

function openSegSheet(segId) {
  const f = document.getElementById('seg-form');
  f.reset();
  f.segId.value = segId || '';
  document.getElementById('seg-sheet-title').textContent = segId ? '区間を編集' : '区間を追加';
  openOverlay('seg-overlay');
}

async function submitSeg(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const segId = fd.get('segId');
  const body = {
    name: fd.get('name'),
    starts_at: fd.get('starts_at') || null,
    ends_at: fd.get('ends_at') || null,
    sort_order: parseInt(fd.get('sort_order') || '0', 10),
  };
  try {
    if (segId) await apiFetch(`/api/events/${eventId}/segments/${segId}`, { method: 'PUT', body });
    else       await apiFetch(`/api/events/${eventId}/segments`, { method: 'POST', body });
    closeOverlay('seg-overlay');
    loadSegments();
  } catch (e) { alert(e.message); }
}

async function deleteSeg(segId) {
  if (!confirm('この区間を削除しますか？')) return;
  try { await apiFetch(`/api/events/${eventId}/segments/${segId}`, { method: 'DELETE' }); loadSegments(); }
  catch (e) { alert(e.message); }
}

// ── Questions ───────────────────────────────────────────────────────────────

async function loadQuestions() {
  const qs = await apiFetch(`/api/events/${eventId}/questions`);
  if (!qs) return;
  const el = document.getElementById('q-list');
  if (!qs.length) { el.innerHTML = '<div class="empty-msg">カスタム質問がありません</div>'; return; }
  el.innerHTML = qs.map(q => `
    <div class="list-item">
      <div class="list-item-main">
        <div class="list-item-title">${esc(q.label)}${q.required ? ' <span style="color:red;font-size:12px">必須</span>' : ''}</div>
        <div class="list-item-sub">${FT_LABEL[q.field_type] || q.field_type}${q.semantic ? ' · ' + q.semantic : ''}</div>
      </div>
      <div class="list-actions">
        <button class="btn btn-ghost" style="font-size:12px;padding:.3rem .7rem" onclick='openQSheet(${JSON.stringify(q)})'>編集</button>
        <button class="btn btn-danger" style="font-size:12px;padding:.3rem .7rem" onclick="deleteQ(${q.id})">削除</button>
      </div>
    </div>`).join('');
}

function onFtChange(val) {
  document.getElementById('q-options-row').style.display =
    (val === 'select' || val === 'multiselect') ? 'block' : 'none';
}

function openQSheet(q) {
  const f = document.getElementById('q-form');
  f.reset();
  document.getElementById('q-options-row').style.display = 'none';
  if (q && typeof q === 'object') {
    document.getElementById('q-sheet-title').textContent = '質問を編集';
    f.qId.value = q.id;
    f.label.value = q.label;
    f.field_type.value = q.field_type;
    f.semantic.value = q.semantic || '';
    f.sort_order.value = q.sort_order;
    f['required'].checked = q.required;
    onFtChange(q.field_type);
    if (q.options) f.options.value = q.options.join('\n');
  } else {
    document.getElementById('q-sheet-title').textContent = '質問を追加';
    f.qId.value = '';
  }
  openOverlay('q-overlay');
}

async function submitQ(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const qId = fd.get('qId');
  const ft = fd.get('field_type');
  const optRaw = fd.get('options') || '';
  const options = (ft === 'select' || ft === 'multiselect')
    ? optRaw.split('\n').map(s => s.trim()).filter(Boolean) : null;
  const body = {
    label: fd.get('label'), field_type: ft,
    semantic: fd.get('semantic') || null, options,
    required: fd.has('required'),
    sort_order: parseInt(fd.get('sort_order') || '0', 10),
  };
  try {
    if (qId) await apiFetch(`/api/events/${eventId}/questions/${qId}`, { method: 'PUT', body });
    else     await apiFetch(`/api/events/${eventId}/questions`, { method: 'POST', body });
    closeOverlay('q-overlay');
    loadQuestions();
  } catch (e) { alert(e.message); }
}

async function deleteQ(qId) {
  if (!confirm('この質問を削除しますか？')) return;
  try { await apiFetch(`/api/events/${eventId}/questions/${qId}`, { method: 'DELETE' }); loadQuestions(); }
  catch (e) { alert(e.message); }
}

// ── Participants ─────────────────────────────────────────────────────────────

async function loadParticipants() {
  const ps = await apiFetch(`/api/events/${eventId}/participants`);
  if (!ps) return;
  const participants = ps.filter(p => p.role === 'participant');
  const responded = participants.filter(p => p.responded_at).length;
  document.getElementById('stat-total').textContent = participants.length;
  document.getElementById('stat-responded').textContent = responded;
  document.getElementById('stat-unresponded').textContent = participants.length - responded;

  const el = document.getElementById('p-list');
  if (!ps.length) { el.innerHTML = '<div class="empty-msg">まだ誰も登録していません</div>'; return; }
  el.innerHTML = ps.map(p => `
    <div class="list-item">
      <div class="list-item-main">
        <div class="list-item-title">${esc(p.display_name)}${p.role === 'organizer' ? ' <span style="font-size:11px;color:var(--sub)">(幹事)</span>' : ''}</div>
        ${p.responded_at
          ? `<div class="p-responded">✓ ${fmtDt(p.responded_at)} 回答済み</div>`
          : `<div class="p-pending">未回答</div>`}
      </div>
    </div>`).join('');
}

// ── Notify ──────────────────────────────────────────────────────────────────

async function sendNotify() {
  const groupId = document.getElementById('group-id-input').value.trim();
  if (!groupId) { alert('グループ ID を入力してください'); return; }
  try {
    const r = await apiFetch(`/api/events/${eventId}/notify`, { method: 'POST', body: { group_id: groupId } });
    alert(r ? `送信しました（未回答: ${r.unresponded}名）` : '送信しました');
  } catch (e) { alert(e.message); }
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const me = await fetch('/auth/me').then(r => r.ok ? r.json() : null);
  if (!me) { location.href = '/auth/line'; return; }
  const config = await fetch('/api/config').then(r => r.json());
  liffId = config.liffId;
  await Promise.all([loadEvent(), loadSegments(), loadQuestions(), loadParticipants()]);
}

init();
