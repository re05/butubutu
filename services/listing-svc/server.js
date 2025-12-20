// listing-svc/server.js
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const app = express();

// アップロード先ディレクトリ
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// multer 設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const base = path.basename(file.originalname || 'image', ext);
    const safeBase = base.replace(/[^a-zA-Z0-9_\-]/g, '_');
    cb(null, Date.now() + '_' + safeBase + ext);
  }
});
const upload = multer({ storage });

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3100'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  optionsSuccessStatus: 204
}));
app.options('*', (req, res) => res.sendStatus(204));

app.use(express.json());

// アップロード画像配信
app.use('/uploads', express.static(uploadDir));

const pool = new pg.Pool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// 認証必須ミドルウェア
function authRequired(req, res, next) {
  const h = req.headers['authorization'] || '';
  const [scheme, token] = h.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET || 'dev-secret'
    );

    console.log('authRequired decoded payload:', payload);

    // auth-svc 側では { sub: email, role, uid } になっている想定
    const userIdRaw = payload.uid ?? payload.id ?? payload.userId;

    if (!userIdRaw || !Number.isFinite(Number(userIdRaw))) {
      console.error('jwt payload has no valid user id', payload);
      return res.status(401).json({ error: 'unauthorized' });
    }

    const emailFromPayload =
      payload.email && typeof payload.email === 'string'
        ? payload.email
        : (typeof payload.sub === 'string' ? payload.sub : null);

    req.user = {
      id: Number(userIdRaw),
      role: payload.role || 'user',
      email: emailFromPayload
    };

    next();
  } catch (e) {
    console.error('jwt verify error', e);
    return res.status(401).json({ error: 'unauthorized' });
  }
}

app.get('/health', (req, res) =>
  res.json({ ok: true, service: 'listing-svc' })
);

// 一覧取得＋検索・絞り込み
app.get('/listings', async (req, res) => {
  try {
    const { q, category, fashion_genre, size } = req.query;

    const conds = [];
    const params = [];

    if (q && q.trim()) {
      params.push('%' + q.trim() + '%');
      conds.push(`title ILIKE $${params.length}`);
    }

    if (category && category.trim()) {
      params.push(category.trim());
      conds.push(`category = $${params.length}`);
    }

    if (fashion_genre && fashion_genre.trim()) {
      params.push(fashion_genre.trim());
      conds.push(`fashion_genre = $${params.length}`);
    }

    if (size && size.trim()) {
      params.push(size.trim());
      conds.push(`size = $${params.length}`);
    }

    let sql = `
      SELECT
        id,
        title,
        price,
        status,
        seller_id,
        image_url,
        category,
        fashion_genre,
        size,
        condition
      FROM listings
    `;

    if (conds.length > 0) {
      sql += ' WHERE ' + conds.join(' AND ');
    }

    sql += ' ORDER BY id DESC';

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to fetch listings' });
  }
});

