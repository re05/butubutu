CREATE TABLE IF NOT EXISTS orders (
  id               SERIAL PRIMARY KEY,

  listing_id       INTEGER NOT NULL,
  listing_title    TEXT    NOT NULL,
  listing_price    INTEGER NOT NULL,
  listing_image_url TEXT,
  seller_id        INTEGER NOT NULL,

  buyer_id         INTEGER NOT NULL,

  status           TEXT    NOT NULL DEFAULT 'CREATED',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  shipped_at       TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  confirmed_at     TIMESTAMPTZ,

  shipping_code     TEXT UNIQUE NOT NULL,
  yamato_tracking_no TEXT,
  yamato_status      TEXT NOT NULL DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS order_messages (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipping_labels (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  name        TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  address1    TEXT NOT NULL,
  address2    TEXT,
  phone       TEXT NOT NULL,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
