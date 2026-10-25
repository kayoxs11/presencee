ALTER TABLE payments ADD COLUMN preference_expires INTEGER NOT NULL DEFAULT 0;
INSERT INTO schema_migrations(version) VALUES(3);
