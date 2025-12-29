-- trade-db schema (minimum)

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  proposer_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Proposed',
  proposal_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  shipped_proposer_at TIMESTAMPTZ,
  shipped_receiver_at TIMESTAMPTZ,
  received_proposer_at TIMESTAMPTZ,
  received_receiver_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);


CREATE TABLE IF NOT EXISTS trade_items (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  side TEXT NOT NULL,
  listing_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_trade_items_trade_id ON trade_items(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_items_listing_id ON trade_items(listing_id);

CREATE TABLE IF NOT EXISTS trade_messages (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_messages_trade_id ON trade_messages(trade_id);
