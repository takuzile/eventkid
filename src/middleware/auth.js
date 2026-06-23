const pool = require('../db');

function requireAuth(req, res, next) {
  if (!req.session.lineUserId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

async function requireOrganizer(req, res, next) {
  try {
    const { rows } = await pool.query(
      "SELECT id FROM participants WHERE event_id = $1 AND line_user_id = $2 AND role = 'organizer'",
      [req.params.id, req.session.lineUserId],
    );
    if (!rows.length) return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch (e) { next(e); }
}

module.exports = { requireAuth, requireOrganizer };
