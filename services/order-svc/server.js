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
    const p = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    req.user = { uid: Number(p.uid), role: p.role || 'user', email: String(p.sub || '') };
    req.rawAuthHeader = h;
    next();
  }catch(e){
    console.error('jwt verify error (order-svc)', e);
    return res.status(401).json({error:'unauthorized'});
  }
}

function generateShippingCode(){
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return 'C2C-' + rand;
}

async function postJson(url, headers, bodyObj){
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', ...headers },
    body: bodyObj ? JSON.stringify(bodyObj) : '{}'
  });
  const text = await r.text();
  let json = null;
  try{ json = text ? JSON.parse(text) : null; }catch{ json = null; }
  return { ok: r.ok, status: r.status, json };
}

async function getJson(url, headers){
  const r = await fetch(url, { headers });
  const text = await r.text();
  let json = null;
  try{ json = text ? JSON.parse(text) : null; }catch{ json = null; }
  return { ok: r.ok, status: r.status, json };
}

app.get('/health',(req,res)=>res.json({ok:true, service:'order-svc'}));

app.post('/orders', authRequired, async (req,res)=>{
  const listingId = Number(req.body?.listingId);
  if(!Number.isInteger(listingId)) return res.status(400).json({error:'bad_request'});

  const LISTING_URL = process.env.LISTING_URL;
  const AUTH_URL = process.env.AUTH_URL;
  const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

  if(!LISTING_URL || !AUTH_URL || !INTERNAL_API_KEY){
    return res.status(500).json({ error:'server_misconfigured' });
  }

  let checkedOut = false;

  try{
    // 1) listing-svc に「購入確定」を依頼（Sold にする）
    const ck = await postJson(
      `${LISTING_URL}/internal/listings/${listingId}/checkout`,
      { 'Authorization': req.rawAuthHeader, 'x-internal-key': INTERNAL_API_KEY },
      {}
    );

    if(!ck.ok){
      return res.status(ck.status).json(ck.json || { error:'checkout_failed' });
    }
    checkedOut = true;
    const listing = ck.json; // {id,title,price,seller_id,image_url}

    // 2) auth-svc から購入者住所を取得
    const me = await getJson(
      `${AUTH_URL}/me/address`,
      { 'Authorization': req.rawAuthHeader }
    );
    if(!me.ok){
      // 住所が取れないなら購入を成立させない（Sold を戻す）
      await postJson(
        `${LISTING_URL}/internal/listings/${listingId}/revert`,
        { 'x-internal-key': INTERNAL_API_KEY },
        {}
      );
      return res.status(me.status).json(me.json || { error:'address_failed' });
    }

    const u = me.json;
    const shippingName = u.full_name;
    const shippingPostalCode = u.postal_code;
    const shippingAddress1 = `${u.prefecture}${u.city}${u.address_line}`;
    const shippingAddress2 = '';
    const shippingPhone = u.phone;

    const shippingCode = generateShippingCode();

    // 3) order-db に注文とラベルを保存（order-db だけ）
    const client = await pool.connect();
    try{
      await client.query('BEGIN');

      const q2 = await client.query(
        `INSERT INTO orders(
          listing_id,
          listing_title,
          listing_price,
          listing_image_url,
          seller_id,
          buyer_id,
          status,
          shipping_code,
          yamato_status
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING
          id, status, created_at, shipping_code,
          listing_id,
          listing_title AS title,
          listing_price AS price,
          listing_image_url AS image_url,
          seller_id, buyer_id,
          yamato_status, shipped_at, delivered_at, confirmed_at`,
        [
          listing.id,
          listing.title,
          listing.price,
          listing.image_url || null,
          Number(listing.seller_id),
          req.user.uid,
          'CREATED',
          shippingCode,
          'PENDING'
        ]
      );

      const o = q2.rows[0];

      await client.query(
        `INSERT INTO shipping_labels(code, order_id, name, postal_code, address1, address2, phone)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [shippingCode, o.id, shippingName, shippingPostalCode, shippingAddress1, shippingAddress2, shippingPhone]
      );

      await client.query('COMMIT');

      return res.status(201).json({
        id: o.id,
        status: o.status,
        created_at: o.created_at,
        shipping_code: o.shipping_code,
        listing: {
          id: o.listing_id,
          title: o.title,
          price: o.price,
          seller_id: o.seller_id,
          image_url: o.image_url
        },
        buyer_id: o.buyer_id
      });
    }catch(e){
      await client.query('ROLLBACK');
      throw e;
    }finally{
      client.release();
    }

  }catch(e){
    console.error(e);

    // 注文作成に失敗していたら Sold を戻す
    if(checkedOut){
      try{
        await postJson(
          `${process.env.LISTING_URL}/internal/listings/${listingId}/revert`,
          { 'x-internal-key': process.env.INTERNAL_API_KEY },
          {}
        );
      }catch{}
    }
    return res.status(500).json({ error:'server_error' });
  }
});

app.get('/orders/buyer/me', authRequired, async (req,res)=>{
  try{
    const q = await pool.query(
      `SELECT
        id, status, created_at, buyer_id,
        listing_id,
        listing_title AS title,
        listing_price AS price,
        listing_image_url AS image_url,
        seller_id
      FROM orders
      WHERE buyer_id=$1
      ORDER BY id DESC`,
      [req.user.uid]
    );
    return res.json(q.rows);
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:'server_error' });
  }
});

app.get('/orders/seller/me', authRequired, async (req,res)=>{
  try{
    const q = await pool.query(
      `SELECT
        id, status, created_at, buyer_id,
        listing_id,
        listing_title AS title,
        listing_price AS price,
        listing_image_url AS image_url,
        seller_id
      FROM orders
      WHERE seller_id=$1
      ORDER BY id DESC`,
      [req.user.uid]
    );
    return res.json(q.rows);
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:'server_error' });
  }
});

app.get('/orders/:id', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({ error:'bad_id' });

  try{
    const q = await pool.query(
      `SELECT
        id,
        listing_id,
        listing_title AS title,
        listing_price AS price,
        listing_image_url AS image_url,
        seller_id, buyer_id,
        status, created_at, shipped_at, delivered_at, confirmed_at,
        yamato_tracking_no, yamato_status
      FROM orders
      WHERE id=$1`,
      [id]
    );
    if(q.rowCount===0) return res.status(404).json({ error:'not_found' });

    const o = q.rows[0];

    if(req.user.role !== 'admin' && o.seller_id !== req.user.uid && o.buyer_id !== req.user.uid){
      return res.status(403).json({ error:'forbidden' });
    }

    return res.json(o);
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:'server_error' });
  }
});

app.patch('/orders/:id/ship', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({ error:'bad_id' });

  const client = await pool.connect();
  try{
    await client.query('BEGIN');

    const q = await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`, [id]);
    if(q.rowCount===0){
      await client.query('ROLLBACK');
      return res.status(404).json({ error:'not_found' });
    }
    const o = q.rows[0];

    if(o.seller_id !== req.user.uid) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error:'forbidden' });
    }
    if(o.status !== 'CREATED'){
      await client.query('ROLLBACK');
      return res.status(400).json({ error:'bad_status' });
    }

    const u = await client.query(
      `UPDATE orders
          SET status='SHIPPED', shipped_at=now()
        WHERE id=$1
      RETURNING
        id,
        listing_id,
        listing_title AS title,
        listing_price AS price,
        listing_image_url AS image_url,
        seller_id, buyer_id,
        status, created_at, shipped_at, delivered_at, confirmed_at,
        yamato_tracking_no, yamato_status`,
      [id]
    );


    await client.query('COMMIT');
    return res.json(u.rows[0]);
  }catch(e){
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error:'server_error' });
  }finally{
    client.release();
  }
});

