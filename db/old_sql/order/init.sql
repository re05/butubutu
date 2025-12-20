-- db/order/init.sql

CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  listing_id   INTEGER NOT NULL,
  buyer_id     INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'CREATED',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shipped_at   TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,

  shipping_name        TEXT,
  shipping_postal_code TEXT,
  shipping_address1    TEXT,
  shipping_address2    TEXT,
  shipping_phone       TEXT,
  shipping_code        TEXT,

  yamato_tracking_no   TEXT,
  yamato_status        TEXT
);

CREATE TABLE IF NOT EXISTS order_messages (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL,
  sender_id  INTEGER NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipping_labels (
  id                    SERIAL PRIMARY KEY,
  order_id              INTEGER NOT NULL,
  shipping_name         TEXT NOT NULL,
  shipping_postal_code  TEXT NOT NULL,
  shipping_address1     TEXT NOT NULL,
  shipping_address2     TEXT,
  shipping_phone        TEXT NOT NULL,
  shipping_code         TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
