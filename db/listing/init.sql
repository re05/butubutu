CREATE TABLE IF NOT EXISTS listings (
  id            SERIAL PRIMARY KEY,
  title         TEXT    NOT NULL,
  price         INTEGER NOT NULL CHECK (price >= 0),
  status        TEXT    NOT NULL DEFAULT 'Active',
  seller_id     INTEGER NOT NULL,
  image_url     TEXT,
  category      TEXT    NOT NULL DEFAULT 'その他',
  fashion_genre TEXT,
  size          TEXT,
  condition     TEXT    NOT NULL DEFAULT '未使用に近い',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listing_comments (
  id           SERIAL PRIMARY KEY,
  listing_id   INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  author_id    INTEGER NOT NULL,
  author_email TEXT,
  body         TEXT    NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_comments_listing_created
  ON listing_comments(listing_id, created_at);
