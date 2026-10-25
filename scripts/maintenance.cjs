const path = require('node:path');
const { openStore } = require('../server/store.cjs');
if (!process.env.DATABASE_PATH) throw new Error('Configure DATABASE_PATH explicitamente.');
const store = openStore(path.resolve(process.env.DATABASE_PATH));
const now = Date.now();
try {
  const counts = store.transaction(() => ({
    sessions: store.run('DELETE FROM admin_sessions WHERE expires_at<=?', now).changes,
    quotes: store.run('DELETE FROM shipping_quotes WHERE expires_at<? AND id NOT IN (SELECT quote_id FROM orders)', now - 86400000).changes,
    notifications: store.run('DELETE FROM webhook_events WHERE processed_at<?', now - 30 * 86400000).changes,
  }));
  console.log(JSON.stringify(counts));
} finally { store.db.close(); }
