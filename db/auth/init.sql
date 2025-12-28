-- auth-db schema (demo)

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,
  password      TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user',
  disabled      BOOLEAN NOT NULL DEFAULT FALSE,

  full_name     TEXT    NOT NULL,
  postal_code   TEXT    NOT NULL,
  prefecture    TEXT    NOT NULL,
  city          TEXT    NOT NULL,
  address_line  TEXT    NOT NULL,
  phone         TEXT    NOT NULL
);

-- テストユーザー
INSERT INTO users (email, password, role, disabled, full_name, postal_code, prefecture, city, address_line, phone)
VALUES (
  'test@test.com',
  'pass',
  'user',
  false,
  'テストユーザー',
  '000-0000',
  '大阪府',
  '大阪市',
  'テスト1-2-3',
  '000-0000-0000'
)
ON CONFLICT (email) DO NOTHING;
