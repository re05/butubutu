-- =====================================================
-- 初期スキーマ: users / listings / listing_comments / orders / order_messages
-- =====================================================

-- ユーザー
CREATE TABLE IF NOT EXISTS public.users (
  id        SERIAL PRIMARY KEY,
  email     TEXT NOT NULL UNIQUE,
  password  TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'user',
  disabled  BOOLEAN NOT NULL DEFAULT FALSE
);

-- 出品
CREATE TABLE IF NOT EXISTS public.listings (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  price         INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'Active',
  seller_id     INTEGER NOT NULL,
  image_url     TEXT NOT NULL,
  condition     TEXT NOT NULL DEFAULT '未使用に近い',
  category      TEXT NOT NULL DEFAULT 'ファッション',
  size          TEXT,
  fashion_genre TEXT,
  CONSTRAINT listings_price_check  CHECK (price >= 0),
  CONSTRAINT listings_status_check CHECK (status = ANY (ARRAY['Active','Sold','Paused']))
);

-- コメント
CREATE TABLE IF NOT EXISTS public.listing_comments (
  id         SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  author_id  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_listing_comments_listing_created
  ON public.listing_comments (listing_id, created_at DESC);

-- 取引
CREATE TABLE IF NOT EXISTS public.orders (
  id         SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL,
  buyer_id   INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'CREATED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 取引メッセージ
CREATE TABLE IF NOT EXISTS public.order_messages (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL,
  sender_id  INTEGER NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- listings.seller_id 外部キー
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'listings_seller_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.listings
      ADD CONSTRAINT listings_seller_id_fkey
      FOREIGN KEY (seller_id)
      REFERENCES public.users(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- listing_comments.listing_id 外部キー
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'listing_comments_listing_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.listing_comments
      ADD CONSTRAINT listing_comments_listing_id_fkey
      FOREIGN KEY (listing_id)
      REFERENCES public.listings(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- listing_comments.author_id 外部キー
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'listing_comments_author_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.listing_comments
      ADD CONSTRAINT listing_comments_author_id_fkey
      FOREIGN KEY (author_id)
      REFERENCES public.users(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- orders.listing_id 外部キー
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'orders_listing_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.orders
      ADD CONSTRAINT orders_listing_id_fkey
      FOREIGN KEY (listing_id)
      REFERENCES public.listings(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- orders.buyer_id 外部キー
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'orders_buyer_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.orders
      ADD CONSTRAINT orders_buyer_id_fkey
      FOREIGN KEY (buyer_id)
      REFERENCES public.users(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- order_messages.order_id 外部キー
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'order_messages_order_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.order_messages
      ADD CONSTRAINT order_messages_order_id_fkey
      FOREIGN KEY (order_id)
      REFERENCES public.orders(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- order_messages.sender_id 外部キー
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'order_messages_sender_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.order_messages
      ADD CONSTRAINT order_messages_sender_id_fkey
      FOREIGN KEY (sender_id)
      REFERENCES public.users(id);
  END IF;
END
$$;

-- 配送に合わせたステータスの種類を固定する
ALTER TABLE public.orders
  ADD CONSTRAINT IF NOT EXISTS orders_status_check
  CHECK (status IN ('CREATED','SHIPPED','DELIVERED','COMPLETED'));

-- 配送タイミングを記録するカラムを追加
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipped_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
