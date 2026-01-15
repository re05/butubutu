import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import http from 'http';
import https from 'https';

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
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
});

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';
const AUTH_SVC_URL = process.env.AUTH_SVC_URL || 'http://auth-svc:4000';

function internalRequired(req, res, next) {
  const token = (req.header('X-Internal-Token') || '').toString();
  if (!INTERNAL_TOKEN || token !== INTERNAL_TOKEN) {
    return res.status(401).json({ error: 'unauthorized_internal' });
  }
  return next();
}

function genCode() {
  // なるべく短く・衝突しにくいコード
  return 'LB' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getJson(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: { ...headers },
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
    req.end();
  });
}

async function fetchAddress(userId) {
  const token = INTERNAL_TOKEN;
  const resp = await getJson(`${AUTH_SVC_URL}/internal/users/${userId}/address`, { 'X-Internal-Token': token });
  if (resp.status >= 200 && resp.status < 300) return resp.json;
  return null;
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'shipping-svc' });
  } catch (e) {
    return res.status(500).json({ ok: false, service: 'shipping-svc', error: 'db_error' });
  }
});

/**
 * 内部: ラベル作成（冪等）
 * body: { trade_id, direction, from_user_id, to_user_id, item_summary? , label_code? }
 * return: { label_code }
 */
