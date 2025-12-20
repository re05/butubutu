// order-svc/server.js
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';   
dotenv.config();

const app = express();

app.use(cors({
  origin: ['http://localhost:3100', 'http://localhost:3000'],
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: false,
  optionsSuccessStatus: 204
}));
app.options('*', (req,res)=>res.sendStatus(204));

app.use(express.json());

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

function authRequired(req,res,next){
  const h = req.headers['authorization'] || '';
  const [scheme, token] = h.split(' ');
  if(scheme !== 'Bearer' || !token) return res.status(401).json({error:'unauthorized'});
  try{
    // token には uid, role, sub が入っている想定
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    next();
  }catch(e){
    console.error('jwt verify error (order-svc)', e);
    return res.status(401).json({error:'unauthorized'});
  }
}

function generateShippingCode() {
  // C2C-と8桁のランダム16進数で簡単な発送コードを作る
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return 'C2C-' + rand;
}


app.get('/health',(req,res)=>res.json({ok:true, service:'order-svc'}));

/**
 * 購入
 * status: CREATED = 購入済み・発送待ち
 */
app.post('/orders', authRequired, async (req,res)=>{
  const { listingId } = req.body || {};
  if(!listingId) return res.status(400).json({error:'bad_request'});

  const client = await pool.connect();
  try{
    await client.query('BEGIN');

    // 対象出品をロック付きで取得
    const q1 = await client.query(
      'SELECT id,title,price,status,seller_id FROM listings WHERE id=$1 FOR UPDATE',
      [listingId]
    );
    if(q1.rowCount === 0){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'not_found'});
    }
    const l = q1.rows[0];

    // 自分の出品は買えない
    if(l.seller_id === req.user.uid){
      await client.query('ROLLBACK');
      return res.status(403).json({error:'own_listing'});
    }
    // Active 以外は買えない
    if(l.status !== 'Active'){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'not_active'});
    }

    // ここで購入者の住所情報を取得
    const uq = await client.query(
      `SELECT full_name, postal_code, prefecture, city, address_line, phone
         FROM users
        WHERE id = $1`,
      [req.user.uid]
    );
    if (uq.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'user_not_found' });
    }
    const u = uq.rows[0];

    // users テーブルからヤマト用の住所情報を組み立てる
    const shippingName       = u.full_name;
    const shippingPostalCode = u.postal_code;
    const shippingAddress1   = `${u.prefecture}${u.city}${u.address_line}`;
    const shippingAddress2   = '';   // 必要なら別途列を分ける
    const shippingPhone      = u.phone;

    const shippingCode = generateShippingCode();

    // orders に登録（個人情報は orders には持たせない）
    const q2 = await client.query(
      `INSERT INTO orders(
         listing_id,
         buyer_id,
         status,
         shipping_code,
         yamato_status
       )
       VALUES($1,$2,$3,$4,$5)
       RETURNING id,status,created_at,shipping_code`,
      [
        listingId,
        req.user.uid,
        'CREATED',
        shippingCode,
        'PENDING'
      ]
    );
    const o = q2.rows[0];

    // 個人情報は shipping_labels にだけ保存する
    await client.query(
      `INSERT INTO shipping_labels(
         code,
         order_id,
         name,
         postal_code,
         address1,
         address2,
         phone
       )
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        shippingCode,
        o.id,
        shippingName,
        shippingPostalCode,
        shippingAddress1,
        shippingAddress2,
        shippingPhone
      ]
    );

    // 出品を Sold に更新
    await client.query(
      'UPDATE listings SET status=$1 WHERE id=$2',
      ['Sold', listingId]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      id: o.id,
      status: o.status,
      created_at: o.created_at,
      shipping_code: o.shipping_code,
      listing: { id: l.id, title: l.title, price: l.price, seller_id: l.seller_id },
      buyer_id: req.user.uid
    });

  }catch(e){
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }finally{
    client.release();
  }
});


/**
 * 自分が買った注文一覧
 * listings.image_url も返す
 */
app.get('/orders/buyer/me', authRequired, async (req,res)=>{
  try{
    const q = await pool.query(
      `SELECT o.id, o.status, o.created_at,
              o.buyer_id,
              l.id AS listing_id, l.title, l.price, l.seller_id, l.image_url
       FROM orders o
       JOIN listings l ON o.listing_id = l.id
       WHERE o.buyer_id = $1
       ORDER BY o.id DESC`,
      [req.user.uid]
    );
    return res.json(q.rows);
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

/**
 * 自分の出品が売れた注文一覧
 * listings.image_url も返す
 */
app.get('/orders/seller/me', authRequired, async (req,res)=>{
  try{
    const q = await pool.query(
      `SELECT o.id, o.status, o.created_at,
              o.buyer_id,
              l.id AS listing_id, l.title, l.price, l.seller_id, l.image_url
       FROM orders o
       JOIN listings l ON o.listing_id = l.id
       WHERE l.seller_id = $1
       ORDER BY o.id DESC`,
      [req.user.uid]
    );
    return res.json(q.rows);
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

/**
 * 取引詳細
 * image_url / 各タイミングの日時も返す
 */
app.get('/orders/:id', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'bad_id' });
  }

  try {
    const q = await pool.query(
      `SELECT
         o.id,
         o.listing_id,
         o.buyer_id,
         o.status,
         o.created_at,
         o.shipped_at,
         o.delivered_at,
         o.confirmed_at,
         o.shipping_name,
         o.shipping_postal_code,
         o.shipping_address1,
         o.shipping_address2,
         o.shipping_phone,
         o.shipping_code,
         o.yamato_tracking_no,
         o.yamato_status,
         l.title,
         l.price,
         l.seller_id,
         l.image_url
       FROM orders o
       JOIN listings l ON o.listing_id = l.id
       WHERE o.id = $1`,
      [id]
    );

    if (q.rowCount === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    const row = q.rows[0];

    // 当事者以外は見せない（admin は特例で許可）
    if (
      row.seller_id !== req.user.uid &&
      row.buyer_id !== req.user.uid &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // 個人情報は返さず、安全な情報だけを返す
    const safe = {
      id: row.id,
      listing_id: row.listing_id,
      buyer_id: row.buyer_id,
      status: row.status,
      created_at: row.created_at,
      shipped_at: row.shipped_at,
      delivered_at: row.delivered_at,
      confirmed_at: row.confirmed_at,


      // ヤマト関連の状態
      yamato_tracking_no: row.yamato_tracking_no,
      yamato_status: row.yamato_status,

      // 商品情報
      title: row.title,
      price: row.price,
      seller_id: row.seller_id,
      image_url: row.image_url
    };

    return res.json(safe);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});


/**
 * 出品者が「発送した」と押す
 * CREATED -> SHIPPED
 */
app.patch('/orders/:id/ship', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'bad_id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const q = await client.query(
      `SELECT o.id, o.status, o.buyer_id, l.seller_id
       FROM orders o
       JOIN listings l ON o.listing_id = l.id
       WHERE o.id = $1
       FOR UPDATE`,
      [id]
    );
    if (q.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    const o = q.rows[0];

    // 出品者以外は操作禁止
    if (o.seller_id !== req.user.uid) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'forbidden' });
    }

    // CREATED 以外からは発送に遷移させない
    if (o.status !== 'CREATED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'bad_status' });
    }

    const u = await client.query(
      `UPDATE orders
       SET status = 'SHIPPED',
           shipped_at = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    await client.query('COMMIT');
    return res.json(u.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});


