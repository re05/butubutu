-- fx-db schema

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

CREATE TABLE IF NOT EXISTS fx_trades (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER NOT NULL UNIQUE,
  from_fruit_item_id INTEGER NOT NULL REFERENCES fruit_items(id),
  to_fruit_item_id   INTEGER NOT NULL REFERENCES fruit_items(id),
  from_qty INTEGER NOT NULL CHECK (from_qty > 0),
  to_qty   INTEGER NOT NULL CHECK (to_qty > 0),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fx_trades_pair ON fx_trades(from_fruit_item_id, to_fruit_item_id);
