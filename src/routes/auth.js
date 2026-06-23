const { Router } = require('express');
const crypto = require('crypto');
const axios = require('axios');

const router = Router();

// GET /auth/line — LINE Login へリダイレクト
// LINE Developers Console に http://localhost:3000/auth/line/callback を登録必須
router.get('/line', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/line/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINE_CHANNEL_ID,
    redirect_uri: redirectUri,
    state,
    scope: 'profile openid',
  });
  res.redirect(`https://access.line.me/oauth2/v2.1/authorize?${params}`);
});

// GET /auth/line/callback
router.get('/line/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || state !== req.session.oauthState) {
      return res.status(400).send('Invalid state. Please try logging in again.');
    }
    delete req.session.oauthState;

    const redirectUri = `${req.protocol}://${req.get('host')}/auth/line/callback`;

    const tokenRes = await axios.post(
      'https://api.line.me/oauth2/v2.1/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: process.env.LINE_CHANNEL_ID,
        client_secret: process.env.LINE_CHANNEL_SECRET,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const profileRes = await axios.get('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
    });

    req.session.lineUserId = profileRes.data.userId;
    req.session.displayName = profileRes.data.displayName;
    res.redirect('/admin/');
  } catch (e) {
    console.error('LINE Login error:', e.response?.data || e.message);
    res.status(500).send('ログインに失敗しました。もう一度お試しください。');
  }
});

// GET /auth/me — ログイン中のユーザー情報
router.get('/me', (req, res) => {
  if (!req.session.lineUserId) return res.status(401).json({ error: 'Not logged in' });
  res.json({ lineUserId: req.session.lineUserId, displayName: req.session.displayName });
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
