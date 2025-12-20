-- db/listing/init.sql

CREATE TABLE IF NOT EXISTS listings (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  price         INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'Active',
  seller_id     INTEGER NOT NULL,
  image_url     TEXT NOT NULL,
  category      TEXT NOT NULL,
  fashion_genre TEXT,
  size          TEXT,
  condition     TEXT NOT NULL DEFAULT '未使用に近い'
);

CREATE TABLE IF NOT EXISTS listing_comments (
  id          SERIAL PRIMARY KEY,
  listing_id  INTEGER NOT NULL,
  author_id   INTEGER NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
