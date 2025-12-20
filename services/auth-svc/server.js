import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const app = express();

// CORS
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
  database: process.env.DB_NAME
});

function authRequired(req,res,next){
  const h = req.headers['authorization'] || '';
  const [scheme, token] = h.split(' ');
  if(scheme !== 'Bearer' || !token) return res.status(401).json({error:'unauthorized'});
  try{
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // sub=email, role, uid
    next();
  }catch(e){
    return res.status(401).json({error:'unauthorized'});
  }
}

function adminRequired(req,res,next){
  if(!req.user || req.user.role !== 'admin') return res.status(403).json({error:'forbidden'});
  next();
}

app.get('/health', (req,res)=>res.json({ok:true}));

// ログイン
app.post('/login', async (req,res)=>{
  const { email, password } = req.body || {};
  if(!email || !password) return res.status(400).json({error:'bad_request'});
  try{
    const q = await pool.query(
      'SELECT id,email,password,role,disabled FROM users WHERE email=$1',
      [email]
    );
    if(q.rowCount === 0) return res.status(401).json({error:'invalid'});
    const u = q.rows[0];
    if(u.disabled) return res.status(403).json({error:'disabled'});
    if(u.password !== password) return res.status(401).json({error:'invalid'});
    const token = jwt.sign(
      { sub: u.email, role: u.role, uid: u.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.json({ token });
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

// 新規登録
app.post('/register', async (req, res) => {
  const {
    email,
    password,
    fullName,
    postalCode,
    prefecture,
    city,
    addressLine,
    phone
  } = req.body || {};

  // 必須チェック
  if (
    !email ||
    !password ||
    !fullName ||
    !postalCode ||
    !prefecture ||
    !city ||
    !addressLine ||
    !phone
  ) {
    return res.status(400).json({ error: 'bad_request' });
  }

  try {
    const q = await pool.query(
      `INSERT INTO users
        (email, password, role, disabled,
         full_name, postal_code, prefecture, city, address_line, phone)
       VALUES ($1,$2,$3,false,$4,$5,$6,$7,$8,$9)
       RETURNING id,email,role`,
      [
        email,
        password,
        'user',
        fullName,
        postalCode,
        prefecture,
        city,
        addressLine,
        phone
      ]
    );

    const u = q.rows[0];
    const token = jwt.sign(
      { sub: u.email, role: u.role, uid: u.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.status(201).json({ token });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'exists' });
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});


// 自分の情報取得
app.get('/me', authRequired, async (req,res)=>{
  try{
    const q = await pool.query(
      'SELECT id,email,role FROM users WHERE email=$1',
      [req.user.sub]
    );
    if(q.rowCount===0) return res.status(404).json({error:'not_found'});
    return res.json(q.rows[0]);
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

// ここから運営用API

// 全ユーザー一覧（運営画面用）
app.get('/admin/users', authRequired, adminRequired, async (req,res)=>{
  try{
    const q = await pool.query(
      'SELECT id,email,role,disabled FROM users ORDER BY id ASC'
    );
    return res.json(q.rows);
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

// ユーザー凍結
app.patch('/admin/users/:id/freeze', authRequired, adminRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({error:'bad_id'});
  try{
    await pool.query('UPDATE users SET disabled=true WHERE id=$1',[id]);
    return res.json({ok:true});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

// ユーザー凍結解除
app.patch('/admin/users/:id/unfreeze', authRequired, adminRequired, async (req,res)=>{
  const id = Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({error:'bad_id'});
  try{
    await pool.query('UPDATE users SET disabled=false WHERE id=$1',[id]);
    return res.json({ok:true});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'server_error'});
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=>console.log('listening on', PORT));