// 単一出品（商品詳細）
app.get('/listings/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'bad_id' });
  }
  try {
    const r = await pool.query(
      `SELECT id,title,price,status,seller_id,
              image_url,condition,category,fashion_genre,size
         FROM listings
        WHERE id=$1`,
      [id]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    return res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// 商品ごとのコメント一覧
app.get('/listings/:id/comments', async (req, res) => {
  const listingId = Number(req.params.id);
  if (!Number.isInteger(listingId)) {
    return res.status(400).json({ error: 'invalid listing id' });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        c.id,
        c.body,
        c.created_at,
        c.author_id,
        u.email AS author_email
      FROM listing_comments c
      LEFT JOIN users u
        ON c.author_id = u.id
      WHERE c.listing_id = $1
      ORDER BY c.created_at ASC
      `,
      [listingId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('GET /listings/:id/comments error', err);
    res.status(500).json({ error: 'failed to fetch comments' });
  }
});

// 商品にコメントを追加（ログイン必須）
app.post('/listings/:id/comments', authRequired, async (req, res) => {
  const listingId = Number(req.params.id);
  if (!Number.isInteger(listingId)) {
    return res.status(400).json({ error: 'bad_id' });
  }

  const body = (req.body && req.body.body || '').trim();
  if (!body) {
    return res.status(400).json({ error: 'body_required' });
  }

  try {
    // 該当商品が存在するか確認
    const lr = await pool.query(
      'SELECT id FROM listings WHERE id=$1',
      [listingId]
    );
    if (lr.rowCount === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    const r = await pool.query(
      `INSERT INTO listing_comments(listing_id,author_id,body)
       VALUES ($1,$2,$3)
       RETURNING id,body,created_at,author_id`,
      [listingId, req.user.id, body]
    );
    const c = r.rows[0];

    const ur = await pool.query(
      'SELECT email FROM users WHERE id=$1',
      [c.author_id]
    );
    const authorEmail = ur.rowCount ? ur.rows[0].email : null;

    return res.status(201).json({
      id: c.id,
      body: c.body,
      created_at: c.created_at,
      author_id: c.author_id,
      author_email: authorEmail
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// 出品の再編集（出品者または管理者のみ）
app.put('/listings/:id', authRequired, upload.single('image'), async (req, res) => {
  const listingId = Number(req.params.id);
  if (!Number.isInteger(listingId)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM listings WHERE id = $1',
      [listingId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'not found' });
    }

    const listing = result.rows[0];

    console.log('UPDATE /listings/:id debug', {
      listingId,
      listing_seller_id: listing.seller_id,
      req_user: req.user
    });

    const isOwner = Number(listing.seller_id) === Number(req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      console.log('FORBIDDEN update', {
        listingId,
        listing_seller_id: listing.seller_id,
        user_id: req.user.id,
        role: req.user.role
      });
      return res.status(403).json({ error: 'forbidden' });
    }

    const { title, price, condition, category, fashion_genre, size } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) {
      fields.push(`title = $${idx++}`);
      values.push(title);
    }
    if (price !== undefined) {
      fields.push(`price = $${idx++}`);
      values.push(Number(price));
    }
    if (condition !== undefined) {
      fields.push(`condition = $${idx++}`);
      values.push(condition);
    }
    if (category !== undefined) {
      fields.push(`category = $${idx++}`);
      values.push(category);
    }
    if (fashion_genre !== undefined) {
      fields.push(`fashion_genre = $${idx++}`);
      values.push(fashion_genre);
    }
    if (size !== undefined) {
      fields.push(`size = $${idx++}`);
      values.push(size);
    }

    if (req.file) {
      const imagePath = '/uploads/' + req.file.filename;
      fields.push(`image_url = $${idx++}`);
      values.push(imagePath);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'no fields to update' });
    }

    values.push(listingId);

    const updateSql = `
      UPDATE listings
         SET ${fields.join(', ')}
       WHERE id = $${idx}
       RETURNING *
    `;

    const updated = await client.query(updateSql, values);
    return res.json(updated.rows[0]);
  } catch (e) {
    console.error('update listing error', e);
    return res.status(500).json({ error: 'internal error' });
  } finally {
    client.release();
  }
});

// 自分の出品一覧
app.get('/listings/mine', authRequired, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id,title,price,status,seller_id,
              image_url,condition,category,fashion_genre,size
         FROM listings
        WHERE seller_id = $1
        ORDER BY id DESC`,
      [req.user.id]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// 新規出品
app.post('/listings', authRequired, upload.single('image'), async (req, res) => {
  const { title, price, condition, category, fashion_genre, size } = req.body || {};
  const file = req.file;

  if (!title || price == null || !condition || !category) {
    return res.status(400).json({ error: 'bad_request' });
  }
  if (!file) {
    return res.status(400).json({ error: 'image_required' });
  }

  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    return res.status(400).json({ error: 'bad_price' });
  }

  const cat = category;
  const isFashion = (cat === 'ファッション');
  if (isFashion) {
    if (!fashion_genre || !fashion_genre.trim()) {
      return res.status(400).json({ error: 'fashion_genre_required' });
    }
    if (!size || !size.trim()) {
      return res.status(400).json({ error: 'size_required' });
    }
  }

  const imagePath = '/uploads/' + path.basename(file.path);

  try {
    const q = await pool.query(
      `INSERT INTO listings
       (title,price,status,seller_id,image_url,condition,category,fashion_genre,size)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,title,price,status,seller_id,
                 image_url,condition,category,fashion_genre,size`,
      [
        title,
        priceNum,
        'Active',
        req.user.id,
        imagePath,
        condition,
        category,
        fashion_genre || null,
        size || null
      ]
    );
    return res.status(201).json(q.rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// 出品削除（出品者本人 または admin）
app.delete('/listings/:id', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'bad_id' });
  }

  try {
    const r = await pool.query(
      `SELECT id,seller_id,status,image_url FROM listings WHERE id=$1`,
      [id]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    const l = r.rows[0];

    if (req.user.role !== 'admin' && Number(l.seller_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (l.status !== 'Active') {
      return res.status(409).json({ error: 'not_active' });
    }

    await pool.query('DELETE FROM listings WHERE id=$1', [id]);

    if (l.image_url) {
      const full = path.join(
        process.cwd(),
        l.image_url.replace(/^\/uploads\//, 'uploads/')
      );
      fs.unlink(full, () => {});
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// 出品停止（Active -> Paused）
app.patch('/listings/:id/pause', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'bad_id' });
  }

  try {
    const r = await pool.query(
      `SELECT id,seller_id,status FROM listings WHERE id=$1`,
      [id]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    const l = r.rows[0];

    if (req.user.role !== 'admin' && Number(l.seller_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (l.status !== 'Active') {
      return res.status(409).json({ error: 'invalid_status' });
    }

    const u = await pool.query(
      `UPDATE listings
          SET status='Paused'
        WHERE id=$1
      RETURNING id,title,price,status,seller_id,
                image_url,condition,category,fashion_genre,size`,
      [id]
    );
    return res.json(u.rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// 出品再開（Paused -> Active）
app.patch('/listings/:id/activate', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'bad_id' });
  }

  try {
    const r = await pool.query(
      `SELECT id,seller_id,status FROM listings WHERE id=$1`,
      [id]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    const l = r.rows[0];

    if (req.user.role !== 'admin' && Number(l.seller_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (l.status !== 'Paused') {
      return res.status(409).json({ error: 'invalid_status' });
    }

    const u = await pool.query(
      `UPDATE listings
          SET status='Active'
        WHERE id=$1
      RETURNING id,title,price,status,seller_id,
                image_url,condition,category,fashion_genre,size`,
      [id]
    );
    return res.json(u.rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

const PORT = process.env.PORT || 4010;
app.listen(PORT, () => console.log('listing-svc listening on', PORT));
