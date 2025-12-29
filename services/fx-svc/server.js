const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

// ブラウザ( http://localhost:3100 ) から fx-svc( http://localhost:4130 ) を呼べるようにする
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'http://localhost:3100');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Internal-Token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});


const pool = new Pool({
  host: process.env.DB_HOST || 'fx-db',
  user: process.env.DB_USER || 'myuser',
  password: process.env.DB_PASSWORD || 'mypass',
  database: process.env.DB_NAME || 'fxdb',
});

function internalRequired(req, res, next) {
  const token = (req.header('X-Internal-Token') || '').toString();
  if (!token || token !== (process.env.INTERNAL_TOKEN || '')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

function median(nums) {
  const a = nums.slice().sort((x, y) => x - y);
  const n = a.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return a[mid];
  return (a[mid - 1] + a[mid]) / 2;
}

// 取引成立を登録（trade-svc が呼ぶ）
app.post('/internal/fx/trades', internalRequired, async (req, res) => {
  const trade_id = Number(req.body?.trade_id);
  const from_fruit_item_id = Number(req.body?.from_fruit_item_id);
  const to_fruit_item_id = Number(req.body?.to_fruit_item_id);
  const from_qty = Number(req.body?.from_qty);
  const to_qty = Number(req.body?.to_qty);
  const completed_at = req.body?.completed_at ? new Date(req.body.completed_at) : new Date();

  if (!Number.isInteger(trade_id) || trade_id <= 0) return res.status(400).json({ error: 'bad_trade_id' });
  if (!Number.isInteger(from_fruit_item_id) || from_fruit_item_id < 1 || from_fruit_item_id > 5) return res.status(400).json({ error: 'bad_from_fruit_item_id' });
  if (!Number.isInteger(to_fruit_item_id) || to_fruit_item_id < 1 || to_fruit_item_id > 5) return res.status(400).json({ error: 'bad_to_fruit_item_id' });
  if (from_fruit_item_id === to_fruit_item_id) return res.status(400).json({ error: 'same_fruit' });
  if (!Number.isInteger(from_qty) || from_qty <= 0) return res.status(400).json({ error: 'bad_from_qty' });
  if (!Number.isInteger(to_qty) || to_qty <= 0) return res.status(400).json({ error: 'bad_to_qty' });

  try {
    const r = await pool.query(
      `INSERT INTO fx_trades(trade_id, from_fruit_item_id, to_fruit_item_id, from_qty, to_qty, completed_at)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (trade_id) DO NOTHING
       RETURNING *`,
      [trade_id, from_fruit_item_id, to_fruit_item_id, from_qty, to_qty, completed_at]
    );
    if (r.rows.length === 0) return res.json({ ok: true, deduped: true });
    return res.json({ ok: true, trade: r.rows[0] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// 相場を返す（成立取引の中央値）
app.get('/fx/rate', async (req, res) => {
  const from = Number(req.query?.from);
  const to = Number(req.query?.to);
  if (!Number.isInteger(from) || from < 1 || from > 5) return res.status(400).json({ error: 'bad_from' });
  if (!Number.isInteger(to) || to < 1 || to > 5) return res.status(400).json({ error: 'bad_to' });
  if (from === to) return res.json({ from, to, rate: 1, n: 0 });

  try {
    const r = await pool.query(
      `SELECT from_fruit_item_id, to_fruit_item_id, from_qty, to_qty
         FROM fx_trades
        WHERE (from_fruit_item_id=$1 AND to_fruit_item_id=$2)
           OR (from_fruit_item_id=$2 AND to_fruit_item_id=$1)`,
      [from, to]
    );

    const ratios = [];
    for (const row of r.rows) {
      const f = Number(row.from_fruit_item_id);
      const t = Number(row.to_fruit_item_id);
      const fq = Number(row.from_qty);
      const tq = Number(row.to_qty);

      if (f === from && t === to) ratios.push(tq / fq);
      else ratios.push(fq / tq); // 逆方向は反転して揃える
    }

    const m = median(ratios);
    if (m === null) return res.status(404).json({ error: 'no_data', from, to });

    return res.json({ from, to, rate: m, n: ratios.length, method: 'median' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT || 4030);
app.listen(port, () => console.log(`fx-svc listening on ${port}`));
