CREATE TABLE IF NOT EXISTS state (
  id INTEGER PRIMARY KEY CHECK (id = 1), cursor TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL DEFAULT 0, lease_id TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  last_run INTEGER NOT NULL DEFAULT 0, last_ok INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO state(id) VALUES (1);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
  expanded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_pending ON events(expanded, created_at);
CREATE TABLE IF NOT EXISTS deliveries (
  event_id TEXT NOT NULL, device_key TEXT NOT NULL, expected_user TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (event_id, device_key),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries(status, next_at);
