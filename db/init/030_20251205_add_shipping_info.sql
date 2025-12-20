-- db/migrations/20251205_add_shipping_info.sql

ALTER TABLE orders
  ADD COLUMN shipping_name         text,
  ADD COLUMN shipping_postal_code  text,
  ADD COLUMN shipping_address1     text,
  ADD COLUMN shipping_address2     text,
  ADD COLUMN shipping_phone        text,
  ADD COLUMN shipping_code         text,
  ADD COLUMN yamato_tracking_no    text,
  ADD COLUMN yamato_status         text NOT NULL DEFAULT 'PENDING';

-- 発送コードで引けるようにユニーク制約を付ける
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shipping_code
  ON orders(shipping_code);