/**
 * 到着済みにする（買い手だけ）
 * SHIPPED -> DELIVERED
 */
app.patch('/orders/:id/deliver', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'bad_id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const q = await client.query(
      `SELECT o.id, o.status, o.buyer_id, l.seller_id
       FROM orders o
       JOIN listings l ON o.listing_id = l.id
       WHERE o.id = $1
       FOR UPDATE`,
      [id]
    );
    if (q.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    const o = q.rows[0];

    // 購入者以外は操作禁止
    if (o.buyer_id !== req.user.uid) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'forbidden' });
    }

    // SHIPPED のときだけ DELIVERED に進める
    if (o.status !== 'SHIPPED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'bad_status' });
    }

    const u = await client.query(
      `UPDATE orders
       SET status = 'DELIVERED',
           delivered_at = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    await client.query('COMMIT');
    return res.json(u.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});


/**
 * 完了にする（買い手だけ）
 * DELIVERED -> COMPLETED
 */
app.patch('/orders/:id/complete', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'bad_id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const q = await client.query(
      `SELECT o.id, o.status, o.buyer_id, l.seller_id
       FROM orders o
       JOIN listings l ON o.listing_id = l.id
       WHERE o.id = $1
       FOR UPDATE`,
      [id]
    );
    if (q.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    const o = q.rows[0];

    // 購入者以外は操作禁止
    if (o.buyer_id !== req.user.uid) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'forbidden' });
    }

    // DELIVERED のときだけ COMPLETED に進める
    if (o.status !== 'DELIVERED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'bad_status' });
    }

    const u = await client.query(
      `UPDATE orders
       SET status = 'COMPLETED',
           confirmed_at = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    await client.query('COMMIT');
    return res.json(u.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});


