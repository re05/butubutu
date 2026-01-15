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

function getJson(urlStr, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: 'GET',
        headers: {
          ...(headers || {}),
          'Accept': 'application/json'
        }
      },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          let json = null;
          try { json = buf ? JSON.parse(buf) : null; } catch { json = null; }
          resolve({ status: res.statusCode || 0, json, raw: buf });
        });
      }
    );

    req.on('error', reject);
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

async function fetchListingSummaryViaListingSvc(ids) {
  const base = process.env.LISTING_SVC_URL || 'http://listing-svc:4010';
  const token = process.env.INTERNAL_TOKEN || '';
  const resp = await postJson(
    `${base}/internal/listings/summary`,
    { 'X-Internal-Token': token },
    { ids }
  );
  if (!(resp.status >= 200 && resp.status < 300)) {
    throw new Error(`listing_summary_failed status=${resp.status} body=${resp.text}`);
  }
  return resp.json;
}

async function postFxTrade(payload) {
  const base = process.env.FX_SVC_URL || 'http://fx-svc:4030';
  const token = process.env.INTERNAL_TOKEN || '';
  const resp = await postJson(
    `${base}/internal/fx/trades`,
    { 'X-Internal-Token': token },
    payload
  );
  if (!(resp.status >= 200 && resp.status < 300)) {
    throw new Error(`fx_post_failed status=${resp.status} body=${resp.text}`);
  }
  return resp.json;
}


async function ensureShippingLabelsForTrade(tradeId, proposerId, receiverId) {
  const base = process.env.SHIPPING_SVC_URL || 'http://shipping-svc:4040';
  const token = process.env.INTERNAL_TOKEN || '';
  if (!token) throw new Error('missing_internal_token');

  // trade_items から簡易サマリを作る（ラベルに載せるため）
  const r = await pool.query(
    `SELECT side, listing_id, quantity
       FROM trade_items
      WHERE trade_id=$1
      ORDER BY side ASC, listing_id ASC`,
    [tradeId]
  );
  const rows = r.rows || [];
  const give = rows.filter((x) => x.side === 'give');
  const take = rows.filter((x) => x.side === 'take');

  const fmt = (arr) => arr.map((x) => `listing#${Number(x.listing_id)} x${Number(x.quantity)}`).join(', ');
  const giveSummary = fmt(give);
  const takeSummary = fmt(take);

  const a = await postJson(
    `${base}/internal/labels`,
    { 'X-Internal-Token': token },
    { trade_id: tradeId, direction: 'A_to_B', from_user_id: proposerId, to_user_id: receiverId, item_summary: giveSummary }
  );
  const b = await postJson(
    `${base}/internal/labels`,
    { 'X-Internal-Token': token },
    { trade_id: tradeId, direction: 'B_to_A', from_user_id: receiverId, to_user_id: proposerId, item_summary: takeSummary }
  );

  const okA = a.status >= 200 && a.status < 300;
  const okB = b.status >= 200 && b.status < 300;

  return {
    a_to_b: okA ? a.json?.label_code : null,
    b_to_a: okB ? b.json?.label_code : null
  };
}

async function buildFxPayloadFromTrade(tradeId) {
  const r = await pool.query(
    `SELECT side, listing_id, quantity
       FROM trade_items
      WHERE trade_id=$1`,
    [tradeId]
  );
  const rows = r.rows || [];
  const give = rows.filter((x) => x.side === 'give');
  const take = rows.filter((x) => x.side === 'take');
  if (give.length === 0 || take.length === 0) throw new Error('fx_items_missing');

  const ids = [...new Set(rows.map((x) => Number(x.listing_id)))];
  const sum = await fetchListingSummaryViaListingSvc(ids);
  if (Array.isArray(sum?.missing) && sum.missing.length) {
    throw new Error(`fx_missing_listing_ids=${sum.missing.join(',')}`);
  }

  const map = new Map((sum.listings || []).map((x) => [Number(x.id), x]));

  const giveFruitIds = new Set(give.map((it) => Number(map.get(Number(it.listing_id))?.fruit_item_id)));
  const takeFruitIds = new Set(take.map((it) => Number(map.get(Number(it.listing_id))?.fruit_item_id)));
  if (giveFruitIds.size !== 1 || takeFruitIds.size !== 1) throw new Error('fx_requires_single_fruit_each_side');

  const from_fruit_item_id = [...giveFruitIds][0];
  const to_fruit_item_id = [...takeFruitIds][0];
  if (!from_fruit_item_id || !to_fruit_item_id || from_fruit_item_id === to_fruit_item_id) throw new Error('fx_bad_fruits');

  const from_qty = give.reduce((s, it) => s + Number(it.quantity), 0);
  const to_qty = take.reduce((s, it) => s + Number(it.quantity), 0);
  if (!Number.isInteger(from_qty) || from_qty <= 0 || !Number.isInteger(to_qty) || to_qty <= 0) throw new Error('fx_bad_qty');

  const t = await pool.query(`SELECT completed_at FROM trades WHERE id=$1`, [tradeId]);
  const completed_at = t.rows?.[0]?.completed_at || new Date().toISOString();

  return { trade_id: tradeId, from_fruit_item_id, to_fruit_item_id, from_qty, to_qty, completed_at };
}




