-- ユーザー管理（auth-svc 用）
CREATE TABLE users (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email        TEXT    NOT NULL UNIQUE,
  password     TEXT    NOT NULL,
  role         TEXT    NOT NULL DEFAULT 'user',
  disabled     BOOLEAN NOT NULL DEFAULT FALSE,
  full_name    TEXT,
  postal_code  TEXT,
  prefecture   TEXT,
  city         TEXT,
  address_line TEXT,
  phone        TEXT
);


-- 出品情報（listing-svc 用）
CREATE TABLE listings (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title         TEXT    NOT NULL,
  price         INTEGER NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'Active',      -- Active / Paused / Sold
  seller_id     INTEGER NOT NULL,
  image_url     TEXT,
  category      TEXT    NOT NULL DEFAULT 'その他',
  fashion_genre TEXT,
  size          TEXT,
  condition     TEXT    NOT NULL DEFAULT '未使用に近い'
);

ALTER TABLE listings
  ADD CONSTRAINT fk_listings_seller
  FOREIGN KEY (seller_id) REFERENCES users(id)
  ON DELETE CASCADE;

-- 出品へのコメント（商品詳細ページで使う）
CREATE TABLE listing_comments (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id INTEGER NOT NULL,
  author_id  INTEGER NOT NULL,
  body       TEXT    NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE listing_comments
  ADD CONSTRAINT fk_listing_comments_listing
  FOREIGN KEY (listing_id) REFERENCES listings(id)
  ON DELETE CASCADE;

ALTER TABLE listing_comments
  ADD CONSTRAINT fk_listing_comments_author
  FOREIGN KEY (author_id) REFERENCES users(id)
  ON DELETE CASCADE;

-- 取引情報（order-svc 用）
CREATE TABLE orders (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id   INTEGER NOT NULL,
  buyer_id     INTEGER NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'CREATED',  -- CREATED / SHIPPED / DELIVERED / COMPLETED
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  shipped_at   TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ
);

ALTER TABLE orders
  ADD CONSTRAINT fk_orders_listing
  FOREIGN KEY (listing_id) REFERENCES listings(id)
  ON DELETE CASCADE;

ALTER TABLE orders
  ADD CONSTRAINT fk_orders_buyer
  FOREIGN KEY (buyer_id) REFERENCES users(id)
  ON DELETE CASCADE;

-- 取引メッセージ（取引詳細画面のチャット）
CREATE TABLE order_messages (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   INTEGER NOT NULL,
  sender_id  INTEGER NOT NULL,
  body       TEXT    NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE order_messages
  ADD CONSTRAINT fk_order_messages_order
  FOREIGN KEY (order_id) REFERENCES orders(id)
  ON DELETE CASCADE;

ALTER TABLE order_messages
  ADD CONSTRAINT fk_order_messages_sender
  FOREIGN KEY (sender_id) REFERENCES users(id)
  ON DELETE CASCADE;
