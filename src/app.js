require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const pool = require('./db');

const authRouter = require('./routes/auth');
const eventsRouter = require('./routes/events');
const liffRouter = require('./routes/liff');
const notifyRouter = require('./routes/notify');

const app = express();

// Railway などリバースプロキシ越しに HTTPS を正しく扱う
app.set('trust proxy', 1);
app.use(express.json());

app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// 静的ファイル（API ルートより前に置くこと）
app.use('/admin', express.static(path.join(__dirname, '../public/admin')));
app.use('/liff', express.static(path.join(__dirname, '../public/liff')));

// フロントエンドから LIFF ID を取得するための設定エンドポイント
app.get('/api/config', (req, res) => {
  res.json({ liffId: process.env.LINE_LIFF_ID });
});

// ルート → 管理画面へリダイレクト
app.get('/', (req, res) => res.redirect('/admin/'));

// API ルート（静的ファイルハンドラより後ろ）
app.use('/auth', authRouter);
app.use('/api/events', eventsRouter);
app.use('/liff', liffRouter);   // POST /liff/register, POST /liff/submit
app.use('/api', notifyRouter);

// グローバルエラーハンドラ
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`EventKit listening on :${PORT}`));
