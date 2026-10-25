const { DatabaseSync } = require('node:sqlite');
const { readFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(readFileSync(path.join(__dirname, 'migrations/001-commerce.sql'), 'utf8'));
  if (!db.prepare('SELECT version FROM schema_migrations WHERE version=2').get()) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(readFileSync(path.join(__dirname, 'migrations/002-shipping-options.sql'), 'utf8')); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (!db.prepare('SELECT version FROM schema_migrations WHERE version=3').get()) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(readFileSync(path.join(__dirname, 'migrations/003-payment-expiry.sql'), 'utf8')); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {
    db,
    get(sql, ...args) { return db.prepare(sql).get(...args); },
    all(sql, ...args) { return db.prepare(sql).all(...args); },
    run(sql, ...args) { return db.prepare(sql).run(...args); },
    transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
  };
}
module.exports = { openStore };
