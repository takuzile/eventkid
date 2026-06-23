const { Router } = require('express');
const axios = require('axios');
const pool = require('../db');
const { requireAuth, requireOrganizer } = require('../middleware/auth');

const router = Router();

// POST /api/events/:id/notify
// Body: { group_id }
router.post('/events/:id/notify', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { group_id } = req.body;
    if (!group_id) return res.status(400).json({ error: 'group_id is required' });

    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      return res.status(503).json({ error: 'LINE_CHANNEL_ACCESS_TOKEN not configured' });
    }

    const [eventRes, countRes] = await Promise.all([
      pool.query('SELECT name FROM events WHERE id = $1', [req.params.id]),
      pool.query(
        `SELECT COUNT(*) AS count FROM participants
          WHERE event_id = $1 AND role = 'participant' AND responded_at IS NULL`,
        [req.params.id],
      ),
    ]);

    if (!eventRes.rows.length) return res.status(404).json({ error: 'Event not found' });
    const eventName = eventRes.rows[0].name;
    const unresponded = parseInt(countRes.rows[0].count, 10);

    const text = unresponded === 0
      ? `【${eventName}】全員の回答が揃いました！`
      : `【${eventName}】未回答: ${unresponded}名。まだの方は回答をお願いします。`;

    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: group_id, messages: [{ type: 'text', text }] },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      },
    );

    res.json({ ok: true, unresponded });
  } catch (e) { next(e); }
});

module.exports = router;