app.patch('/orders/:id/deliver', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({ error:'bad_id' });

  const client = await pool.connect();
  try{
    await client.query('BEGIN');

    const q = await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`, [id]);
    if(q.rowCount===0){
      await client.query('ROLLBACK');
      return res.status(404).json({ error:'not_found' });
    }
    const o = q.rows[0];

    if(o.buyer_id !== req.user.uid) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error:'forbidden' });
    }
    if(o.status !== 'SHIPPED'){
      await client.query('ROLLBACK');
      return res.status(400).json({ error:'bad_status' });
    }

    const u = await client.query(
      `UPDATE orders
          SET status='SHIPPED', shipped_at=now()
        WHERE id=$1
      RETURNING
        id,
        listing_id,
        listing_title AS title,
        listing_price AS price,
        listing_image_url AS image_url,
        seller_id, buyer_id,
        status, created_at, shipped_at, delivered_at, confirmed_at,
        yamato_tracking_no, yamato_status`,
      [id]
    );


    await client.query('COMMIT');
    return res.json(u.rows[0]);
  }catch(e){
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error:'server_error' });
  }finally{
    client.release();
  }
});

app.patch('/orders/:id/complete', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({ error:'bad_id' });

  const client = await pool.connect();
  try{
    await client.query('BEGIN');

    const q = await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`, [id]);
    if(q.rowCount===0){
      await client.query('ROLLBACK');
      return res.status(404).json({ error:'not_found' });
    }
    const o = q.rows[0];

    if(o.buyer_id !== req.user.uid) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error:'forbidden' });
    }
    if(o.status !== 'DELIVERED'){
      await client.query('ROLLBACK');
      return res.status(400).json({ error:'bad_status' });
    }

    const u = await client.query(
      `UPDATE orders
          SET status='SHIPPED', shipped_at=now()
        WHERE id=$1
      RETURNING
        id,
        listing_id,
        listing_title AS title,
        listing_price AS price,
        listing_image_url AS image_url,
        seller_id, buyer_id,
        status, created_at, shipped_at, delivered_at, confirmed_at,
        yamato_tracking_no, yamato_status`,
      [id]
    );


    await client.query('COMMIT');
    return res.json(u.rows[0]);
  }catch(e){
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error:'server_error' });
  }finally{
    client.release();
  }
});

