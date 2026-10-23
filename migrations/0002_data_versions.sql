-- Change counters for cheap admin/public polling: GET /api/admin/changes reads this single row (1 row read)
-- instead of re-reading every list. Bumped by the API in the same batch as each write (no triggers on purpose).
CREATE TABLE data_versions (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  catalog INTEGER NOT NULL DEFAULT 0,
  bookings INTEGER NOT NULL DEFAULT 0,
  clients INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT ''
);
INSERT INTO data_versions (id) VALUES (1);

-- Paginated / searched client list sorted A-Z (LIMIT/OFFSET walks the index, no full sort).
CREATE INDEX clients_name ON clients(name COLLATE NOCASE);
-- Per-client history and "next visit" lookups, ordered without a temp sort.
CREATE INDEX bookings_client_date ON bookings(client_id, date, start_min);
DROP INDEX bookings_client;
-- Date-range lists (dashboard, schedule) come back already ordered by date, start.
CREATE INDEX bookings_date_start ON bookings(date, start_min);
DROP INDEX bookings_date;
