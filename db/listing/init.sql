-- listing-db schema (fruit barter demo)

CREATE TABLE IF NOT EXISTS fruit_items (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

INSERT INTO fruit_items (id, name) VALUES
  (1, 'リンゴ'),
  (2, 'バナナ'),
  (3, 'オレンジ'),
  (4, 'ぶどう'),
  (5, 'いちご')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS listings (
  id            SERIAL PRIMARY KEY,
  fruit_item_id INTEGER NOT NULL REFERENCES fruit_items(id),
  quantity      INTEGER NOT NULL CHECK (quantity >= 0),
  status        TEXT    NOT NULL DEFAULT 'Active',
  seller_id     INTEGER NOT NULL,
  image_url     TEXT    NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listings_seller_id ON listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_fruit_item_id ON listings(fruit_item_id);

CREATE TABLE IF NOT EXISTS listing_wants (
  listing_id    INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  fruit_item_id INTEGER NOT NULL REFERENCES fruit_items(id),
  PRIMARY KEY (listing_id, fruit_item_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_wants_fruit_item_id ON listing_wants(fruit_item_id);
