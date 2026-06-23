const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../src/db');

async function migrate() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/001_init.sql'),
    'utf8',
  );
  await pool.query(sql);
  console.log('Migration complete.');
  await pool.end();
}

migrate().catch(e => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
