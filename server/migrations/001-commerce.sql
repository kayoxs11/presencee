PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS shipping_quotes (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, fingerprint TEXT NOT NULL,
 destination TEXT NOT NULL, items TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 service TEXT, price_cents INTEGER CHECK(price_cents >= 0), delivery_days INTEGER,
 production_days INTEGER, evidence TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL,
 access_expires INTEGER NOT NULL, idempotency_hash TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
 quote_id TEXT NOT NULL UNIQUE REFERENCES shipping_quotes(id), customer TEXT NOT NULL,
 subtotal INTEGER NOT NULL CHECK(subtotal >= 0), discount INTEGER NOT NULL CHECK(discount >= 0),
 shipping_cost INTEGER NOT NULL CHECK(shipping_cost >= 0), shipping_discount INTEGER NOT NULL CHECK(shipping_discount >= 0),
 total INTEGER NOT NULL CHECK(total > 0), coupon TEXT, shipping TEXT NOT NULL,
 payment_status TEXT NOT NULL DEFAULT 'pending', fulfillment_status TEXT NOT NULL DEFAULT 'received',
 tracking_code TEXT, tracking_url TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
 order_id TEXT NOT NULL REFERENCES orders(id), position INTEGER NOT NULL, snapshot TEXT NOT NULL,
 PRIMARY KEY(order_id, position)
);
CREATE TABLE IF NOT EXISTS payments (
 order_id TEXT PRIMARY KEY REFERENCES orders(id), preference_id TEXT UNIQUE, checkout_url TEXT,
 provider_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending', provider_updated INTEGER NOT NULL DEFAULT 0,
 operation_key TEXT NOT NULL UNIQUE, refund_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS order_history (
 id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), kind TEXT NOT NULL,
 status TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_attempts (
 provider_id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
 status TEXT NOT NULL, provider_updated INTEGER NOT NULL, refund_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS webhook_events (
 id TEXT PRIMARY KEY, payment_id TEXT NOT NULL, processed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
 token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);
