import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const pool = new pg.Pool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: "shipping-svc" });
});

// 発送ラベル（印刷想定）
app.get('/labels/:code', async (req, res) => {
  const code = String(req.params.code || '');
  if(!code) return res.status(400).send('code is required');

  try{
    const q = await pool.query(
      `SELECT
        s.code, s.order_id, s.name, s.postal_code, s.address1, s.address2, s.phone,
        o.listing_title AS title,
        o.listing_price AS price
      FROM shipping_labels s
      JOIN orders o ON o.id = s.order_id
      WHERE s.code=$1`,
      [code]
    );

    if(q.rowCount===0) return res.status(404).send('not found');

    const r = q.rows[0];

    res.send(`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>発送ラベル</title>
  <style>
    body { font-family: system-ui, -apple-system, "Segoe UI"; padding: 16px; }
    .box { border:1px solid #333; padding:16px; width: 420px; }
    .muted { color:#666; font-size:12px; }
    .big { font-size:18px; font-weight:700; }
  </style>
</head>
<body>
  <div class="box">
    <div class="muted">発送コード</div>
    <div class="big">${r.code}</div>
    <hr/>
    <div class="muted">宛名</div>
    <div class="big">${r.name}</div>
    <div class="muted">住所</div>
    <div>${r.postal_code}</div>
    <div>${r.address1} ${r.address2 || ''}</div>
    <div class="muted">電話</div>
    <div>${r.phone}</div>
    <hr/>
    <div class="muted">商品</div>
    <div>${r.title}（¥${r.price}）</div>
  </div>
</body>
</html>`);
  }catch(e){
    console.error(e);
    return res.status(500).send('server error');
  }
});

// ヤマト用：注文一覧（COMPLETED以外）
app.get('/yamato/orders', async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT
        o.id as order_id,
        o.status,
        o.yamato_status,
        o.created_at,
        o.listing_title AS title,
        o.listing_price AS price,
        s.code,
        s.name,
        s.postal_code,
        s.address1,
        s.address2,
        s.phone
      FROM orders o
      JOIN shipping_labels s ON s.order_id = o.id
      WHERE o.status <> 'COMPLETED'
      ORDER BY o.id DESC`
    );


    const rows = q.rows;

    res.send(`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>ヤマト用 発送一覧</title>
  <style>
    body { font-family: system-ui, -apple-system, "Segoe UI"; padding: 16px; background:#f7f7f7; }
    table { border-collapse: collapse; width: 100%; background: #fff; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; font-size: 13px; }
    th { background: #eee; }
    .actions form { display:inline-block; margin-right:4px; }
    .badge { padding:2px 6px; border-radius:4px; background:#eee; }
  </style>
</head>
<body>
  <h1>ヤマト用 発送一覧</h1>
  <table>
    <thead>
      <tr>
        <th>注文ID</th>
        <th>発送コード</th>
        <th>商品</th>
        <th>金額</th>
        <th>宛名</th>
        <th>住所</th>
        <th>電話</th>
        <th>ヤマト状況</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => `
        <tr>
          <td>${r.order_id}</td>
          <td><a href="/labels/${r.code}" target="_blank" rel="noopener">${r.code}</a></td>
          <td>${r.title}</td>
          <td>¥${r.price}</td>
          <td>${r.name}</td>
          <td>${r.postal_code} ${r.address1} ${r.address2 || ''}</td>
          <td>${r.phone}</td>
          <td><span class="badge">${r.yamato_status || 'PENDING'}</span></td>
          <td class="actions">
            <form method="POST" action="/yamato/orders/${r.order_id}/status">
              <input type="hidden" name="yamato_status" value="PREPARED" />
              <button type="submit">準備中</button>
            </form>
            <form method="POST" action="/yamato/orders/${r.order_id}/status">
              <input type="hidden" name="yamato_status" value="SHIPPED" />
              <button type="submit">発送済み</button>
            </form>
            <form method="POST" action="/yamato/orders/${r.order_id}/status">
              <input type="hidden" name="yamato_status" value="IN_TRANSIT" />
              <button type="submit">配送中</button>
            </form>
            <form method="POST" action="/yamato/orders/${r.order_id}/status">
              <input type="hidden" name="yamato_status" value="DELIVERED" />
              <button type="submit">配達完了</button>
            </form>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>`);
  } catch (e) {
    console.error(e);
    res.status(500).send('server error');
  }
});

app.post('/yamato/orders/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const yamato_status = String(req.body?.yamato_status || '');

  if (!Number.isInteger(id) || !yamato_status) {
    return res.status(400).send('bad request');
  }

  try {
    await pool.query(
      `UPDATE orders SET yamato_status=$1 WHERE id=$2`,
      [yamato_status, id]
    );
    return res.redirect('/yamato/orders');
  } catch (e) {
    console.error(e);
    return res.status(500).send('server error');
  }
});

const PORT = process.env.PORT || 4030;
app.listen(PORT, () => console.log(`shipping-svc listening on ${PORT}`));