app.post('/internal/labels', internalRequired, async (req, res) => {
  const trade_id = Number(req.body?.trade_id);
  const direction = (req.body?.direction || '').toString();
  const from_user_id = Number(req.body?.from_user_id);
  const to_user_id = Number(req.body?.to_user_id);
  const item_summary = (req.body?.item_summary || '').toString();

  if (!Number.isInteger(trade_id) || trade_id <= 0) return res.status(400).json({ error: 'bad_trade_id' });
  if (!direction) return res.status(400).json({ error: 'direction_required' });
  if (!Number.isInteger(from_user_id) || from_user_id <= 0) return res.status(400).json({ error: 'bad_from_user_id' });
  if (!Number.isInteger(to_user_id) || to_user_id <= 0) return res.status(400).json({ error: 'bad_to_user_id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, label_code
         FROM shipping_labels
        WHERE trade_id=$1 AND direction=$2
        FOR UPDATE`,
      [trade_id, direction]
    );

    if (existing.rowCount > 0) {
      await client.query('COMMIT');
      return res.json({ label_code: existing.rows[0].label_code });
    }

    const label_code = (req.body?.label_code || '').toString().trim() || genCode();

    const ins = await client.query(
      `INSERT INTO shipping_labels(trade_id, direction, label_code, from_user_id, to_user_id, item_summary)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, label_code`,
      [trade_id, direction, label_code, from_user_id, to_user_id, item_summary]
    );

    await client.query(
      `INSERT INTO shipping_events(label_id, event, note) VALUES ($1,'Created',$2)`,
      [ins.rows[0].id, item_summary ? 'created_with_item_summary' : null]
    );

    await client.query('COMMIT');
    return res.status(201).json({ label_code: ins.rows[0].label_code });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('create label error', e);
    return res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});

/** 内部: 取引IDからラベル一覧 */
app.get('/internal/trades/:id/labels', internalRequired, async (req, res) => {
  const trade_id = Number(req.params.id);
  if (!Number.isInteger(trade_id) || trade_id <= 0) return res.status(400).json({ error: 'bad_trade_id' });
  try {
    const r = await pool.query(
      `SELECT trade_id, direction, label_code, status, created_at, updated_at
         FROM shipping_labels
        WHERE trade_id=$1
        ORDER BY direction ASC`,
      [trade_id]
    );
    return res.json({ labels: r.rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

/** ラベル表示（印刷用） */
app.get('/labels/:code', async (req, res) => {
  const code = (req.params.code || '').toString().trim();
  if (!code) return res.status(400).send('bad code');

  try {
    const r = await pool.query(
      `SELECT id, trade_id, direction, label_code, from_user_id, to_user_id, item_summary, status, created_at
         FROM shipping_labels
        WHERE label_code=$1`,
      [code]
    );
    if (r.rowCount === 0) return res.status(404).send('not found');

    const row = r.rows[0];
    const fromAddr = await fetchAddress(row.from_user_id);
    const toAddr = await fetchAddress(row.to_user_id);

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Shipping Label ${esc(row.label_code)}</title>
  <style>
    body { font-family: sans-serif; margin: 24px; }
    .box { border: 1px solid #333; padding: 16px; border-radius: 8px; max-width: 720px; }
    .row { margin: 10px 0; }
    .muted { color: #555; font-size: 12px; }
    .label { font-weight: bold; }
    pre { margin: 6px 0 0; white-space: pre-wrap; }
    @media print { .noprint { display: none; } body { margin: 0; } .box { border: none; } }
  </style>
</head>
<body>
  <div class="box">
    <div class="row"><span class="label">ラベルコード:</span> ${esc(row.label_code)}</div>
    <div class="row muted">trade_id=${esc(row.trade_id)} / direction=${esc(row.direction)} / status=${esc(row.status)}</div>

    <div class="row">
      <div class="label">送り主</div>
      <pre>${fromAddr ? esc(`${fromAddr.full_name}\n${fromAddr.postal_code} ${fromAddr.prefecture}${fromAddr.city}${fromAddr.address_line}\n${fromAddr.phone}`) : '（住所取得に失敗）'}</pre>
    </div>

    <div class="row">
      <div class="label">宛先</div>
      <pre>${toAddr ? esc(`${toAddr.full_name}\n${toAddr.postal_code} ${toAddr.prefecture}${toAddr.city}${toAddr.address_line}\n${toAddr.phone}`) : '（住所取得に失敗）'}</pre>
    </div>

    <div class="row">
      <div class="label">内容</div>
      <pre>${esc(row.item_summary || '')}</pre>
    </div>

    <div class="row noprint">
      <button onclick="window.print()">印刷</button>
    </div>
  </div>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (e) {
    console.error(e);
    return res.status(500).send('server error');
  }
});

/** ヤマト側（管理画面の想定）：ラベル一覧 */
app.get('/yamato/orders', async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT id, trade_id, direction, label_code, from_user_id, to_user_id, item_summary, status, created_at, updated_at
         FROM shipping_labels
        ORDER BY id DESC
        LIMIT 200`
    );

    // 住所は auth-svc から取得（宛先だけ表示）
    // 200件すべて毎回問い合わせると遅いので、簡易キャッシュする
    const cache = new Map();

    async function getAddrCached(uid) {
      if (!uid) return null;
      if (cache.has(uid)) return cache.get(uid);
      const a = await fetchAddress(uid);
      cache.set(uid, a);
      return a;
    }

    function normalizeStatus(s) {
      const v = String(s || '').toUpperCase();
      if (v === 'CREATED') return 'PREPARED';
      if (v === 'DELIVERED') return 'DELIVERED';
      if (v === 'SHIPPED') return 'SHIPPED';
      if (v === 'CANCELLED') return 'CANCELLED';
      if (v === 'PENDING') return 'PENDING';
      if (v === 'PREPARED') return 'PREPARED';
      if (v === 'IN_TRANSIT') return 'IN_TRANSIT';
      return v || 'PENDING';
    }

    const rows = [];
    for (const r of q.rows) {
      const toAddr = await getAddrCached(Number(r.to_user_id));
      const addrText = toAddr
        ? `${esc(toAddr.postal_code || '')} ${esc(toAddr.address1 || '')} ${esc(toAddr.address2 || '')}`
        : `user_id:${esc(r.to_user_id)}`;
      const phoneText = toAddr ? esc(toAddr.phone || '') : '-';

      const st = normalizeStatus(r.status);

      rows.push(`
        <tr>
          <td>${esc(r.trade_id)}</td>
          <td>${esc(r.direction)}</td>
          <td><a href="/labels/${esc(r.label_code)}" target="_blank" rel="noreferrer">${esc(r.label_code)}</a></td>
          <td>${esc(r.item_summary || '')}</td>
          <td>${addrText}</td>
          <td>${phoneText}</td>
          <td><span class="badge">${esc(st)}</span></td>
          <td class="actions">
            <form method="POST" action="/yamato/orders/${Number(r.id)}/status">
              <input type="hidden" name="yamato_status" value="PREPARED" />
              <button type="submit">準備中</button>
            </form>
            <form method="POST" action="/yamato/orders/${Number(r.id)}/status">
              <input type="hidden" name="yamato_status" value="SHIPPED" />
              <button type="submit">発送済み</button>
            </form>
            <form method="POST" action="/yamato/orders/${Number(r.id)}/status">
              <input type="hidden" name="yamato_status" value="IN_TRANSIT" />
              <button type="submit">配送中</button>
            </form>
            <form method="POST" action="/yamato/orders/${Number(r.id)}/status">
              <input type="hidden" name="yamato_status" value="DELIVERED" />
              <button type="submit">配達完了</button>
            </form>
            <form method="POST" action="/yamato/orders/${Number(r.id)}/status">
              <input type="hidden" name="yamato_status" value="CANCELLED" />
              <button type="submit">取消</button>
            </form>
          </td>
        </tr>
      `);
    }

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>ヤマト管理</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; margin:24px;}
    table{border-collapse:collapse; width:100%;}
    th,td{border:1px solid #ddd; padding:8px; font-size:13px; vertical-align:top;}
    th{background:#fafafa;}
    .badge{display:inline-block; padding:2px 6px; border-radius:10px; background:#eee;}
    .actions form{display:inline-block; margin:0 4px 4px 0;}
    button{padding:6px 10px; cursor:pointer;}
  </style>
</head>
<body>
  <h2>ヤマト状態 管理（簡易）</h2>
  <p>この画面はデモ用です。shipping-svc の shipping-db に対して状態を更新します。</p>
  <table>
    <thead>
      <tr>
        <th>trade_id</th>
        <th>direction</th>
        <th>label</th>
        <th>内容</th>
        <th>住所（宛先）</th>
        <th>電話</th>
        <th>状態</th>
        <th>更新</th>
      </tr>
    </thead>
    <tbody>
      ${rows.join('\n')}
    </tbody>
  </table>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (e) {
    console.error(e);
    return res.status(500).send('server error');
  }
});


app.post('/yamato/orders/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const yamato_status = (req.body?.yamato_status || '').toString().trim().toUpperCase();
  if (!Number.isInteger(id) || id <= 0) return res.status(400).send('bad id');
  if (!yamato_status) return res.status(400).send('bad status');

  // 受け取った値はこの範囲だけ許可
  const allow = new Set(['PENDING','PREPARED','SHIPPED','IN_TRANSIT','DELIVERED','CANCELLED']);
  const next = allow.has(yamato_status) ? yamato_status : 'PENDING';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const u = await client.query(
      `UPDATE shipping_labels
          SET status=$1, updated_at=now()
        WHERE id=$2
      RETURNING id`,
      [next, id]
    );

    if (u.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).send('not found');
    }

    await client.query('COMMIT');
    return res.redirect('/yamato/orders');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).send('server error');
  } finally {
    client.release();
  }
});


const PORT = process.env.PORT ? Number(process.env.PORT) : 4040;
app.listen(PORT, () => console.log(`shipping-svc listening on ${PORT}`));