// =========================
// 取引メッセージ API
// =========================

app.get('/orders/:id/messages', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({error:'bad_id'});

  try{
    const q1 = await pool.query(
      `SELECT o.id, o.buyer_id, o.status, l.seller_id
         FROM orders o
         JOIN listings l ON o.listing_id = l.id
        WHERE o.id = $1`,
      [id]
    );
    if(q1.rowCount === 0) return res.status(404).json({error:'not_found'});
    const o = q1.rows[0];

    if(req.user.role !== 'admin'){
      if(o.buyer_id !== req.user.uid && o.seller_id !== req.user.uid){
        return res.status(403).json({error:'forbidden'});
      }
    }

    const q2 = await pool.query(
      `SELECT id, order_id, sender_id, body, created_at
         FROM order_messages
        WHERE order_id = $1
        ORDER BY id ASC`,
      [id]
    );

    return res.json(q2.rows);
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

app.post('/orders/:id/messages', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({error:'bad_id'});

  const { text } = req.body || {};
  const body = (text || '').trim();
  if(!body) return res.status(400).json({error:'empty'});

  try{
    const q1 = await pool.query(
      `SELECT o.id, o.buyer_id, o.status, l.seller_id
         FROM orders o
         JOIN listings l ON o.listing_id = l.id
        WHERE o.id = $1`,
      [id]
    );
    if(q1.rowCount === 0) return res.status(404).json({error:'not_found'});
    const o = q1.rows[0];

    if(req.user.role === 'admin'){
      return res.status(403).json({error:'admin_view_only'});
    }

    if(o.buyer_id !== req.user.uid && o.seller_id !== req.user.uid){
      return res.status(403).json({error:'forbidden'});
    }

    if(o.status === 'COMPLETED'){
      return res.status(409).json({error:'completed'});
    }

    const q2 = await pool.query(
      `INSERT INTO order_messages(order_id, sender_id, body)
       VALUES($1,$2,$3)
       RETURNING id, order_id, sender_id, body, created_at`,
      [id, req.user.uid, body]
    );

    return res.status(201).json(q2.rows[0]);
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

// admin 用：全ての取引一覧（画像付き）
app.get('/orders/admin/all', authRequired, async (req,res)=>{
  try{
    if(req.user.role !== 'admin'){
      return res.status(403).json({error:'forbidden'});
    }

    const q = await pool.query(
      `SELECT
         o.id,
         o.status,
         o.buyer_id,
         o.listing_id,
         o.created_at,
         o.shipped_at,
         o.delivered_at,
         o.confirmed_at,
         l.title,
         l.price,
         l.seller_id,
         l.image_url
       FROM orders o
       JOIN listings l ON o.listing_id = l.id
       ORDER BY o.id DESC`
    );

    return res.json(q.rows);
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

// 発送コードから発送先情報を取得するAPI（ヤマト想定）
// 認証なしでアクセスできる前提の設計例
app.get('/shipping/:code', async (req, res) => {
  const code = req.params.code || '';

  if (!code) {
    return res.status(400).json({ error: 'bad_code' });
  }

  try {
    const q = await pool.query(
      `SELECT
         o.id          AS order_id,
         o.shipping_name,
         o.shipping_postal_code,
         o.shipping_address1,
         o.shipping_address2,
         o.shipping_phone,
         o.shipping_code,
         o.yamato_tracking_no,
         o.yamato_status,
         l.id          AS listing_id,
         l.title,
         l.price
       FROM orders o
       JOIN listings l ON o.listing_id = l.id
       WHERE o.shipping_code = $1`,
      [code]
    );

    if (q.rowCount === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    const o = q.rows[0];

    return res.json({
      order_id:           o.order_id,
      listing_id:         o.listing_id,
      title:              o.title,
      price:              o.price,
      shipping_name:      o.shipping_name,
      shipping_postal_code: o.shipping_postal_code,
      shipping_address1:  o.shipping_address1,
      shipping_address2:  o.shipping_address2,
      shipping_phone:     o.shipping_phone,
      shipping_code:      o.shipping_code,
      yamato_tracking_no: o.yamato_tracking_no,
      yamato_status:      o.yamato_status
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});


const PORT = process.env.PORT || 4020;
app.listen(PORT, ()=>console.log('listening on', PORT));
