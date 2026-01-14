CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
  email        TEXT    NOT NULL UNIQUE,
  password     TEXT    NOT NULL,
  role         TEXT    NOT NULL DEFAULT 'user',
  disabled     BOOLEAN NOT NULL DEFAULT FALSE,

  full_name    TEXT    NOT NULL,
  postal_code  TEXT    NOT NULL,
  prefecture   TEXT    NOT NULL,
  city         TEXT    NOT NULL,
  address_line TEXT    NOT NULL,
  phone        TEXT    NOT NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
