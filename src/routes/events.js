const { Router } = require('express');
const pool = require('../db');
const { requireAuth, requireOrganizer } = require('../middleware/auth');

const router = Router();

// ── Events ───────────────────────────────────────────────────────────────────

// 幹事の担当イベント一覧（参加者数・未回答数付き）
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*,
         (SELECT COUNT(*) FROM participants
           WHERE event_id = e.id AND role = 'participant') AS participant_count,
         (SELECT COUNT(*) FROM participants
           WHERE event_id = e.id AND role = 'participant' AND responded_at IS NULL) AS unresponded_count
         FROM events e
         JOIN participants p ON p.event_id = e.id
        WHERE p.line_user_id = $1 AND p.role = 'organizer'
        ORDER BY e.created_at DESC`,
      [req.session.lineUserId],
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// イベント作成 + デフォルト区間 + organizer participant をトランザクションで一括作成
router.post('/', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name, description, segmented } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    await client.query('BEGIN');

    const { rows } = await client.query(
      'INSERT INTO events(name, description, segmented) VALUES($1, $2, $3) RETURNING *',
      [name, description ?? null, segmented ?? false],
    );
    const event = rows[0];

    if (!event.segmented) {
      await client.query(
        'INSERT INTO segments(event_id, name, sort_order) VALUES($1, $2, 0)',
        [event.id, 'メイン'],
      );
    }

    await client.query(
      `INSERT INTO participants(event_id, display_name, role, auth_provider, line_user_id)
       VALUES($1, $2, 'organizer', 'line', $3)`,
      [event.id, req.session.displayName, req.session.lineUserId],
    );

    await client.query('COMMIT');
    res.status(201).json(event);
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

// 単一イベント取得（公開 — LIFF フォームが使用）
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.put('/:id', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { name, description, segmented, status } = req.body;
    const { rows } = await pool.query(
      `UPDATE events
          SET name        = COALESCE($1, name),
              description = COALESCE($2, description),
              segmented   = COALESCE($3, segmented),
              status      = COALESCE($4, status)
        WHERE id = $5
        RETURNING *`,
      [name ?? null, description ?? null, segmented ?? null, status ?? null, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM events WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (e) { next(e); }
});

// ── Segments (GET 公開、書き込みは幹事のみ) ──────────────────────────────────

router.get('/:id/segments', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM segments WHERE event_id = $1 ORDER BY sort_order',
      [req.params.id],
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/:id/segments', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { name, starts_at, ends_at, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await pool.query(
      `INSERT INTO segments(event_id, name, starts_at, ends_at, sort_order)
       VALUES($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, name, starts_at ?? null, ends_at ?? null, sort_order ?? 0],
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.put('/:id/segments/:segId', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { name, starts_at, ends_at, sort_order } = req.body;
    const { rows } = await pool.query(
      `UPDATE segments
          SET name       = COALESCE($1, name),
              starts_at  = COALESCE($2, starts_at),
              ends_at    = COALESCE($3, ends_at),
              sort_order = COALESCE($4, sort_order)
        WHERE id = $5 AND event_id = $6
        RETURNING *`,
      [name ?? null, starts_at ?? null, ends_at ?? null, sort_order ?? null,
       req.params.segId, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id/segments/:segId', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    await pool.query(
      'DELETE FROM segments WHERE id = $1 AND event_id = $2',
      [req.params.segId, req.params.id],
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

// ── Questions (GET 公開、書き込みは幹事のみ) ──────────────────────────────────

router.get('/:id/questions', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM questions WHERE event_id = $1 ORDER BY sort_order',
      [req.params.id],
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/:id/questions', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { label, field_type, semantic, options, required, sort_order } = req.body;
    if (!label || !field_type) return res.status(400).json({ error: 'label and field_type are required' });
    const { rows } = await pool.query(
      `INSERT INTO questions(event_id, label, field_type, semantic, options, required, sort_order)
       VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        req.params.id, label, field_type,
        semantic ?? null,
        options != null ? JSON.stringify(options) : null,
        required ?? false,
        sort_order ?? 0,
      ],
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.put('/:id/questions/:qId', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { label, field_type, semantic, options, required, sort_order } = req.body;
    const { rows } = await pool.query(
      `UPDATE questions
          SET label      = COALESCE($1, label),
              field_type = COALESCE($2, field_type),
              semantic   = COALESCE($3, semantic),
              options    = COALESCE($4, options),
              required   = COALESCE($5, required),
              sort_order = COALESCE($6, sort_order)
        WHERE id = $7 AND event_id = $8
        RETURNING *`,
      [
        label ?? null, field_type ?? null, semantic ?? null,
        options != null ? JSON.stringify(options) : null,
        required ?? null, sort_order ?? null,
        req.params.qId, req.params.id,
      ],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id/questions/:qId', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    await pool.query(
      'DELETE FROM questions WHERE id = $1 AND event_id = $2',
      [req.params.qId, req.params.id],
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

// ── Participants (幹事のみ) ────────────────────────────────────────────────────

router.get('/:id/participants', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
         json_agg(json_build_object('segment_id', a.segment_id, 'status', a.status))
           FILTER (WHERE a.id IS NOT NULL) AS attendance
         FROM participants p
         LEFT JOIN attendance a ON a.participant_id = p.id
        WHERE p.event_id = $1
        GROUP BY p.id
        ORDER BY p.created_at`,
      [req.params.id],
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:id/unresponded', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM participants
        WHERE event_id = $1 AND role = 'participant' AND responded_at IS NULL`,
      [req.params.id],
    );
    res.json({ count: parseInt(rows[0].count, 10) });
  } catch (e) { next(e); }
});

module.exports = router;
