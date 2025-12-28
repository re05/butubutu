import express from 'express';
import cors from 'cors';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import http from 'http';
import https from 'https';
import { URL } from 'url';

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
    console.error('jwt verify error (trade-svc)', e);
    return res.status(401).json({error:'unauthorized'});
  }
}

function postJson(urlStr, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(bodyObj);

    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => {
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch {}
          resolve({ status: res.statusCode || 0, json, text });
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function decreaseStockViaListingSvc(items) {
  const base = process.env.LISTING_SVC_URL || 'http://listing-svc:4010';
  const token = process.env.INTERNAL_TOKEN || '';
  if (!token) {
    return { ok: false, status: 500, error: { error: 'missing_internal_token' } };
  }

  const resp = await postJson(
    `${base}/internal/listings/decrease`,
    { 'X-Internal-Token': token },
    { items }
  );

  if (resp.status >= 200 && resp.status < 300) {
    return { ok: true, status: resp.status, data: resp.json };
  }
  return { ok: false, status: resp.status, error: resp.json || { error: 'listing_svc_error', detail: resp.text } };
}

function normalizeItems(arr) {
  const items = Array.isArray(arr) ? arr : [];
  const out = [];
  for (const it of items) {
    const listing_id = Number(it?.listing_id);
    const quantity = Number(it?.quantity);
    if (!Number.isInteger(listing_id) || !Number.isInteger(quantity) || quantity <= 0) {
      return null;
    }
    out.push({ listing_id, quantity });
  }
  return out;
}

app.get('/health',(req,res)=>res.json({ok:true, service:'trade-svc'}));

/**
 * 交換提案作成
 * body:
 * {
 *   receiver_id: number,
 *   proposal_message?: string,
 *   give_items: [{listing_id, quantity}],
 *   take_items: [{listing_id, quantity}]
 * }
 */
app.post('/trades', authRequired, async (req,res)=>{
  const receiver_id = Number(req.body?.receiver_id);
  const proposal_message = (req.body?.proposal_message || '').toString();
  const give_items = normalizeItems(req.body?.give_items);
  const take_items = normalizeItems(req.body?.take_items);

  if (!Number.isInteger(receiver_id) || receiver_id <= 0) {
    return res.status(400).json({ error: 'bad_receiver_id' });
  }
  if (receiver_id === req.user.uid) {
    return res.status(400).json({ error: 'self_trade' });
  }
  if (!give_items || give_items.length === 0) {
    return res.status(400).json({ error: 'give_items_required' });
  }
  if (!take_items || take_items.length === 0) {
    return res.status(400).json({ error: 'take_items_required' });
  }

  const client = await pool.connect();
  try{
    await client.query('BEGIN');

    const t = await client.query(
      `INSERT INTO trades(proposer_id, receiver_id, status, proposal_message)
       VALUES($1,$2,$3,$4)
       RETURNING id, proposer_id, receiver_id, status, proposal_message, created_at, accepted_at,
          shipped_proposer_at, shipped_receiver_at,
          received_proposer_at, received_receiver_at,
          completed_at
`,
      [req.user.uid, receiver_id, 'Proposed', proposal_message]
    );

    const trade = t.rows[0];

    for (const it of give_items) {
      await client.query(
        `INSERT INTO trade_items(trade_id, side, listing_id, quantity)
         VALUES($1,$2,$3,$4)`,
        [trade.id, 'give', it.listing_id, it.quantity]
      );
    }
    for (const it of take_items) {
      await client.query(
        `INSERT INTO trade_items(trade_id, side, listing_id, quantity)
         VALUES($1,$2,$3,$4)`,
        [trade.id, 'take', it.listing_id, it.quantity]
      );
    }

    await client.query('COMMIT');

    return res.status(201).json({
      ...trade,
      items: { give: give_items, take: take_items }
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
 * 自分の提案一覧（送信箱）
 */
app.get('/trades/me/outbox', authRequired, async (req,res)=>{
  try{
    const q = await pool.query(
      `SELECT id, proposer_id, receiver_id, status, proposal_message, created_at, accepted_at,
       shipped_proposer_at, shipped_receiver_at,
       received_proposer_at, received_receiver_at,
       completed_at

         FROM trades
        WHERE proposer_id = $1
        ORDER BY id DESC`,
      [req.user.uid]
    );
    return res.json(q.rows);
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

/**
 * 自分の受信一覧（受信箱）
 */
app.get('/trades/me/inbox', authRequired, async (req,res)=>{
  try{
    const q = await pool.query(
      `SELECT id, proposer_id, receiver_id, status, proposal_message, created_at, accepted_at,
       shipped_proposer_at, shipped_receiver_at,
       received_proposer_at, received_receiver_at,
       completed_at

         FROM trades
        WHERE receiver_id = $1
        ORDER BY id DESC`,
      [req.user.uid]
    );
    return res.json(q.rows);
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

/**
 * 取引詳細（items込み）
 */
app.get('/trades/:id', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({error:'bad_id'});

  try{
    const t = await pool.query(
      `SELECT id, proposer_id, receiver_id, status, proposal_message, created_at, accepted_at,
       shipped_proposer_at, shipped_receiver_at,
       received_proposer_at, received_receiver_at,
       completed_at

         FROM trades
        WHERE id = $1`,
      [id]
    );
    if(t.rowCount === 0) return res.status(404).json({error:'not_found'});

    const trade = t.rows[0];

    if (trade.proposer_id !== req.user.uid && trade.receiver_id !== req.user.uid && req.user.role !== 'admin') {
      return res.status(403).json({error:'forbidden'});
    }

    const items = await pool.query(
      `SELECT side, listing_id, quantity
         FROM trade_items
        WHERE trade_id = $1
        ORDER BY id ASC`,
      [id]
    );

    return res.json({ ...trade, items: items.rows });
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

/**
 * 承諾（受信者だけ）
 * Proposed -> Accepted
 * ここで listing-svc に在庫減算を依頼する（DB分離のため）
 */
app.patch('/trades/:id/accept', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({error:'bad_id'});

  const client = await pool.connect();
  try{
    await client.query('BEGIN');

    const t = await client.query(
      `SELECT id, proposer_id, receiver_id, status
         FROM trades
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    if(t.rowCount === 0){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'not_found'});
    }

    const trade = t.rows[0];

    if (trade.receiver_id !== req.user.uid) {
      await client.query('ROLLBACK');
      return res.status(403).json({error:'forbidden'});
    }
    if (trade.status !== 'Proposed') {
      await client.query('ROLLBACK');
      return res.status(409).json({error:'bad_status', status: trade.status});
    }

    // give/take 両方を在庫減算（成立したら双方の在庫が減る）
    const it = await client.query(
      `SELECT listing_id, quantity, side
         FROM trade_items
        WHERE trade_id = $1
        ORDER BY id ASC`,
      [id]
    );

    const items = it.rows.map(r => ({ listing_id: Number(r.listing_id), quantity: Number(r.quantity), side: r.side }));
    const giveItems = items.filter(x => x.side === 'give').map(x => ({ listing_id: x.listing_id, quantity: x.quantity }));
    const takeItems = items.filter(x => x.side === 'take').map(x => ({ listing_id: x.listing_id, quantity: x.quantity }));
    if (giveItems.length === 0 || takeItems.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({error:'items_missing'});
    }

    const decItems = [...giveItems, ...takeItems];

    // 外部（listing-svc）で減算（成功したら trade-db を更新）
    const dec = await decreaseStockViaListingSvc(decItems);
    if (!dec.ok) {
      await client.query('ROLLBACK');
      // listing-svc のエラーをそのまま返す（試作はこれで十分）
      return res.status(dec.status || 500).json(dec.error || { error: 'listing_decrease_failed' });
    }

    const u = await client.query(
      `UPDATE trades
          SET status = 'Accepted',
              accepted_at = now()
        WHERE id = $1
        RETURNING id, proposer_id, receiver_id, status, proposal_message, created_at, accepted_at,
          shipped_proposer_at, shipped_receiver_at,
          received_proposer_at, received_receiver_at,
          completed_at
`,
      [id]
    );

    await client.query('COMMIT');
    return res.json(u.rows[0]);

  }catch(e){
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }finally{
    client.release();
  }
});

/**
 * 却下（受信者だけ）
 * Proposed -> Rejected
 */
app.patch('/trades/:id/reject', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({error:'bad_id'});

  const client = await pool.connect();
  try{
    await client.query('BEGIN');

    const t = await client.query(
      `SELECT id, proposer_id, receiver_id, status
         FROM trades
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    if(t.rowCount === 0){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'not_found'});
    }

    const trade = t.rows[0];

    if (trade.receiver_id !== req.user.uid) {
      await client.query('ROLLBACK');
      return res.status(403).json({error:'forbidden'});
    }
    if (trade.status !== 'Proposed') {
      await client.query('ROLLBACK');
      return res.status(409).json({error:'bad_status', status: trade.status});
    }

    const u = await client.query(
      `UPDATE trades
          SET status = 'Rejected'
        WHERE id = $1
        RETURNING id, proposer_id, receiver_id, status, proposal_message, created_at, accepted_at,
          shipped_proposer_at, shipped_receiver_at,
          received_proposer_at, received_receiver_at,
          completed_at
`,
      [id]
    );

    await client.query('COMMIT');
    return res.json(u.rows[0]);

  }catch(e){
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }finally{
    client.release();
  }
});

/**
 * 提案内容（数量）を更新（提案者だけ / Proposed の間だけ）
 * body:
 * { give_items:[{listing_id, quantity}], take_items:[{listing_id, quantity}] }
 */
app.patch('/trades/:id/items', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });

  const give_items = Array.isArray(req.body?.give_items) ? req.body.give_items : null;
  const take_items = Array.isArray(req.body?.take_items) ? req.body.take_items : null;
  if (!give_items?.length) return res.status(400).json({ error: 'give_items_required' });
  if (!take_items?.length) return res.status(400).json({ error: 'take_items_required' });

  // 数値チェック
  for (const it of [...give_items, ...take_items]) {
    const lid = Number(it?.listing_id);
    const q = Number(it?.quantity);
    if (!Number.isInteger(lid) || lid <= 0) return res.status(400).json({ error: 'bad_listing_id' });
    if (!Number.isInteger(q) || q <= 0) return res.status(400).json({ error: 'bad_quantity' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const t = await client.query(
      `SELECT id, proposer_id, receiver_id, status
         FROM trades
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    if (t.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    const trade = t.rows[0];

    // 提案者だけ
    if (Number(trade.proposer_id) !== Number(req.user.uid)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'forbidden' });
    }

    // 承諾前だけ
    if (trade.status !== 'Proposed') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'bad_status', status: trade.status });
    }

    // 既存を消して入れ直す
    await client.query(`DELETE FROM trade_items WHERE trade_id = $1`, [id]);

    for (const it of give_items) {
      await client.query(
        `INSERT INTO trade_items(trade_id, side, listing_id, quantity)
         VALUES ($1, 'give', $2, $3)`,
        [id, Number(it.listing_id), Number(it.quantity)]
      );
    }
    for (const it of take_items) {
      await client.query(
        `INSERT INTO trade_items(trade_id, side, listing_id, quantity)
         VALUES ($1, 'take', $2, $3)`,
        [id, Number(it.listing_id), Number(it.quantity)]
      );
    }

    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});



/**
 * 発送した（当事者だけ）
 * Accepted / Shipping の間で押せる
 * 押した人の shipped_*_at を埋め、status を Shipping にする
 */
/**
 * 発送通知（Accepted/Shipping で、本人分が未発送なら押せる）
 * 押したら status を Shipping にする（Accepted の場合）
 */
app.patch('/trades/:id/ship', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({error:'bad_id'});

  const uid = Number(req.user?.uid || 0);

  const client = await pool.connect();
  try{
    await client.query('BEGIN');

    const t = await client.query(
      `SELECT *
         FROM trades
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    if(t.rowCount === 0){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'not_found'});
    }
    const trade = t.rows[0];

    if (Number(trade.proposer_id) !== uid && Number(trade.receiver_id) !== uid && req.user.role !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(403).json({error:'forbidden'});
    }


    const isProposer = Number(trade.proposer_id) === uid;
    const col = isProposer ? 'shipped_proposer_at' : 'shipped_receiver_at';
    if (trade[col]) {
      await client.query('ROLLBACK');
      return res.status(409).json({error:'already_shipped'});
    }

    const u = await client.query(
      `UPDATE trades
          SET ${col} = now(),
              status = CASE WHEN status='Accepted' THEN 'Shipping' ELSE status END
        WHERE id = $1
      RETURNING *`,
      [id]
    );

    await client.query('COMMIT');
    return res.json(u.rows[0]);
  }catch(e){
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }finally{
    client.release();
  }
});

/**
 * 到着通知（Shipping で、両者発送済みの時だけ）
 * 両者到着済みになったら Completed にする
 */
app.patch('/trades/:id/received', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({error:'bad_id'});

  const uid = Number(req.user?.uid || 0);

  const client = await pool.connect();
  try{
    await client.query('BEGIN');

    const t = await client.query(
      `SELECT *
         FROM trades
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    if(t.rowCount === 0){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'not_found'});
    }
    const trade = t.rows[0];

    if (Number(trade.proposer_id) !== uid && Number(trade.receiver_id) !== uid && req.user.role !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(403).json({error:'forbidden'});
    }

    if (trade.status !== 'Shipping') {
      await client.query('ROLLBACK');
      return res.status(409).json({error:'bad_status', status: trade.status});
    }

    if (!trade.shipped_proposer_at || !trade.shipped_receiver_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({error:'not_both_shipped'});
    }

    const isProposer = Number(trade.proposer_id) === uid;
    const col = isProposer ? 'received_proposer_at' : 'received_receiver_at';
    if (trade[col]) {
      await client.query('ROLLBACK');
      return res.status(409).json({error:'already_received'});
    }

    const u1 = await client.query(
      `UPDATE trades SET ${col}=now() WHERE id=$1 RETURNING *`,
      [id]
    );
    const after = u1.rows[0];

    let finalRow = after;
    if (after.received_proposer_at && after.received_receiver_at) {
      const u2 = await client.query(
        `UPDATE trades SET status='Completed', completed_at=now() WHERE id=$1 RETURNING *`,
        [id]
      );
      finalRow = u2.rows[0];
    }

    await client.query('COMMIT');
    return res.json(finalRow);
  }catch(e){
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }finally{
    client.release();
  }
});



/**
 * 成立後チャット（Accepted 以降のみ）
 */
app.get('/trades/:id/messages', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({error:'bad_id'});

  try{
    const t = await pool.query(
      `SELECT id, proposer_id, receiver_id, status
         FROM trades
        WHERE id = $1`,
      [id]
    );
    if(t.rowCount === 0) return res.status(404).json({error:'not_found'});
    const trade = t.rows[0];

    if (req.user.role !== 'admin') {
      if (trade.proposer_id !== req.user.uid && trade.receiver_id !== req.user.uid) {
        return res.status(403).json({error:'forbidden'});
      }
    }

    // 承諾前(Proposed)でもチャット可能にする（Rejected だけ不可にする）
    const chatOk = ['Proposed', 'Accepted', 'Shipping', 'Completed'];
    if (!chatOk.includes(trade.status)) {
      return res.status(409).json({ error: 'chat_not_allowed', status: trade.status });
    }


    const q = await pool.query(
      `SELECT id, trade_id, sender_id, content, created_at
         FROM trade_messages
        WHERE trade_id = $1
        ORDER BY id ASC`,
      [id]
    );

    return res.json(q.rows);
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

app.post('/trades/:id/messages', authRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({error:'bad_id'});

  const content = (req.body?.content || '').toString().trim();
  if(!content) return res.status(400).json({error:'empty'});

  try{
    const t = await pool.query(
      `SELECT id, proposer_id, receiver_id, status
         FROM trades
        WHERE id = $1`,
      [id]
    );
    if(t.rowCount === 0) return res.status(404).json({error:'not_found'});
    const trade = t.rows[0];

    if (req.user.role === 'admin') {
      return res.status(403).json({error:'admin_view_only'});
    }
    if (trade.proposer_id !== req.user.uid && trade.receiver_id !== req.user.uid) {
      return res.status(403).json({error:'forbidden'});
    }
    // 承諾前(Proposed)でもチャット可能にする（Rejected だけ不可にする）
    const chatOk = ['Proposed', 'Accepted', 'Shipping', 'Completed'];
    if (!chatOk.includes(trade.status)) {
      return res.status(409).json({ error: 'chat_not_allowed', status: trade.status });
    }

    const q = await pool.query(
      `INSERT INTO trade_messages(trade_id, sender_id, content)
       VALUES($1,$2,$3)
       RETURNING id, trade_id, sender_id, content, created_at`,
      [id, req.user.uid, content]
    );

    return res.status(201).json(q.rows[0]);
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

const PORT = process.env.PORT || 4020;
app.listen(PORT, ()=>console.log('trade-svc listening on', PORT));