app.get('/orders/:id/messages', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({ error:'bad_id' });

  try{
    const q0 = await pool.query(`SELECT seller_id,buyer_id FROM orders WHERE id=$1`, [id]);
    if(q0.rowCount===0) return res.status(404).json({ error:'not_found' });

    const o = q0.rows[0];
    if(req.user.role !== 'admin' && o.seller_id !== req.user.uid && o.buyer_id !== req.user.uid){
      return res.status(403).json({ error:'forbidden' });
    }

    const q = await pool.query(
      `SELECT id,order_id,sender_id,body,created_at
         FROM order_messages
        WHERE order_id=$1
        ORDER BY id ASC`,
      [id]
    );
    return res.json(q.rows);
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:'server_error' });
  }
});

app.post('/orders/:id/messages', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({ error:'bad_id' });

  const body = String(req.body?.text || '').trim();
  if(!body) return res.status(400).json({ error:'empty' });

  try{
    const q0 = await pool.query(`SELECT seller_id,buyer_id,status FROM orders WHERE id=$1`, [id]);
    if(q0.rowCount===0) return res.status(404).json({ error:'not_found' });

    const o = q0.rows[0];

    if(req.user.role === 'admin') return res.status(403).json({ error:'admin_view_only' });
    if(o.status === 'COMPLETED') return res.status(409).json({ error:'completed' });

    if(o.seller_id !== req.user.uid && o.buyer_id !== req.user.uid){
      return res.status(403).json({ error:'forbidden' });
    }

    const q = await pool.query(
      `INSERT INTO order_messages(order_id,sender_id,body)
       VALUES($1,$2,$3)
       RETURNING id,order_id,sender_id,body,created_at`,
      [id, req.user.uid, body]
    );
    return res.status(201).json(q.rows[0]);
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:'server_error' });
  }
});

app.get('/orders/admin/all', authRequired, async (req,res)=>{
  if(req.user.role !== 'admin') return res.status(403).json({ error:'forbidden' });
  try{
    const q = await pool.query(
      `SELECT id,status,created_at,shipped_at,delivered_at,confirmed_at,
              buyer_id,seller_id,listing_id,title,price,image_url,yamato_status
         FROM orders
        ORDER BY id DESC`
    );
    return res.json(q.rows);
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:'server_error' });
  }
});

// 発送コード→宛先など（必要なら使う）
app.get('/shipping/:code', async (req,res)=>{
  const code = String(req.params.code || '');
  if(!code) return res.status(400).json({ error:'bad_code' });

  try{
    const q = await pool.query(
      `SELECT
        o.id AS order_id,
        o.listing_id,
        o.listing_title AS title,
        o.listing_price AS price,
        o.yamato_status,
        s.name, s.postal_code, s.address1, s.address2, s.phone, s.code
      FROM shipping_labels s
      JOIN orders o ON o.id = s.order_id
      WHERE s.code=$1`,
      [code]
    );

    if(q.rowCount===0) return res.status(404).json({ error:'not_found' });
    return res.json(q.rows[0]);
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:'server_error' });
  }
});

const PORT = process.env.PORT || 4020;
app.listen(PORT, ()=>console.log('order-svc listening on', PORT));