async function validateTradeItemOwnership({ give_items, take_items, proposer_id, receiver_id }) {
  const ids = [...new Set([...give_items, ...take_items].map((x) => Number(x.listing_id)))];

  let sum;
  try {
    // listing-svc の /internal/listings/summary は { listings, missing } を返す
    sum = await fetchListingSummaryViaListingSvc(ids);
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: { error: 'listing_summary_failed', detail: String(e?.message || e) }
    };
  }

  const listings = Array.isArray(sum?.listings) ? sum.listings : [];
  const missing = Array.isArray(sum?.missing) ? sum.missing : [];

  if (missing.length) {
    return { ok: false, status: 404, error: { error: 'listing_not_found', missing } };
  }

  const map = new Map(listings.map((x) => [Number(x.id), x]));

  // give は proposer の出品
  for (const it of give_items) {
    const id = Number(it.listing_id);
    const row = map.get(id);
    if (!row) return { ok: false, status: 404, error: { error: 'listing_not_found', listing_id: id } };

    if (Number(row.seller_id) !== Number(proposer_id)) {
      return { ok: false, status: 403, error: { error: 'give_not_owned', listing_id: id, owner_id: Number(row.seller_id) } };
    }
    if (String(row.status) !== 'Active') {
      return { ok: false, status: 409, error: { error: 'give_not_active', listing_id: id, status: String(row.status) } };
    }
    if (Number(row.quantity) < Number(it.quantity)) {
      return { ok: false, status: 409, error: { error: 'give_insufficient_stock', listing_id: id, have: Number(row.quantity), want: Number(it.quantity) } };
    }
  }

  // take は receiver の出品
  for (const it of take_items) {
    const id = Number(it.listing_id);
    const row = map.get(id);
    if (!row) return { ok: false, status: 404, error: { error: 'listing_not_found', listing_id: id } };

    if (Number(row.seller_id) !== Number(receiver_id)) {
      return { ok: false, status: 403, error: { error: 'take_not_owned', listing_id: id, owner_id: Number(row.seller_id) } };
    }
    if (String(row.status) !== 'Active') {
      return { ok: false, status: 409, error: { error: 'take_not_active', listing_id: id, status: String(row.status) } };
    }
    if (Number(row.quantity) < Number(it.quantity)) {
      return { ok: false, status: 409, error: { error: 'take_insufficient_stock', listing_id: id, have: Number(row.quantity), want: Number(it.quantity) } };
    }
  }

  return { ok: true, status: 200 };
}


