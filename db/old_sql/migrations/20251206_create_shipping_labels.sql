CREATE TABLE shipping_labels (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,        -- 発送コード（C2C側に見えるのはこれだけ）
  order_id INTEGER NOT NULL,        -- 紐づく注文

  name TEXT NOT NULL,               -- 宛名
  postal_code TEXT NOT NULL,        -- 郵便番号
  address1 TEXT NOT NULL,           -- 住所1
  address2 TEXT,                    -- 住所2
  phone TEXT NOT NULL,              -- 電話番号

  created_at TIMESTAMP DEFAULT now()
);
