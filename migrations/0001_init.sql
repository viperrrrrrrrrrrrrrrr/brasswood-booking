-- Brasswood Barber Co. — initial schema for Cloudflare D1 (SQLite).
-- Times are minutes from midnight in the SHOP's timezone (settings.timezone); dates are 'YYYY-MM-DD'.
-- Money is stored in integer cents. D1 enforces foreign keys.

CREATE TABLE settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),          -- single row
  name             TEXT    NOT NULL,
  tagline          TEXT    NOT NULL DEFAULT '',
  address          TEXT    NOT NULL DEFAULT '',
  phone            TEXT    NOT NULL DEFAULT '',
  email            TEXT    NOT NULL DEFAULT '',
  slot_step_min    INTEGER NOT NULL DEFAULT 15 CHECK (slot_step_min BETWEEN 5 AND 240),
  min_notice_min   INTEGER NOT NULL DEFAULT 60 CHECK (min_notice_min BETWEEN 0 AND 10080),
  horizon_days     INTEGER NOT NULL DEFAULT 30 CHECK (horizon_days BETWEEN 1 AND 365),
  timezone         TEXT    NOT NULL DEFAULT 'America/New_York', -- IANA name; "today"/"now" for slots
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE services (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description   TEXT    NOT NULL DEFAULT '',
  category      TEXT    NOT NULL DEFAULT '',
  duration_min  INTEGER NOT NULL CHECK (duration_min BETWEEN 5 AND 720),
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  deleted_at    TEXT,                                   -- soft delete keeps booking history intact
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE staff (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  role        TEXT    NOT NULL DEFAULT '',
  bio         TEXT    NOT NULL DEFAULT '',
  color       TEXT    NOT NULL DEFAULT '#b7791f',
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Which services each specialist performs.
CREATE TABLE staff_services (
  staff_id    TEXT NOT NULL REFERENCES staff(id)    ON DELETE CASCADE,
  service_id  TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

-- Weekly working hours. No row for a weekday = day off.
CREATE TABLE staff_hours (
  staff_id         TEXT    NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  weekday          INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
  start_min        INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1440),
  end_min          INTEGER NOT NULL CHECK (end_min BETWEEN 0 AND 1440),
  break_start_min  INTEGER CHECK (break_start_min BETWEEN 0 AND 1440),
  break_end_min    INTEGER CHECK (break_end_min BETWEEN 0 AND 1440),
  PRIMARY KEY (staff_id, weekday),
  CHECK (end_min > start_min),
  CHECK ((break_start_min IS NULL) = (break_end_min IS NULL)),
  CHECK (break_start_min IS NULL OR break_end_min > break_start_min)
);

-- Days off: staff_id NULL = whole shop closed.
CREATE TABLE time_off (
  id          TEXT PRIMARY KEY,
  staff_id    TEXT REFERENCES staff(id) ON DELETE CASCADE,
  date        TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX time_off_date ON time_off(date);

CREATE TABLE clients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL DEFAULT '',
  phone_digits  TEXT NOT NULL DEFAULT '',     -- phone with non-digits stripped, used for matching
  email         TEXT NOT NULL DEFAULT '',     -- stored lower-cased + trimmed
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX clients_email_unique ON clients(email) WHERE email <> '';
CREATE INDEX clients_phone_digits ON clients(phone_digits) WHERE phone_digits <> '';

CREATE TABLE bookings (
  id           TEXT    PRIMARY KEY,
  code         TEXT    NOT NULL UNIQUE,
  service_id   TEXT    NOT NULL REFERENCES services(id),
  staff_id     TEXT    NOT NULL REFERENCES staff(id),
  client_id    TEXT    NOT NULL REFERENCES clients(id),
  date         TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_min    INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1440),
  end_min      INTEGER NOT NULL CHECK (end_min BETWEEN 0 AND 1440),
  status       TEXT    NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','completed','no-show','cancelled')),
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),  -- price snapshot at booking time
  notes        TEXT    NOT NULL DEFAULT '',
  source       TEXT    NOT NULL DEFAULT 'online' CHECK (source IN ('online','admin')),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_min > start_min)
);
CREATE INDEX bookings_staff_date ON bookings(staff_id, date, start_min);
CREATE INDEX bookings_status ON bookings(status);
CREATE INDEX bookings_date ON bookings(date);
CREATE INDEX bookings_client ON bookings(client_id);
-- Backstop against double booking: two non-cancelled bookings can never share staff+date+start.
-- (Partial overlaps are prevented by the atomic INSERT ... WHERE NOT EXISTS in the API.)
CREATE UNIQUE INDEX bookings_no_double_start ON bookings(staff_id, date, start_min) WHERE status <> 'cancelled';

-- Server-side admin sessions. Only a SHA-256 hash of the cookie token is stored.
CREATE TABLE admin_sessions (
  token_hash  TEXT    PRIMARY KEY,
  username    TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,   -- unix ms
  expires_at  INTEGER NOT NULL    -- unix ms
);
CREATE INDEX admin_sessions_expires ON admin_sessions(expires_at);

-- Failed login attempts for simple brute-force throttling.
CREATE TABLE login_attempts (
  ip            TEXT    NOT NULL,
  attempted_at  INTEGER NOT NULL  -- unix ms
);
CREATE INDEX login_attempts_ip ON login_attempts(ip, attempted_at);
