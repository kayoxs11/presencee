ALTER TABLE shipping_quotes ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE shipping_quotes ADD COLUMN options TEXT NOT NULL DEFAULT '[]';
ALTER TABLE shipping_quotes ADD COLUMN package TEXT;
INSERT INTO schema_migrations(version) VALUES(2);
