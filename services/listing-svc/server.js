import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'myuser',
  password: process.env.DB_PASSWORD || 'mypass',
  database: process.env.DB_NAME || 'listingdb',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
});

const JWT_SECRET = process.env.JWT_SECRET || 'mysecret';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || 'internal-secret';

const FRUIT_IMAGE = {
  1: '/fruits/apple.png',
  2: '/fruits/banana.png',
  3: '/fruits/orange.png',
  4: '/fruits/grape.png',
  5: '/fruits/strawberry.png'
};

function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = { id: payload.uid, role: payload.role || 'user' };
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

function internalRequired(req, res, next) {
  const token = req.headers['x-internal-token'];
  if (!token || token !== INTERNAL_TOKEN) {
    return res.status(401).json({ error: 'unauthorized_internal' });
  }
  return next();
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/catalog/items', async (_req, res) => {
  try {
    const r = await pool.query('SELECT id, name FROM fruit_items ORDER BY id ASC');
    return res.json(r.rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

async function attachWants(listings) {
  const ids = listings.map((x) => x.id).filter((x) => Number.isInteger(x));
  if (ids.length === 0) return listings.map((x) => ({ ...x, wants: [] }));

  const r = await pool.query(
    `SELECT lw.listing_id, fi.id AS fruit_item_id, fi.name
       FROM listing_wants lw
       JOIN fruit_items fi ON fi.id = lw.fruit_item_id
      WHERE lw.listing_id = ANY($1::int[])
      ORDER BY lw.listing_id ASC, fi.id ASC`,
    [ids]
  );

  const map = new Map();
  for (const row of r.rows) {
    const key = Number(row.listing_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ id: Number(row.fruit_item_id), name: row.name });
  }

  return listings.map((x) => ({
    ...x,
    wants: map.get(Number(x.id)) || []
  }));
}

app.get('/listings', async (req, res) => {
  const fruitId = req.query.fruit_item_id ? Number(req.query.fruit_item_id) : null;
  const wantId = req.query.want_id ? Number(req.query.want_id) : null;

  const where = [];
  const vals = [];
  let idx = 1;

  if (Number.isInteger(fruitId)) {
    where.push(`l.fruit_item_id = $${idx++}`);
    vals.push(fruitId);
  }

  if (Number.isInteger(wantId)) {
    where.push(`EXISTS (SELECT 1 FROM listing_wants lw WHERE lw.listing_id = l.id AND lw.fruit_item_id = $${idx++})`);
    vals.push(wantId);
  }

  const sql = `
    SELECT
      l.id,
      l.fruit_item_id,
      fi.name AS fruit_name,
      l.quantity,
      l.status,
      l.seller_id,
      l.image_url,
      l.description,
      l.created_at
    FROM listings l
    JOIN fruit_items fi ON fi.id = l.fruit_item_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY l.id DESC
    LIMIT 200
  `;

  try {
    const r = await pool.query(sql, vals);
    const out = await attachWants(r.rows);
    return res.json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

app.get('/listings/:id(\\d+)', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  try {
    const r = await pool.query(
      `SELECT l.id, l.fruit_item_id, fi.name AS fruit_name, l.quantity, l.status, l.seller_id,
              l.image_url, l.description, l.created_at
         FROM listings l
         JOIN fruit_items fi ON fi.id = l.fruit_item_id
        WHERE l.id = $1`,
      [id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    const out = (await attachWants([r.rows[0]]))[0];
    return res.json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

app.get('/listings/mine', authRequired, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.id, l.fruit_item_id, fi.name AS fruit_name, l.quantity, l.status, l.seller_id,
              l.image_url, l.description, l.created_at
         FROM listings l
         JOIN fruit_items fi ON fi.id = l.fruit_item_id
        WHERE l.seller_id = $1
        ORDER BY l.id DESC`,
      [req.user.id]
    );
    const out = await attachWants(r.rows);
    return res.json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

app.get('/listings/mine', authRequired, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT id, fruit_item_id, quantity, status, seller_id, image_url, description
         FROM listings
        WHERE seller_id = $1
        ORDER BY id DESC`,
      [req.user.id]
    );
    return res.json(q.rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});



app.post('/listings', authRequired, async (req, res) => {
  const fruit_item_id = Number(req.body?.fruit_item_id);
  const quantity = Number(req.body?.quantity);
  const wantIdsRaw = Array.isArray(req.body?.want_fruit_item_ids) ? req.body.want_fruit_item_ids : [];
  const description = (req.body?.description || '').toString().trim();

  if (!Number.isInteger(fruit_item_id) || fruit_item_id < 1 || fruit_item_id > 5) {
    return res.status(400).json({ error: 'bad_fruit_item_id' });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'bad_quantity' });
  }

  const wantIds = [...new Set(wantIdsRaw.map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= 5))];
  if (wantIds.length === 0) return res.status(400).json({ error: 'wants_required' });
  if (wantIds.length > 3) return res.status(400).json({ error: 'too_many_wants' });

  const image_url = FRUIT_IMAGE[fruit_item_id] || '/fruits/apple.png';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ins = await client.query(
      `INSERT INTO listings (fruit_item_id, quantity, status, seller_id, image_url, description)
       VALUES ($1,$2,'Active',$3,$4,$5)
       RETURNING id, fruit_item_id, quantity, status, seller_id, image_url, description, created_at`,
      [fruit_item_id, quantity, req.user.id, image_url, description || null]
    );

    const listingId = ins.rows[0].id;

    for (const wid of wantIds) {
      await client.query(
        `INSERT INTO listing_wants (listing_id, fruit_item_id)
         VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [listingId, wid]
      );
    }

    await client.query('COMMIT');
    const out = await attachWants([
      {
        ...ins.rows[0],
        fruit_name: (await client.query('SELECT name FROM fruit_items WHERE id=$1', [fruit_item_id])).rows[0]?.name || ''
      }
    ]);
    return res.status(201).json(out[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});

app.put('/listings/:id', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });

  const fruit_item_id = req.body?.fruit_item_id != null ? Number(req.body.fruit_item_id) : null;
  const quantity = req.body?.quantity != null ? Number(req.body.quantity) : null;
  const wantIdsRaw = Array.isArray(req.body?.want_fruit_item_ids) ? req.body.want_fruit_item_ids : null;
  const description = req.body?.description != null ? (req.body.description || '').toString().trim() : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM listings WHERE id=$1 FOR UPDATE', [id]);
    if (cur.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    const row = cur.rows[0];
    if (Number(row.seller_id) !== Number(req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'forbidden' });
    }

    const fields = [];
    const vals = [];
    let idx = 1;

    let nextFruitId = Number(row.fruit_item_id);
    if (fruit_item_id != null) {
      if (!Number.isInteger(fruit_item_id) || fruit_item_id < 1 || fruit_item_id > 5) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'bad_fruit_item_id' });
      }
      nextFruitId = fruit_item_id;
      fields.push(`fruit_item_id = $${idx++}`);
      vals.push(fruit_item_id);
      fields.push(`image_url = $${idx++}`);
      vals.push(FRUIT_IMAGE[fruit_item_id] || '/fruits/apple.png');
    }

    if (quantity != null) {
      if (!Number.isInteger(quantity) || quantity < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'bad_quantity' });
      }
      fields.push(`quantity = $${idx++}`);
      vals.push(quantity);
      fields.push(`status = $${idx++}`);
      vals.push(quantity === 0 ? 'Traded' : 'Active');
    }

    if (description != null) {
      fields.push(`description = $${idx++}`);
      vals.push(description || null);
    }

    if (fields.length > 0) {
      fields.push(`updated_at = now()`);
      vals.push(id);
      await client.query(`UPDATE listings SET ${fields.join(', ')} WHERE id = $${idx}`, vals);
    }

    if (wantIdsRaw != null) {
      const wantIds = [...new Set(wantIdsRaw.map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= 5))];
      if (wantIds.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'wants_required' });
      }
      if (wantIds.length > 3) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'too_many_wants' });
      }
      await client.query('DELETE FROM listing_wants WHERE listing_id=$1', [id]);
      for (const wid of wantIds) {
        await client.query(
          `INSERT INTO listing_wants(listing_id, fruit_item_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [id, wid]
        );
      }
    }

    await client.query('COMMIT');
    const out = await pool.query(
      `SELECT l.id, l.fruit_item_id, fi.name AS fruit_name, l.quantity, l.status, l.seller_id,
              l.image_url, l.description, l.created_at
         FROM listings l
         JOIN fruit_items fi ON fi.id = l.fruit_item_id
        WHERE l.id=$1`,
      [id]
    );
    const result = (await attachWants(out.rows))[0];
    return res.json(result);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});

// 取引側が「持ち主チェック」などに使う：listing の要点をまとめて返す
// body: { ids: [1,2,3] }
// return: { listings: [{id, seller_id, status, quantity}], missing: [..] }
app.post('/internal/listings/summary', internalRequired, async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = [...new Set(raw.map(Number).filter((x) => Number.isInteger(x) && x > 0))];

    if (ids.length === 0) {
      return res.status(400).json({ error: 'ids_required' });
    }
    if (ids.length > 100) {
      return res.status(400).json({ error: 'too_many_ids' });
    }

    const r = await pool.query(
      `SELECT id, seller_id, status, quantity
         FROM listings
        WHERE id = ANY($1::int[])`,
      [ids]
    );

    const got = new Set(r.rows.map((x) => Number(x.id)));
    const missing = ids.filter((id) => !got.has(id));

    return res.json({
      listings: r.rows.map((x) => ({
        id: Number(x.id),
        seller_id: Number(x.seller_id),
        status: String(x.status),
        quantity: Number(x.quantity)
      })),
      missing
    });
  } catch (e) {
    console.error('internal summary error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});


// trade-svc からの在庫減算（成立時）
app.post('/internal/listings/decrease', internalRequired, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items || items.length === 0) return res.status(400).json({ error: 'items_required' });

  for (const it of items) {
    const listingId = Number(it.listing_id);
    const qty = Number(it.quantity);
    if (!Number.isInteger(listingId) || !Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: 'bad_items' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = [];

    for (const it of items) {
      const listingId = Number(it.listing_id);
      const dec = Number(it.quantity);

      const r = await client.query(
        `SELECT id, quantity, status
           FROM listings
          WHERE id = $1
          FOR UPDATE`,
        [listingId]
      );
      if (r.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'listing_not_found', listing_id: listingId });
      }

      const row = r.rows[0];
      if (row.status !== 'Active') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'listing_not_active', listing_id: listingId });
      }
      if (Number(row.quantity) < dec) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'insufficient_stock', listing_id: listingId });
      }

      const newQty = Number(row.quantity) - dec;
      const newStatus = newQty === 0 ? 'Traded' : 'Active';

      const u = await client.query(
        `UPDATE listings
            SET quantity = $1,
                status   = $2,
                updated_at = now()
          WHERE id = $3
        RETURNING id, quantity, status`,
        [newQty, newStatus, listingId]
      );
      updated.push(u.rows[0]);
    }

    await client.query('COMMIT');
    return res.json({ ok: true, updated });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('internal decrease error', e);
    return res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 4010;
app.listen(PORT, () => console.log('listing-svc listening on', PORT));
