-- db/auth/init.sql

CREATE TABLE IF NOT EXISTS users (
  id       SERIAL PRIMARY KEY,
  email    TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role     TEXT NOT NULL DEFAULT 'user',
  disabled BOOLEAN NOT NULL DEFAULT FALSE
);
