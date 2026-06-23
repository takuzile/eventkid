let eventId = new URLSearchParams(location.search).get('event_id');

let participant = null;
let segments = [];
let questions = [];
// 出欠状態: { segmentId: '出'|'欠' }
const attState = {};
// bool 状態: { questionId: boolean }
const boolState = {};

function show(id) {
  ['loading', 'error-view', 'closed-view', 'form-view', 'done-view']
    .forEach(el => { document.getElementById(el).hidden = (el !== id); });
}

function showError(msg) {
  document.getElementById('error-text').textContent = msg;
  show('error-view');
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

// ── 出欠 ───────────────────────────────────────────────────────────────────

function renderAttendance() {
  const sec = document.getElementById('att-section');
  // 既存の section-title 以降を差し替え
  const title = sec.querySelector('.section-title');
  sec.innerHTML = '';
  sec.appendChild(title);

  segments.forEach(s => {
    const subLabel = [fmtDt(s.starts_at), fmtDt(s.ends_at)].filter(Boolean).join(' — ');
    const card = document.createElement('div');
    card.className = 'att-card';
    card.innerHTML = `
      <div class="att-label">${esc(s.name)}${subLabel ? `<small>${subLabel}</small>` : ''}</div>
      <div class="att-btns">
        <button type="button" class="att-btn" data-seg="${s.id}" data-val="出" onclick="selectAtt(this)">✓ 出席</button>
        <button type="button" class="att-btn" data-seg="${s.id}" data-val="欠" onclick="selectAtt(this)">✕ 欠席</button>
      </div>`;
    if (s !== segments[segments.length - 1]) {
      card.style.borderBottom = '1px solid var(--border)';
    }
    sec.appendChild(card);
  });
}

function selectAtt(btn) {
  const segId = btn.dataset.seg;
  const val = btn.dataset.val;
  attState[segId] = val;
  document.querySelectorAll(`.att-btn[data-seg="${segId}"]`).forEach(b => {
    b.classList.remove('yes', 'no');
  });
  btn.classList.add(val === '出' ? 'yes' : 'no');
}

// ── カスタム質問 ────────────────────────────────────────────────────────────

function renderQuestions() {
  if (!questions.length) return;
  const sec = document.getElementById('q-section');
  sec.hidden = false;
  const title = sec.querySelector('.section-title');
  sec.innerHTML = '';
  sec.appendChild(title);

  questions.forEach(q => {
    const item = document.createElement('div');
    item.className = 'q-item';
    item.innerHTML = `<div class="q-label">${esc(q.label)}${q.required ? '<span class="req">*</span>' : ''}</div>` + renderQInput(q);
    sec.appendChild(item);
  });
}

function renderQInput(q) {
  const n = `q_${q.id}`;
  const req = q.required ? 'required' : '';
  const opts = q.options || [];
  switch (q.field_type) {
    case 'text':
      return `<input class="q-input" type="text" name="${n}" ${req}>`;
    case 'select':
      return `<div class="q-select-wrap">
        <select class="q-input" name="${n}" ${req}>
          <option value="">選択してください</option>
          ${opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select></div>`;
    case 'multiselect':
      return `<div class="multi-opts">${opts.map(o =>
        `<label class="multi-opt"><input type="checkbox" name="${n}" value="${esc(o)}"> ${esc(o)}</label>`
      ).join('')}</div>`;
    case 'number':
      return `<input class="q-input" type="number" name="${n}" ${req}>`;
    case 'bool':
      return `<div class="bool-btns">
        <button type="button" class="bool-btn" data-qid="${q.id}" data-val="true"  onclick="selectBool(this)">はい</button>
        <button type="button" class="bool-btn" data-qid="${q.id}" data-val="false" onclick="selectBool(this)">いいえ</button>
      </div>`;
    case 'date':
      return `<input class="q-input" type="date" name="${n}" ${req}>`;
    default:
      return `<input class="q-input" type="text" name="${n}">`;
  }
}

function selectBool(btn) {
  const qId = btn.dataset.qid;
  boolState[qId] = btn.dataset.val === 'true';
  document.querySelectorAll(`.bool-btn[data-qid="${qId}"]`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ── 送信 ────────────────────────────────────────────────────────────────────

async function submitForm() {
  // 出欠バリデーション
  const unselected = segments.filter(s => !attState[s.id]);
  if (unselected.length) {
    alert(`「${unselected[0].name}」の出欠を選択してください`);
    return;
  }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = '送信中…';

  try {
    const idToken = liff.getIDToken();

    const attendance = segments.map(s => ({
      segment_id: s.id,
      status: attState[s.id],
    }));

    const answers = questions.map(q => {
      const n = `q_${q.id}`;
      let value;
      if (q.field_type === 'multiselect') {
        value = Array.from(document.querySelectorAll(`input[name="${n}"]:checked`))
                     .map(el => el.value).join(',');
      } else if (q.field_type === 'bool') {
        value = boolState[q.id] !== undefined ? String(boolState[q.id]) : 'false';
      } else {
        value = (document.querySelector(`[name="${n}"]`)?.value || '').trim();
      }
      return { question_id: q.id, value };
    });

    const res = await fetch('/liff/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participant_id: participant.id, id_token: idToken, attendance, answers }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '送信に失敗しました');
    }

    document.getElementById('done-text').textContent = `${participant.display_name} さん、ありがとうございます！`;
    show('done-view');
  } catch (e) {
    alert(e.message);
    btn.disabled = false;
    btn.textContent = '回答を送信';
  }
}

// ── LIFF 初期化 ─────────────────────────────────────────────────────────────

async function init() {
  const config = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
  if (!config.liffId) { showError('LIFF の設定が見つかりません'); return; }

  try {
    await Promise.race([
      liff.init({ liffId: config.liffId }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout / liffId=' + config.liffId)), 6000)
      ),
    ]);
  } catch (e) {
    showError(`LIFF エラー: ${e.message}`);
    return;
  }

  // liff.init() 完了後に liff.state が展開され URL が復元されるので、ここで再取得
  eventId = new URLSearchParams(location.search).get('event_id');
  if (!eventId) { showError('URL に event_id が含まれていません'); return; }

  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href });
    return;
  }

  // イベント・区間・質問を並行取得
  const [event, segs, qs] = await Promise.all([
    fetch(`/api/events/${eventId}`).then(r => r.ok ? r.json() : null),
    fetch(`/api/events/${eventId}/segments`).then(r => r.ok ? r.json() : []),
    fetch(`/api/events/${eventId}/questions`).then(r => r.ok ? r.json() : []),
  ]);

  if (!event) { showError('イベントが見つかりません'); return; }

  if (event.status !== 'open') {
    document.getElementById('closed-text').textContent = event.name;
    show('closed-view');
    return;
  }

  // LIFF 自己登録
  const regRes = await fetch('/liff/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: parseInt(eventId, 10), id_token: liff.getIDToken() }),
  });
  if (!regRes.ok) { showError('参加登録に失敗しました'); return; }
  participant = await regRes.json();

  segments = segs;
  questions = qs;

  document.getElementById('ev-name').textContent = event.name;
  document.getElementById('ev-desc').textContent = event.description || '';

  renderAttendance();
  renderQuestions();
  show('form-view');
}

init();