function internalRequired(req, res, next) {
  const token = (req.header('X-Internal-Token') || '').toString();
  if (!token || token !== (process.env.INTERNAL_TOKEN || '')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
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

    // 取引に入れる listing の持ち主を検証（give は自分、take は相手）
  const chk = await validateTradeItemOwnership({
    give_items,
    take_items,
    proposer_id: req.user.uid,
    receiver_id
  });
  if (!chk.ok) {
    return res.status(chk.status || 500).json(chk.error || { error: 'ownership_check_failed' });
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

    let shipping_labels = [];
    try {
      const base = process.env.SHIPPING_SVC_URL || 'http://shipping-svc:4040';
      const token = process.env.INTERNAL_TOKEN || '';
      if (token) {
        const resp = await getJson(`${base}/internal/trades/${id}/labels`, { 'X-Internal-Token': token });
        if (resp.status >= 200 && resp.status < 300) {
          shipping_labels = Array.isArray(resp.json?.labels) ? resp.json.labels : [];
        }
      }
    } catch (e) {
      // shipping-svc 取得失敗でも取引本体は返す（デモでは許容）
      shipping_labels = [];
    }

    return res.json({ ...trade, items: items.rows, shipping_labels });
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
    
        // 承諾時にも再チェック（ここが一番重要：ここを通ると在庫が減る）
    const chk = await validateTradeItemOwnership({
      give_items: giveItems,
      take_items: takeItems,
      proposer_id: trade.proposer_id,
      receiver_id: trade.receiver_id
    });
    if (!chk.ok) {
      await client.query('ROLLBACK');
      return res.status(chk.status || 500).json(chk.error || { error: 'ownership_check_failed' });
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

    // shipping-svc にラベル作成（失敗しても取引は成立済みにする。後で再実行できるよう shipping-svc 側は冪等）
    let shipping_labels = null;
    try {
      shipping_labels = await ensureShippingLabelsForTrade(id, u.rows[0].proposer_id, u.rows[0].receiver_id);
    } catch (e) {
      console.error('ensureShippingLabelsForTrade failed', e);
    }

    return res.json({ ...u.rows[0], shipping_labels });

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

        // 取引に入れる listing の持ち主を検証（give は proposer、take は receiver）
    const chk = await validateTradeItemOwnership({
      give_items,
      take_items,
      proposer_id: trade.proposer_id,
      receiver_id: trade.receiver_id
    });
    if (!chk.ok) {
      await client.query('ROLLBACK');
      return res.status(chk.status || 500).json(chk.error || { error: 'ownership_check_failed' });
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
 * 到着通知
 */
app.patch('/trades/:id/received', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad_id' });

  const uid = Number(req.user.uid);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const t = await client.query(`SELECT * FROM trades WHERE id=$1 FOR UPDATE`, [id]);
    const trade = t.rows[0];
    if (!trade) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    const proposerId = Number(trade.proposer_id);
    const receiverId = Number(trade.receiver_id);

    const isProposer = uid === proposerId;
    const isReceiver = uid === receiverId;
    if (!isProposer && !isReceiver) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'forbidden' });
    }

    // 受取確認は「相手が発送していること」が条件
    const myReceivedCol = isProposer ? 'received_proposer_at' : 'received_receiver_at';
    const otherShippedCol = isProposer ? 'shipped_receiver_at' : 'shipped_proposer_at';

    if (!trade[otherShippedCol]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'other_not_shipped_yet' });
    }

    if (trade[myReceivedCol]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'already_received' });
    }

    // ステータスは Shipping に寄せる（Accepted のままでも整合が崩れないように）
    const now = new Date();
    await client.query(
      `UPDATE trades
          SET ${myReceivedCol} = $2,
              status = CASE WHEN status='Accepted' THEN 'Shipping' ELSE status END
        WHERE id=$1`,
      [id, now]
    );

    // 両方が受取確認したら Completed
    const t2 = await client.query(`SELECT * FROM trades WHERE id=$1`, [id]);
    let finalRow = t2.rows[0];

    if (finalRow.received_proposer_at && finalRow.received_receiver_at && finalRow.status !== 'Completed') {
      const c = await client.query(
        `UPDATE trades SET status='Completed', completed_at=now() WHERE id=$1 RETURNING *`,
        [id]
      );
      finalRow = c.rows[0];
    }

    await client.query('COMMIT');

    // Completed になったら為替実績を登録（失敗しても取引自体は成立させる）
    if (finalRow?.status === 'Completed') {
      try {
        const payload = await buildFxPayloadFromTrade(id);
        await postFxTrade(payload);
      } catch (e) {
        console.error('fx_post_error', e);
      }
    }

    return res.json(finalRow);

  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  } finally {
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

app.post('/internal/fx/backfill', internalRequired, async (req, res) => {
  const ids = Array.isArray(req.body?.trade_ids) ? req.body.trade_ids : [];
  const tradeIds = [...new Set(ids.map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  if (tradeIds.length === 0) return res.status(400).json({ error: 'trade_ids_required' });

  const results = [];
  for (const id of tradeIds) {
    try {
      const payload = await buildFxPayloadFromTrade(id);
      await postFxTrade(payload);
      results.push({ trade_id: id, ok: true });
    } catch (e) {
      results.push({ trade_id: id, ok: false, error: String(e?.message || e) });
    }
  }
  return res.json({ results });
});


const PORT = process.env.PORT || 4020;
app.listen(PORT, ()=>console.log('trade-svc listening on', PORT));