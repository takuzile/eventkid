const { Router } = require('express');
const axios = require('axios');
const pool = require('../db');

const router = Router();

// LINE ID トークンをプラットフォームで検証し line_user_id と display_name を返す
async function verifyLineToken(idToken) {
  const body = new URLSearchParams({
    id_token: idToken,
    client_id: process.env.LINE_CHANNEL_ID,
  });
  const { data } = await axios.post(
    'https://api.line.me/oauth2/v2.1/verify',
    body.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  return { line_user_id: data.sub, display_name: data.name };
}

// POST /liff/register
// クライアント: { event_id, id_token }
// 既存参加者なら返す。新規の場合、まだ organizer がいなければ organizer として登録する。
// participant_id が唯一の正準キー (§4 §6 鉄則)
router.post('/register', async (req, res, next) => {
  try {
    const { event_id, id_token } = req.body;
    if (!event_id || !id_token) {
      return res.status(400).json({ error: 'event_id and id_token are required' });
    }

    const { line_user_id, display_name } = await verifyLineToken(id_token);

    // 既存チェック（部分 unique index と同じ条件）
    const existing = await pool.query(
      'SELECT * FROM participants WHERE event_id = $1 AND line_user_id = $2',
      [event_id, line_user_id],
    );
    if (existing.rows.length) return res.json(existing.rows[0]);

    // organizer が未存在なら最初の登録者を organizer にする
    const orgCheck = await pool.query(
      "SELECT id FROM participants WHERE event_id = $1 AND role = 'organizer'",
      [event_id],
    );
    const role = orgCheck.rows.length === 0 ? 'organizer' : 'participant';

    const { rows } = await pool.query(
      `INSERT INTO participants(event_id, display_name, role, auth_provider, line_user_id)
       VALUES($1, $2, $3, 'line', $4)
       RETURNING *`,
      [event_id, display_name, role, line_user_id],
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// POST /liff/submit
// クライアント: { participant_id, id_token, attendance: [{segment_id, status}], answers: [{question_id, value}] }
// id_token で line_user_id を検証し、そのユーザーの participant であることを確認してから保存する。
// attendance と answers は upsert。完了後 responded_at を記録。
router.post('/submit', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { participant_id, id_token, attendance, answers } = req.body;
    if (!participant_id || !id_token) {
      return res.status(400).json({ error: 'participant_id and id_token are required' });
    }

    const { line_user_id } = await verifyLineToken(id_token);

    // participant_id が本人のものであることを確認 (§4: line_user_id は特定手段の1つ)
    const pCheck = await client.query(
      'SELECT id FROM participants WHERE id = $1 AND line_user_id = $2',
      [participant_id, line_user_id],
    );
    if (!pCheck.rows.length) return res.status(403).json({ error: 'Forbidden' });

    await client.query('BEGIN');

    for (const { segment_id, status } of attendance ?? []) {
      await client.query(
        `INSERT INTO attendance(participant_id, segment_id, status)
         VALUES($1, $2, $3)
         ON CONFLICT(participant_id, segment_id) DO UPDATE SET status = EXCLUDED.status`,
        [participant_id, segment_id, status],
      );
    }

    for (const { question_id, value } of answers ?? []) {
      await client.query(
        `INSERT INTO answers(participant_id, question_id, value)
         VALUES($1, $2, $3)
         ON CONFLICT(participant_id, question_id) DO UPDATE SET value = EXCLUDED.value`,
        [participant_id, question_id, value],
      );
    }

    await client.query(
      'UPDATE participants SET responded_at = NOW() WHERE id = $1',
      [participant_id],
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

module.exports = router;
