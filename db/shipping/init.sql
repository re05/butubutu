-- shipping-db schema (barter demo)

CREATE TABLE IF NOT EXISTS shipping_labels (
  id SERIAL PRIMARY KEY,
  trade_id   INTEGER NOT NULL,
  direction  TEXT    NOT NULL,   -- A_to_B / B_to_A
  label_code TEXT    NOT NULL,
  from_user_id INTEGER NOT NULL,
  to_user_id   INTEGER NOT NULL,
  item_summary TEXT NOT NULL DEFAULT '',
  carrier TEXT NOT NULL DEFAULT 'yamato',
  status  TEXT NOT NULL DEFAULT 'Created', -- Created / Shipped / Delivered / Cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trade_id, direction),
  UNIQUE (label_code)
);

CREATE INDEX IF NOT EXISTS idx_shipping_labels_trade_id ON shipping_labels(trade_id);
CREATE INDEX IF NOT EXISTS idx_shipping_labels_to_user_id ON shipping_labels(to_user_id);

CREATE TABLE IF NOT EXISTS shipping_events (
  id SERIAL PRIMARY KEY,
  label_id INTEGER NOT NULL REFERENCES shipping_labels(id) ON DELETE CASCADE,
  event   TEXT NOT NULL,
  note    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipping_events_label_id ON shipping_events(label_id);
