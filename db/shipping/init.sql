CREATE TABLE IF NOT EXISTS shipping_labels (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER NOT NULL,
  direction TEXT NOT NULL,     -- A_to_B / B_to_A
  label_code TEXT UNIQUE NOT NULL,
  carrier TEXT NOT NULL DEFAULT 'yamato',
  status TEXT NOT NULL DEFAULT 'Created',  -- Created / Shipped / Delivered
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
