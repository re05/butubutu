// frontend/src/main.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter,
  RouterProvider,
  Link,
  Navigate,
  useNavigate,
  useLocation,
  useParams
} from 'react-router-dom';

const AUTH_URL    = import.meta.env.VITE_AUTH_URL    || 'http://localhost:4000';
const LISTING_URL = import.meta.env.VITE_LISTING_URL || 'http://localhost:4010';
const ORDER_URL   = import.meta.env.VITE_ORDER_URL   || 'http://localhost:4020';

function saveToken(t){ localStorage.setItem('token', t); }
function getToken(){ return localStorage.getItem('token'); }
function clearToken(){ localStorage.removeItem('token'); }
function authHeader(){
  const t = getToken();
  return t ? { 'Authorization': 'Bearer ' + t } : {};
}

// 共通レイアウト
function Layout({ children }){
  const [me,setMe] = React.useState(null);
  const [loaded,setLoaded] = React.useState(false);
  const nav = useNavigate();
  const loc = useLocation();

  React.useEffect(()=>{
    const t = getToken();
    if(!t){
      setMe(null);
      setLoaded(true);
      return;
    }
    fetch(AUTH_URL + '/me', { headers: { ...authHeader() } })
      .then(r => r.ok ? r.json() : null)
      .then(u => { setMe(u); setLoaded(true); })
      .catch(()=>{ setMe(null); setLoaded(true); });
  }, [loc.pathname]);

  function onLogout(){
    clearToken();
    setMe(null);
    nav('/login');
  }

  return (
    <div style={{maxWidth: 900, margin: '24px auto', fontFamily: 'system-ui', padding: '0 12px'}}>
      <nav style={{display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap'}}>
        <Link to="/">マイページ</Link>
        <Link to="/listings">出品一覧</Link>
        <Link to="/sell">出品</Link>

        {me && me.role !== 'admin' && (
          <Link to="/orders">取引一覧</Link>
        )}

        {me && me.role === 'admin' && (
          <>
            <Link to="/admin/orders">取引一覧</Link>
            <Link to="/admin/listings">出品管理</Link>
            <Link to="/admin/users">ユーザー管理</Link>
          </>
        )}

        <span style={{marginLeft: 'auto'}} />
        {!loaded && <span>読込中...</span>}
        {loaded && !me && (
          <>
            <Link to="/login">ログイン</Link>
            <Link to="/register">新規登録</Link>
          </>
        )}
        {loaded && me && (
          <>
            <span>{me.email}（{me.role}）</span>
            <button
              onClick={onLogout}
              style={{marginLeft: 8, padding: '4px 8px', cursor: 'pointer'}}
            >
              ログアウト
            </button>
          </>
        )}
      </nav>
      <hr/>
      <div style={{marginTop: 16}}>
        {children}
      </div>
    </div>
  );
}

// ログイン
function Login(){
  const nav = useNavigate();
  const [email,setEmail] = React.useState('test@test.com');
  const [password,setPassword] = React.useState('pass');
  const [err,setErr] = React.useState('');

  async function onLogin(e){
    e.preventDefault();
    setErr('');
    const r = await fetch(AUTH_URL + '/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ email, password })
    });
    if(!r.ok){
      const body = await r.json().catch(()=>null);
      if(body && body.error === 'disabled'){
        setErr('このユーザーは凍結されています');
      }else{
        setErr('ログインに失敗しました（メールアドレスまたはパスワードが違います）');
      }
      return;
    }
    const j = await r.json();
    saveToken(j.token);
    nav('/');
  }

  return (
    <Layout>
      <h2>ログイン</h2>
      <form onSubmit={onLogin}>
        <div style={{margin: '8px 0'}}>
          <label>メールアドレス</label><br/>
          <input
            style={{padding: '8px', width: '260px'}}
            placeholder="メールアドレス"
            value={email}
            onChange={e=>setEmail(e.target.value)}
          />
        </div>
        <div style={{margin: '8px 0'}}>
          <label>パスワード</label><br/>
          <input
            style={{padding: '8px', width: '260px'}}
            type="password"
            placeholder="パスワード"
            value={password}
            onChange={e=>setPassword(e.target.value)}
          />
        </div>
        <button style={{padding: '8px 16px', cursor: 'pointer'}}>ログイン</button>
      </form>
      {err && <p style={{color:'red'}}>{err}</p>}
      <p style={{marginTop: 16}}>
        アカウントをお持ちでない方は <Link to="/register">新規登録</Link> へ
      </p>
    </Layout>
  );
}

// 新規登録
// 新規登録
function Register(){
  const nav = useNavigate();

  const [email,setEmail] = React.useState('');
  const [password,setPassword] = React.useState('');

  // ここから住所情報
  const [fullName, setFullName]       = React.useState('');
  const [postalCode, setPostalCode]   = React.useState('');
  const [prefecture, setPrefecture]   = React.useState('');
  const [city, setCity]               = React.useState('');
  const [addressLine, setAddressLine] = React.useState('');
  const [phone, setPhone]             = React.useState('');

  const [err,setErr] = React.useState('');

  async function onRegister(e){
    e.preventDefault();
    setErr('');

    // 必須チェック
    if(
      !email ||
      !password ||
      !fullName ||
      !postalCode ||
      !prefecture ||
      !city ||
      !addressLine ||
      !phone
    ){
      setErr('すべての項目を入力してください');
      return;
    }

    const body = {
      email,
      password,
      fullName,
      postalCode,
      prefecture,
      city,
      addressLine,
      phone
    };

    const r = await fetch(AUTH_URL + '/register', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });

    if(!r.ok){
      const body = await r.json().catch(()=>null);
      if(body && body.error === 'exists'){
        setErr('このメールアドレスは既に登録されています');
      }else if(body && body.error === 'bad_request'){
        setErr('入力内容を確認してください');
      }else{
        setErr('登録に失敗しました');
      }
      return;
    }

    const j = await r.json();
    saveToken(j.token);
    nav('/');
  }

  return (
    <Layout>
      <h2>新規登録</h2>
      <form onSubmit={onRegister}>
        <div style={{margin: '8px 0'}}>
          <label>メールアドレス</label><br/>
          <input
            style={{padding: '8px', width: '260px'}}
            placeholder="メールアドレス"
            value={email}
            onChange={e=>setEmail(e.target.value)}
          />
        </div>

        <div style={{margin: '8px 0'}}>
          <label>パスワード</label><br/>
          <input
            style={{padding: '8px', width: '260px'}}
            type="password"
            placeholder="パスワード"
            value={password}
            onChange={e=>setPassword(e.target.value)}
          />
        </div>

        <div style={{margin: '8px 0'}}>
          <label>氏名（配送用フルネーム）</label><br/>
          <input
            style={{padding: '8px', width: '260px'}}
            placeholder="山田 太郎"
            value={fullName}
            onChange={e=>setFullName(e.target.value)}
          />
        </div>

        <div style={{margin: '8px 0'}}>
          <label>郵便番号</label><br/>
          <input
            style={{padding: '8px', width: '260px'}}
            placeholder="123-4567"
            value={postalCode}
            onChange={e=>setPostalCode(e.target.value)}
          />
        </div>

        <div style={{margin: '8px 0'}}>
          <label>都道府県</label><br/>
          <input
            style={{padding: '8px', width: '260px'}}
            placeholder="大阪府"
            value={prefecture}
            onChange={e=>setPrefecture(e.target.value)}
          />
        </div>

        <div style={{margin: '8px 0'}}>
          <label>市区町村</label><br/>
          <input
            style={{padding: '8px', width: '260px'}}
            placeholder="大阪市○○区"
            value={city}
            onChange={e=>setCity(e.target.value)}
          />
        </div>

        <div style={{margin: '8px 0'}}>
          <label>番地・建物名</label><br/>
          <input
            style={{padding: '8px', width: '260px'}}
            placeholder="1-2-3 ○○マンション101号室"
            value={addressLine}
            onChange={e=>setAddressLine(e.target.value)}
          />
        </div>

        <div style={{margin: '8px 0'}}>
          <label>電話番号</label><br/>
          <input
            style={{padding: '8px', width: '260px'}}
            placeholder="09012345678"
            value={phone}
            onChange={e=>setPhone(e.target.value)}
          />
        </div>

        <button style={{padding:'8px 16px',cursor:'pointer'}}>登録する</button>
      </form>
      {err && <p style={{color:'red'}}>{err}</p>}
      <p style={{marginTop: 16}}>
        既にアカウントをお持ちの方は <Link to="/login">ログイン</Link> へ
      </p>
    </Layout>
  );
}


// マイページ（自分の出品＋画像表示）
function MyPage(){
  const [mine,setMine] = React.useState([]);
  const [loaded,setLoaded] = React.useState(false);
  const nav = useNavigate();

  React.useEffect(()=>{
    const t = getToken();
    if(!t){
      nav('/login');
      return;
    }

    async function load(){
      try{
        const meRes = await fetch(AUTH_URL + '/me', { headers:{...authHeader()} });
        const me = meRes.ok ? await meRes.json() : null;
        if(!me){
          setMine([]);
          setLoaded(true);
          return;
        }

        const mineRes = await fetch(LISTING_URL + '/listings/mine', { headers:{...authHeader()} });
        let mineData = [];
        if(mineRes.ok){
          mineData = await mineRes.json();
        }

        if(!mineRes.ok || !Array.isArray(mineData) || mineData.length === 0){
          const allRes = await fetch(LISTING_URL + '/listings');
          const all = allRes.ok ? await allRes.json() : [];
          mineData = all.filter(x => x.seller_id === me.id);
        }

        setMine(mineData);
        setLoaded(true);
      }catch(e){
        console.error(e);
        setMine([]);
        setLoaded(true);
      }
    }

    load();
  },[]);

  if(!loaded){
    return (
      <Layout>
        <p>読み込み中...</p>
      </Layout>
    );
  }

  return (
    <Layout>
      <h2>自分の出品</h2>
      {mine.length === 0 && <p>まだ出品がありません。</p>}
      {mine.map(x =>
        <div
          key={x.id}
          style={{
            display:'flex',
            gap:12,
            alignItems:'center',
            padding:'8px 0',
            borderBottom:'1px solid #eee',
            cursor:'pointer'
          }}
          onClick={()=>nav(`/listings/${x.id}`)}
        >
          {x.image_url && (
            <img
              src={LISTING_URL + x.image_url}
              alt={x.title}
              style={{width:80,height:80,objectFit:'cover',borderRadius:4,flexShrink:0}}
            />
          )}
          <div>
            <div>#{x.id} {x.title}</div>
            <div>¥{x.price} [{x.status}]</div>
            <div>
              カテゴリ: {x.category}
              {x.fashion_genre && ` / ジャンル:${x.fashion_genre}`}
              {x.size && ` / サイズ:${x.size}`}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

// 出品一覧（キーワード＋カテゴリ＋ジャンル＋サイズで絞り込み）
function ListingList(){
  const [items,setItems] = React.useState([]);
  const [me,setMe] = React.useState(null);

  const [keyword,setKeyword]         = React.useState('');
  const [category,setCategory]       = React.useState('');
  const [fashionGenre,setFashionGenre] = React.useState('');
  const [size,setSize]               = React.useState('');

  const [loading,setLoading] = React.useState(false);
  const [err,setErr]         = React.useState('');

  const nav = useNavigate();

  React.useEffect(()=>{
    loadList({});
    const t = getToken();
    if(t){
      fetch(AUTH_URL + '/me', { headers: { ...authHeader() } })
        .then(r=>r.ok ? r.json() : null)
        .then(setMe)
        .catch(()=>setMe(null));
    }
  },[]);

  async function loadList(filters){
    setLoading(true);
    setErr('');

    try{
      const params = [];

      if(filters.keyword && filters.keyword.trim()){
        params.push('q=' + encodeURIComponent(filters.keyword.trim()));
      }
      if(filters.category){
        params.push('category=' + encodeURIComponent(filters.category));
      }
      if(filters.fashion_genre && filters.fashion_genre.trim()){
        params.push('fashion_genre=' + encodeURIComponent(filters.fashion_genre.trim()));
      }
      if(filters.size && filters.size.trim()){
        params.push('size=' + encodeURIComponent(filters.size.trim()));
      }

      const qs = params.length ? '?' + params.join('&') : '';
      const r  = await fetch(LISTING_URL + '/listings' + qs);

      if(!r.ok){
        setItems([]);
        setErr('一覧の取得に失敗しました');
        return;
      }
      const data = await r.json();
      setItems(Array.isArray(data) ? data : []);
    }catch(e){
      console.error(e);
      setItems([]);
      setErr('一覧の取得中にエラーが発生しました');
    }finally{
      setLoading(false);
    }
  }

  async function buy(id){
    const t = getToken();
    if(!t){
      nav('/login');
      return;
    }
    const r = await fetch(ORDER_URL + '/orders', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', ...authHeader()},
      body: JSON.stringify({ listingId: id })
    });
    if(r.ok){
      alert('購入しました');
      location.reload();
    }else{
      alert('購入できませんでした');
    }
  }

  async function del(id){
    const r = await fetch(LISTING_URL + '/listings/' + id, {
      method: 'DELETE',
      headers: { ...authHeader() }
    });
    if(r.ok){
      alert('削除しました');
      location.reload();
    }else{
      alert('削除できませんでした');
    }
  }

  function onSubmitSearch(e){
    e.preventDefault();
    loadList({
      keyword,
      category,
      fashion_genre: fashionGenre,
      size
    });
  }

  function onClear(){
    setKeyword('');
    setCategory('');
    setFashionGenre('');
    setSize('');
    loadList({});
  }

  return (
    <Layout>
      <h2>出品一覧</h2>

      <form
        onSubmit={onSubmitSearch}
        style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginBottom:12}}
      >
        <input
          style={{padding:'6px 8px',minWidth:200}}
          placeholder="商品名で検索"
          value={keyword}
          onChange={e=>setKeyword(e.target.value)}
        />

        <select
          style={{padding:'6px 8px'}}
          value={category}
          onChange={e=>setCategory(e.target.value)}
        >
          <option value="">カテゴリ指定なし</option>
          <option value="ファッション">ファッション</option>
          <option value="ベビー">ベビー</option>
          <option value="ゲーム・おもちゃ">ゲーム・おもちゃ</option>
          <option value="家電">家電</option>
          <option value="本・マンガ">本・マンガ</option>
          <option value="その他">その他</option>
        </select>

        <input
          style={{padding:'6px 8px',width:160}}
          placeholder="ジャンル（例: トップス）"
          value={fashionGenre}
          onChange={e=>setFashionGenre(e.target.value)}
        />

        <input
          style={{padding:'6px 8px',width:120}}
          placeholder="サイズ（例: M, 27cm）"
          value={size}
          onChange={e=>setSize(e.target.value)}
        />

        <button type="submit" style={{padding:'6px 12px',cursor:'pointer'}}>
          絞り込み
        </button>
        <button
          type="button"
          onClick={onClear}
          style={{padding:'4px 10px',cursor:'pointer'}}
        >
          クリア
        </button>
      </form>

      {loading && <p>読み込み中...</p>}
      {err && <p style={{color:'red'}}>{err}</p>}
      {!loading && items.length === 0 && !err && (
        <p>該当する出品がありません。</p>
      )}

      {items.map(x =>
        <div
          key={x.id}
          style={{
            display:'flex',
            gap:12,
            alignItems:'center',
            padding:'8px 0',
            borderBottom:'1px solid #eee',
            cursor:'pointer'
          }}
          onClick={()=>nav(`/listings/${x.id}`)}
        >
          {x.image_url && (
            <img
              src={LISTING_URL + x.image_url}
              alt={x.title}
              style={{width:80,height:80,objectFit:'cover',borderRadius:4,flexShrink:0}}
              onClick={(e)=>{ e.stopPropagation(); nav(`/listings/${x.id}`); }}
            />
          )}
          <div style={{flex:1}}>
            <div>#{x.id} {x.title}</div>
            <div>¥{x.price} [{x.status}]</div>
            <div>
              カテゴリ: {x.category}
              {x.fashion_genre && ` / ジャンル:${x.fashion_genre}`}
              {x.size && ` / サイズ:${x.size}`}
            </div>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:4}}>
            {me && me.id === x.seller_id && x.status === 'Active' && (
              <button
                onClick={(e)=>{ e.stopPropagation(); del(x.id); }}
              >
                削除
              </button>
            )}
            {(!me || me.id !== x.seller_id) && x.status === 'Active' && (
              <button
                onClick={(e)=>{ e.stopPropagation(); buy(x.id); }}
              >
                購入
              </button>
            )}
            {x.status !== 'Active' && <span>購入不可</span>}
          </div>
        </div>
      )}
    </Layout>
  );
}

// 商品詳細ページ（画像＋購入ボタン付き＋コメント＋編集ボタン）
// 商品詳細ページ（画像＋購入ボタン付き＋コメント＋編集ボタン）
function ListingDetail(){
  const { id } = useParams();
  const nav = useNavigate();
  const [item,setItem] = React.useState(null);
  const [me,setMe] = React.useState(null);
  const [loaded,setLoaded] = React.useState(false);

  const [comments,setComments] = React.useState([]);
  const [commentText,setCommentText] = React.useState('');
  const [sending,setSending] = React.useState(false);

  React.useEffect(()=>{
    setLoaded(false);

    fetch(LISTING_URL + `/listings/${id}`)
      .then(r=>r.ok ? r.json() : null)
      .then(setItem)
      .finally(()=>setLoaded(true));

    fetch(LISTING_URL + `/listings/${id}/comments`)
      .then(r=>r.ok ? r.json() : [])
      .then(setComments)
      .catch(()=>setComments([]));

    const t = getToken();
    if(t){
      fetch(AUTH_URL + '/me', { headers:{...authHeader()} })
        .then(r=>r.ok ? r.json() : null)
        .then(setMe)
        .catch(()=>setMe(null));
    }else{
      setMe(null);
    }
  },[id]);

  async function buy(){
    const t = getToken();
    if(!t){
      nav('/login');
      return;
    }
    if(!item) return;
    if(me && Number(me.id) === Number(item.seller_id)){
      alert('自分の出品は購入できません');
      return;
    }
    if(item.status !== 'Active'){
      alert('この商品は購入できません');
      return;
    }
    const r = await fetch(ORDER_URL + '/orders', {
      method: 'POST',
      headers: {'Content-Type':'application/json', ...authHeader()},
      body: JSON.stringify({ listingId: Number(id) })
    });
    if(r.ok){
      alert('購入しました');
      nav('/orders');
    }else{
      alert('購入に失敗しました');
    }
  }

  async function submitComment(e){
    e.preventDefault();

    const t = getToken();
    if(!t){
      nav('/login');
      return;
    }

    const text = commentText.trim();
    if(!text){
      alert('コメントを入力してください');
      return;
    }

    setSending(true);
    try{
      const r = await fetch(LISTING_URL + `/listings/${id}/comments`, {
        method: 'POST',
        headers: {'Content-Type':'application/json', ...authHeader()},
        body: JSON.stringify({ body: text })
      });
      if(!r.ok){
        alert('コメントの送信に失敗しました');
        return;
      }
      const newComment = await r.json();
      setComments(prev => [...prev, newComment]);
      setCommentText('');

    }catch(e){
      alert('コメントの送信中にエラーが発生しました');
    }finally{
      setSending(false);
    }
  }

  // ここで「編集可能かどうか」を計算する
  const canEdit =
    item &&
    me &&
    (me.role === 'admin' || Number(me.id) === Number(item.seller_id));

  return (
    <Layout>
      {!loaded && <p>読み込み中...</p>}
      {loaded && !item && <p>商品情報を取得できませんでした。</p>}
      {item && (
        <>
          <h2>商品詳細</h2>
          {item.image_url && (
            <img
              src={LISTING_URL + item.image_url}
              alt={item.title}
              style={{width:300,height:300,objectFit:'cover',borderRadius:8,marginBottom:16}}
            />
          )}
          <p>商品名: {item.title}</p>
          <p>価格: ¥{item.price}</p>
          <p>状態: {item.condition}</p>
          <p>カテゴリ: {item.category}</p>
          {item.fashion_genre && <p>ファッションジャンル: {item.fashion_genre}</p>}
          {item.size && <p>サイズ: {item.size}</p>}
          <p>出品者ID: {item.seller_id}</p>
          <p>ステータス: {item.status}</p>

          <div style={{marginTop:12, display:'flex', gap:8, alignItems:'center'}}>
            {item.status === 'Active'
              ? (
                <button
                  style={{padding:'8px 16px',cursor:'pointer'}}
                  onClick={buy}
                >
                  購入
                </button>
              )
              : <span>この商品は購入できません。</span>
            }

            {canEdit && (
              <button
                style={{padding:'8px 16px',cursor:'pointer'}}
                onClick={()=>nav(`/listings/${item.id}/edit`)}
              >
                出品内容を編集
              </button>
            )}
          </div>

          <div style={{marginTop:24}}>
            <h3>コメント</h3>

            {comments.length === 0 && (
              <p>まだコメントはありません。</p>
            )}

            {comments.length > 0 && (
              <ul style={{listStyle:'none',padding:0}}>
                {comments.map(c=>(
                  <li key={c.id} style={{borderTop:'1px solid #ddd',padding:'8px 0'}}>
                    <div style={{fontSize:12,color:'#555'}}>
                      {c.author_email || `ユーザーID: ${c.author_id}`} /{' '}
                      {new Date(c.created_at).toLocaleString()}
                    </div>
                    <div>{c.body}</div>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={submitComment} style={{marginTop:12}}>
              <textarea
                rows={3}
                style={{width:'100%',padding:8,boxSizing:'border-box'}}
                value={commentText}
                onChange={e=>setCommentText(e.target.value)}
                placeholder={me ? 'コメントを書く' : 'コメントを書くにはログインしてください'}
              />
              <button
                type="submit"
                disabled={sending || !commentText.trim()}
                style={{marginTop:8,padding:'6px 12px',cursor:'pointer'}}
              >
                コメントを送信
              </button>
            </form>
          </div>
        </>
      )}
    </Layout>
  );
}


// 出品フォーム（新規出品）
function Sell(){
  const nav = useNavigate();
  const [title,setTitle]             = React.useState('');
  const [price,setPrice]             = React.useState(1000);
  const [imageFile,setImageFile]     = React.useState(null);
  const [imagePreview,setImagePreview] = React.useState('');
  const [condition,setCondition]       = React.useState('未使用に近い');
  const [category,setCategory]         = React.useState('ファッション');
  const [fashionGenre,setFashionGenre] = React.useState('');
  const [size,setSize]                 = React.useState('');
  const [err,setErr] = React.useState('');

  React.useEffect(()=>{
    const t = getToken();
    if(!t) nav('/login');
  },[]);

  function onImageChange(e){
    const file = e.target.files && e.target.files[0];
    setImageFile(file || null);
    if(file){
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    }else{
      setImagePreview('');
    }
  }

  function isFashion(cat){
    return cat === 'ファッション';
  }

  function validate(){
    if(!title.trim()) return 'タイトルを入力してください';
    if(!price || Number(price) <= 0) return '価格を正しく入力してください';
    if(!imageFile) return '商品画像を選択してください';
    if(!condition) return '商品の状態を選択してください';
    if(!category) return 'カテゴリを選択してください';
    if(isFashion(category)){
      if(!fashionGenre.trim()) return 'ファッションジャンルを入力してください';
      if(!size.trim()) return 'サイズを入力してください';
    }
    return '';
  }

  async function submit(e){
    e.preventDefault();
    const msg = validate();
    if(msg){
      setErr(msg);
      return;
    }
    setErr('');

    const fd = new FormData();
    fd.append('title', title);
    fd.append('price', String(price));
    fd.append('condition', condition);
    fd.append('category', category);
    fd.append('fashion_genre', fashionGenre);
    fd.append('size', size);
    if(imageFile){
      fd.append('image', imageFile);
    }

    const r = await fetch(LISTING_URL + '/listings', {
      method: 'POST',
      headers: {
        ...authHeader()
      },
      body: fd
    });

    if(r.ok){
      alert('出品しました');
      setTitle('');
      setPrice(1000);
      setImageFile(null);
      setImagePreview('');
      setCondition('未使用に近い');
      setCategory('ファッション');
      setFashionGenre('');
      setSize('');
      nav('/');
    }else{
      const body = await r.json().catch(()=>null);
      console.error('create listing failed', body);
      alert('出品に失敗しました');
    }
  }

  return (
    <Layout>
      <h2>新規出品</h2>
      <form onSubmit={submit}>
        <div style={{margin:'8px 0'}}>
          <label>タイトル</label><br/>
          <input
            style={{padding:'8px',width:'260px'}}
            placeholder="商品タイトル"
            value={title}
            onChange={e=>setTitle(e.target.value)}
          />
        </div>

        <div style={{margin:'8px 0'}}>
          <label>価格</label><br/>
          <input
            style={{padding:'8px',width:'260px'}}
            type="number"
            placeholder="価格"
            value={price}
            onChange={e=>setPrice(e.target.value)}
          />
        </div>

        <div style={{margin:'8px 0'}}>
          <label>商品画像</label><br/>
          <input
            type="file"
            accept="image/*"
            onChange={onImageChange}
          />
          {imagePreview && (
            <div style={{marginTop:8}}>
              <img
                src={imagePreview}
                alt="preview"
                style={{width:120,height:120,objectFit:'cover',borderRadius:4}}
              />
            </div>
          )}
        </div>

        <div style={{margin:'8px 0'}}>
          <label>商品の状態</label><br/>
          <select
            style={{padding:'8px',width:'260px'}}
            value={condition}
            onChange={e=>setCondition(e.target.value)}
          >
            <option value="新品・未使用">新品・未使用</option>
            <option value="未使用に近い">未使用に近い</option>
            <option value="目立った傷や汚れなし">目立った傷や汚れなし</option>
            <option value="やや傷や汚れあり">やや傷や汚れあり</option>
            <option value="傷や汚れあり">傷や汚れあり</option>
          </select>
        </div>

        <div style={{margin:'8px 0'}}>
          <label>カテゴリ</label><br/>
          <select
            style={{padding:'8px',width:'260px'}}
            value={category}
            onChange={e=>setCategory(e.target.value)}
          >
            <option value="ファッション">ファッション</option>
            <option value="ベビー">ベビー</option>
            <option value="ゲーム・おもちゃ">ゲーム・おもちゃ</option>
            <option value="家電">家電</option>
            <option value="本・マンガ">本・マンガ</option>
            <option value="その他">その他</option>
          </select>
        </div>

        {isFashion(category) && (
          <>
            <div style={{margin:'8px 0'}}>
              <label>ファッションジャンル</label><br/>
              <input
                style={{padding:'8px',width:'260px'}}
                placeholder="例: トップス / ボトムス など"
                value={fashionGenre}
                onChange={e=>setFashionGenre(e.target.value)}
              />
            </div>

            <div style={{margin:'8px 0'}}>
              <label>サイズ</label><br/>
              <input
                style={{padding:'8px',width:'260px'}}
                placeholder="例: S / M / 27cm など"
                value={size}
                onChange={e=>setSize(e.target.value)}
              />
            </div>
          </>
        )}

        {err && <p style={{color:'red'}}>{err}</p>}

        <button style={{padding:'8px 16px',cursor:'pointer'}}>出品する</button>
      </form>
    </Layout>
  );
}

// 出品編集フォーム（出品者または管理者用）
function ListingEdit(){
  const { id } = useParams();
  const nav = useNavigate();

  const [loading,setLoading] = React.useState(true);
  const [item,setItem]       = React.useState(null);

  const [title,setTitle]             = React.useState('');
  const [price,setPrice]             = React.useState(1000);
  const [imageFile,setImageFile]     = React.useState(null);
  const [imagePreview,setImagePreview] = React.useState('');
  const [condition,setCondition]       = React.useState('未使用に近い');
  const [category,setCategory]         = React.useState('ファッション');
  const [fashionGenre,setFashionGenre] = React.useState('');
  const [size,setSize]                 = React.useState('');
  const [err,setErr] = React.useState('');

  React.useEffect(()=>{
    const t = getToken();
    if(!t){
      nav('/login');
      return;
    }

    async function load(){
      try{
        const [meRes, itemRes] = await Promise.all([
          fetch(AUTH_URL + '/me', { headers:{...authHeader()} }),
          fetch(LISTING_URL + `/listings/${id}`)
        ]);

        const me   = meRes.ok   ? await meRes.json()   : null;
        const data = itemRes.ok ? await itemRes.json() : null;

        if(!me){
          nav('/login');
          return;
        }
        if(!data){
          setErr('商品情報の取得に失敗しました');
          setLoading(false);
          return;
        }

        const isOwner = Number(me.id) === Number(data.seller_id);
        const isAdmin = me.role === 'admin';

        if(!isOwner && !isAdmin){
          setErr('この出品を編集する権限がありません');
          setLoading(false);
          return;
        }


        setItem(data);

        setTitle(data.title || '');
        setPrice(data.price || 1000);
        setCondition(data.condition || '未使用に近い');
        setCategory(data.category || 'ファッション');
        setFashionGenre(data.fashion_genre || '');
        setSize(data.size || '');
        if(data.image_url){
          setImagePreview(LISTING_URL + data.image_url);
        }

        setLoading(false);
      }catch(e){
        console.error(e);
        setErr('商品情報の取得中にエラーが発生しました');
        setLoading(false);
      }
    }

    load();
  },[id, nav]);

  function onImageChange(e){
    const file = e.target.files && e.target.files[0];
    setImageFile(file || null);
    if(file){
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    }
  }

  function isFashion(cat){
    return cat === 'ファッション';
  }

  function validate(){
    if(!title.trim()) return 'タイトルを入力してください';
    if(!price || Number(price) <= 0) return '価格を正しく入力してください';
    if(!condition) return '商品の状態を選択してください';
    if(!category) return 'カテゴリを選択してください';
    if(isFashion(category)){
      if(!fashionGenre.trim()) return 'ファッションジャンルを入力してください';
      if(!size.trim()) return 'サイズを入力してください';
    }
    return '';
  }

  async function submit(e){
    e.preventDefault();
    const msg = validate();
    if(msg){
      setErr(msg);
      return;
    }
    setErr('');

    const fd = new FormData();
    fd.append('title', title);
    fd.append('price', String(price));
    fd.append('condition', condition);
    fd.append('category', category);
    fd.append('fashion_genre', fashionGenre);
    fd.append('size', size);
    if(imageFile){
      fd.append('image', imageFile);
    }

    try{
      const r = await fetch(LISTING_URL + `/listings/${id}`, {
        method: 'PUT',
        headers: {
          ...authHeader()
        },
        body: fd
      });

      if(r.ok){
        alert('出品内容を更新しました');
        nav(`/listings/${id}`);
      }else if(r.status === 403){
        alert('この出品を編集する権限がありません');
      }else{
        const body = await r.json().catch(()=>null);
        console.error('update listing failed', body);
        alert('出品内容の更新に失敗しました');
      }
    }catch(e){
      console.error(e);
      alert('出品内容の更新中にエラーが発生しました');
    }
  }

  if(loading){
    return (
      <Layout>
        <p>読み込み中...</p>
      </Layout>
    );
  }

  if(!item){
    return (
      <Layout>
        <p>商品情報を取得できませんでした。</p>
        {err && <p style={{color:'red'}}>{err}</p>}
      </Layout>
    );
  }

  return (
    <Layout>
      <h2>出品内容の編集</h2>
      {err && <p style={{color:'red'}}>{err}</p>}
      <form onSubmit={submit}>
        <div style={{margin:'8px 0'}}>
          <label>タイトル</label><br/>
          <input
            style={{padding:'8px',width:'260px'}}
            placeholder="商品タイトル"
            value={title}
            onChange={e=>setTitle(e.target.value)}
          />
        </div>

        <div style={{margin:'8px 0'}}>
          <label>価格</label><br/>
          <input
            style={{padding:'8px',width:'260px'}}
            type="number"
            placeholder="価格"
            value={price}
            onChange={e=>setPrice(e.target.value)}
          />
        </div>

        <div style={{margin:'8px 0'}}>
          <label>商品画像（変更したい場合のみ選択）</label><br/>
          <input
            type="file"
            accept="image/*"
            onChange={onImageChange}
          />
          {imagePreview && (
            <div style={{marginTop:8}}>
              <img
                src={imagePreview}
                alt="preview"
                style={{width:120,height:120,objectFit:'cover',borderRadius:4}}
              />
            </div>
          )}
        </div>

        <div style={{margin:'8px 0'}}>
          <label>商品の状態</label><br/>
          <select
            style={{padding:'8px',width:'260px'}}
            value={condition}
            onChange={e=>setCondition(e.target.value)}
          >
            <option value="新品・未使用">新品・未使用</option>
            <option value="未使用に近い">未使用に近い</option>
            <option value="目立った傷や汚れなし">目立った傷や汚れなし</option>
            <option value="やや傷や汚れあり">やや傷や汚れあり</option>
            <option value="傷や汚れあり">傷や汚れあり</option>
          </select>
        </div>

        <div style={{margin:'8px 0'}}>
          <label>カテゴリ</label><br/>
          <select
            style={{padding:'8px',width:'260px'}}
            value={category}
            onChange={e=>setCategory(e.target.value)}
          >
            <option value="ファッション">ファッション</option>
            <option value="ベビー">ベビー</option>
            <option value="ゲーム・おもちゃ">ゲーム・おもちゃ</option>
            <option value="家電">家電</option>
            <option value="本・マンガ">本・マンガ</option>
            <option value="その他">その他</option>
          </select>
        </div>

        {isFashion(category) && (
          <>
            <div style={{margin:'8px 0'}}>
              <label>ファッションジャンル</label><br/>
              <input
                style={{padding:'8px',width:'260px'}}
                placeholder="例: トップス / ボトムス など"
                value={fashionGenre}
                onChange={e=>setFashionGenre(e.target.value)}
              />
            </div>

            <div style={{margin:'8px 0'}}>
              <label>サイズ</label><br/>
              <input
                style={{padding:'8px',width:'260px'}}
                placeholder="例: S / M / 27cm など"
                value={size}
                onChange={e=>setSize(e.target.value)}
              />
            </div>
          </>
        )}

        <button style={{padding:'8px 16px',cursor:'pointer'}}>更新する</button>
      </form>
    </Layout>
  );
}

// 取引一覧（ユーザー）画像付き
function Orders(){
  const [orders,setOrders] = React.useState([]);
  const [loaded,setLoaded] = React.useState(false);
  const nav = useNavigate();

  React.useEffect(()=>{
    const t = getToken();
    if(!t){
      nav('/login');
      return;
    }
    Promise.all([
      fetch(ORDER_URL + '/orders/buyer/me',  { headers:{...authHeader()} }).then(r=>r.ok?r.json():[]),
      fetch(ORDER_URL + '/orders/seller/me', { headers:{...authHeader()} }).then(r=>r.ok?r.json():[])
    ]).then(([bought,sold])=>{
      const merged = [
        ...bought.map(o => ({...o, role:'buyer'})),
        ...sold.map(o => ({...o, role:'seller'}))
      ].sort((a,b)=>b.id - a.id);
      setOrders(merged);
      setLoaded(true);
    }).catch(()=>{
      setOrders([]);
      setLoaded(true);
    });
  },[]);

  if(!loaded) return <Layout><p>読み込み中...</p></Layout>;

  return (
    <Layout>
      <h2>取引一覧</h2>
      {orders.length === 0 && <p>まだ取引がありません。</p>}
      {orders.map(o =>
        <div
          key={o.id}
          style={{display:'flex',gap:12,alignItems:'center',padding:'6px 0', borderBottom:'1px solid #eee', cursor:'pointer'}}
          onClick={()=>nav(`/orders/${o.id}`)}
        >
          {o.image_url && (
            <img
              src={LISTING_URL + o.image_url}
              alt={o.title}
              style={{width:60,height:60,objectFit:'cover',borderRadius:4,flexShrink:0}}
            />
          )}
          <div>
            <div>取引ID: {o.id}</div>
            <div>商品: {o.title}</div>
            <div>金額: ¥{o.price} / 状態: {o.status} / 役割: {o.role === 'buyer' ? '購入側' : '出品側'}</div>
          </div>
        </div>
      )}
    </Layout>
  );
}

// 取引詳細＋画像
// 取引詳細＋画像＋状態管理＋メッセージ
// 取引詳細＋画像＋状態管理＋発送情報＋メッセージ
function OrderDetail(){
  const { id } = useParams();
  const [detail,setDetail] = React.useState(null);
  const [messages,setMessages] = React.useState([]);
  const [text,setText] = React.useState('');
  const [me,setMe] = React.useState(null);
  const [loaded,setLoaded] = React.useState(false);

  React.useEffect(()=>{
    const t = getToken();
    if(!t){
      setLoaded(true);
      return;
    }

    async function load(){
      try{
        const meRes = await fetch(AUTH_URL + '/me',{headers:{...authHeader()}});
        const meJson = meRes.ok ? await meRes.json() : null;
        setMe(meJson);

        const r1 = await fetch(ORDER_URL + `/orders/${id}`, { headers:{...authHeader()} });
        if(r1.ok){
          const d = await r1.json();
          setDetail(d);
        }

        const r2 = await fetch(ORDER_URL + `/orders/${id}/messages`, { headers:{...authHeader()} });
        if(r2.ok){
          const m = await r2.json();
          setMessages(m);
        }
      }finally{
        setLoaded(true);
      }
    }
    load();
  },[id]);

  async function send(e){
    e.preventDefault();
    if(!text.trim()) return;
    const r = await fetch(ORDER_URL + `/orders/${id}/messages`, {
      method:'POST',
      headers:{'Content-Type':'application/json', ...authHeader()},
      body: JSON.stringify({ text })
    });
    if(r.ok){
      const m = await r.json();
      setMessages(prev => [...prev, m]);
      setText('');
    }else{
      alert('メッセージ送信に失敗しました');
    }
  }

  // 発送・到着・受取確定 用
  async function callAction(path){
    if(!detail) return;
    const r = await fetch(ORDER_URL + `/orders/${detail.id}/${path}`, {
      method:'PATCH',
      headers:{ ...authHeader() }
    });

    if(!r.ok){
      const err = await r.json().catch(()=>null);
      console.error('order action error', err);

      if(err && err.error === 'forbidden'){
        alert('出品者または購入者以外はこの操作はできません');
      }else if(err && err.error === 'bad_status'){
        alert('現在のステータスからはこの操作はできません');
      }else if(err && err.error === 'not_found'){
        alert('取引が見つかりませんでした');
      }else{
        alert('操作に失敗しました');
      }
      return;
    }

    const updated = await r.json();
    setDetail(prev => prev ? ({ ...prev, ...updated }) : updated);
  }


  function fmt(dt){
    if(!dt) return null;
    return new Date(dt).toLocaleString();
  }

  // 追加: ヤマト状態を人間向けの表示にする
  function labelYamatoStatus(s){
    if(!s) return '未連携';
    switch(s){
      case 'PENDING':    return '受付待ち';
      case 'PREPARED':   return '準備中';
      case 'SHIPPED':    return '発送済み';
      case 'IN_TRANSIT': return '配送中';
      case 'DELIVERED':  return '配達完了';
      default:           return s;
    }
  }

  const isCompleted = detail && detail.status === 'COMPLETED';
  const isAdmin = me && me.role === 'admin';
  const isSeller = me && detail && Number(me.id) === Number(detail.seller_id);
  const isBuyer  = me && detail && Number(me.id) === Number(detail.buyer_id);

  return (
    <Layout>
      {!loaded && <p>読み込み中...</p>}
      {loaded && !detail && <p>取引情報を取得できませんでした。</p>}
      {detail && (
        <>
          <h2>取引詳細（ID: {detail.id}）</h2>
          {detail.image_url && (
            <img
              src={LISTING_URL + detail.image_url}
              alt={detail.title}
              style={{width:200,height:200,objectFit:'cover',borderRadius:8,marginBottom:12}}
            />
          )}
          <p>商品: {detail.title}</p>
          <p>金額: ¥{detail.price}</p>
          <p>状態: {detail.status}</p>
          <p>出品者: {detail.seller_id}</p>
          <p>購入者: {detail.buyer_id}</p>
          {fmt(detail.created_at)   && <p>購入日時: {fmt(detail.created_at)}</p>}
          {fmt(detail.shipped_at)   && <p>発送日時: {fmt(detail.shipped_at)}</p>}
          {fmt(detail.delivered_at) && <p>到着報告日時: {fmt(detail.delivered_at)}</p>}
          {fmt(detail.confirmed_at) && <p>受取確定日時: {fmt(detail.confirmed_at)}</p>}

          {/* 発送情報: 発送コードと追跡番号は出さず、ヤマト状態だけ表示 */}
          {(isSeller || isBuyer || isAdmin) && (
            <div style={{marginTop:16, padding:12, border:'1px solid #ddd', borderRadius:8}}>
              <h3>発送情報</h3>
              <p>配送状況（ヤマト）: {labelYamatoStatus(detail.yamato_status)}</p>
            </div>
          )}

          {/* 取引状態管理ボタン */}
          <div style={{marginTop:16, display:'flex', gap:8}}>
            {isSeller && detail.status === 'CREATED' && (
              <button
                style={{padding:'6px 12px',cursor:'pointer'}}
                onClick={()=>callAction('ship')}
              >
                発送した
              </button>
            )}

            {isBuyer && detail.status === 'SHIPPED' && (
              <button
                style={{padding:'6px 12px',cursor:'pointer'}}
                onClick={()=>callAction('deliver')}
              >
                商品が到着した
              </button>
            )}

            {isBuyer && detail.status === 'DELIVERED' && (
              <button
                style={{padding:'6px 12px',cursor:'pointer'}}
                onClick={()=>callAction('complete')}
              >
                受取を確定する
              </button>
            )}
          </div>

          <h3 style={{marginTop:24}}>メッセージ</h3>
          {messages.length === 0 && <p>まだメッセージはありません。</p>}
          {messages.map(m =>
            <div key={m.id} style={{borderBottom:'1px solid #eee', padding:'4px 0'}}>
              <div>送信者ID: {m.sender_id}</div>
              <div>{m.body}</div>
              <div style={{fontSize:12,color:'#666'}}>
                {new Date(m.created_at).toLocaleString()}
              </div>
            </div>
          )}

          {!isCompleted && !isAdmin && (
            <form onSubmit={send} style={{marginTop:12}}>
              <textarea
                style={{width:'100%',height:100}}
                placeholder="メッセージを入力"
                value={text}
                onChange={e=>setText(e.target.value)}
              />
              <div style={{marginTop:8}}>
                <button style={{padding:'6px 12px',cursor:'pointer'}}>送信</button>
              </div>
            </form>
          )}
          {isAdmin && <p>※運営アカウントは閲覧のみで、メッセージ送信はできません。</p>}
          {isCompleted && <p>取引完了のため、メッセージ送信はできません。</p>}
        </>
      )}
    </Layout>
  );
}




// 運営用 出品管理
function AdminListings(){
  const [me,setMe] = React.useState(null);
  const [items,setItems] = React.useState([]);
  const [loaded,setLoaded] = React.useState(false);

  React.useEffect(()=>{
    const t = getToken();
    if(!t){
      setLoaded(true);
      setMe(null);
      return;
    }
    async function load(){
      const mr = await fetch(AUTH_URL + '/me',{ headers:{...authHeader()} });
      const u  = mr.ok ? await mr.json() : null;
      setMe(u);
      if(u && u.role === 'admin'){
        const lr = await fetch(LISTING_URL + '/listings');
        const li = lr.ok ? await lr.json() : [];
        setItems(li);
      }
      setLoaded(true);
    }
    load();
  },[]);

  if(!loaded) return <Layout><p>読み込み中...</p></Layout>;
  if(!me) return <Navigate to="/login" />;
  if(me.role !== 'admin') return <Navigate to="/" />;

  async function pause(id){
    const r = await fetch(LISTING_URL + '/listings/' + id + '/pause', {
      method: 'PATCH',
      headers: { ...authHeader() }
    });
    if(r.ok){
      const updated = await r.json();
      setItems(prev => prev.map(x => x.id === updated.id ? updated : x));
    }else{
      alert('停止に失敗しました');
    }
  }

  async function activate(id){
    const r = await fetch(LISTING_URL + '/listings/' + id + '/activate', {
      method: 'PATCH',
      headers: { ...authHeader() }
    });
    if(r.ok){
      const updated = await r.json();
      setItems(prev => prev.map(x => x.id === updated.id ? updated : x));
    }else{
      alert('再開に失敗しました');
    }
  }

  return (
    <Layout>
      <h2>運営管理（出品停止 / 再開）</h2>
      {items.length === 0 && <p>出品がありません。</p>}
      {items.map(x =>
        <div key={x.id} style={{display:'flex', gap:8, alignItems:'center', padding:'6px 0', borderBottom:'1px solid #eee'}}>
          <span>#{x.id} {x.title} ¥{x.price} [{x.status}] seller:{x.seller_id}</span>
          {x.status === 'Active'  && <button onClick={()=>pause(x.id)}>停止</button>}
          {x.status === 'Paused'  && <button onClick={()=>activate(x.id)}>再開</button>}
          {x.status === 'Sold'    && <span>売却済み</span>}
        </div>
      )}
    </Layout>
  );
}

// 運営用 取引一覧（全件）画像付き
function AdminOrders(){
  const [me,setMe] = React.useState(null);
  const [orders,setOrders] = React.useState([]);
  const [loaded,setLoaded] = React.useState(false);
  const nav = useNavigate();

  React.useEffect(()=>{
    const t = getToken();
    if(!t){
      setLoaded(true);
      setMe(null);
      return;
    }
    async function load(){
      const mr = await fetch(AUTH_URL + '/me',{ headers:{...authHeader()} });
      const u  = mr.ok ? await mr.json() : null;
      setMe(u);
      if(u && u.role === 'admin'){
        const or = await fetch(ORDER_URL + '/orders/admin/all',{ headers:{...authHeader()} });
        const os = or.ok ? await or.json() : [];
        setOrders(os);
      }
      setLoaded(true);
    }
    load();
  },[]);

  if(!loaded) return <Layout><p>読み込み中...</p></Layout>;
  if(!me) return <Navigate to="/login" />;
  if(me.role !== 'admin') return <Navigate to="/" />;

  return (
    <Layout>
      <h2>取引一覧（運営用・全件）</h2>
      {orders.length === 0 && <p>まだ取引がありません。</p>}
      {orders.map(o =>
        <div
          key={o.id}
          style={{display:'flex',gap:12,alignItems:'center',padding:'6px 0', borderBottom:'1px solid #eee', cursor:'pointer'}}
          onClick={()=>nav(`/orders/${o.id}`)}
        >
          {o.image_url && (
            <img
              src={LISTING_URL + o.image_url}
              alt={o.title}
              style={{width:60,height:60,objectFit:'cover',borderRadius:4,flexShrink:0}}
            />
          )}
          <div>
            <div>取引ID: {o.id}</div>
            <div>商品: {o.title}</div>
            <div>金額: ¥{o.price} / 状態: {o.status} / 出品者:{o.seller_id} / 購入者:{o.buyer_id}</div>
          </div>
        </div>
      )}
    </Layout>
  );
}

// 運営用 ユーザー一覧・凍結
function AdminUsers(){
  const [me,setMe] = React.useState(null);
  const [users,setUsers] = React.useState([]);
  const [loaded,setLoaded] = React.useState(false);

  React.useEffect(()=>{
    const t = getToken();
    if(!t){
      setLoaded(true);
      setMe(null);
      return;
    }
    async function load(){
      const mr = await fetch(AUTH_URL + '/me',{ headers:{...authHeader()} });
      const u  = mr.ok ? await mr.json() : null;
      setMe(u);
      if(u && u.role === 'admin'){
        const ur = await fetch(AUTH_URL + '/admin/users',{ headers:{...authHeader()} });
        const us = ur.ok ? await ur.json() : [];
        setUsers(us);
      }
      setLoaded(true);
    }
    load();
  },[]);

  if(!loaded) return <Layout><p>読み込み中...</p></Layout>;
  if(!me) return <Navigate to="/login" />;
  if(me.role !== 'admin') return <Navigate to="/" />;

  async function freeze(id){
    const r = await fetch(AUTH_URL + `/admin/users/${id}/freeze`,{
      method:'PATCH',
      headers:{...authHeader()}
    });
    if(r.ok){
      setUsers(prev => prev.map(u => u.id === id ? {...u,disabled:true} : u));
    }else{
      alert('凍結に失敗しました');
    }
  }

  async function unfreeze(id){
    const r = await fetch(AUTH_URL + `/admin/users/${id}/unfreeze`,{
      method:'PATCH',
      headers:{...authHeader()}
    });
    if(r.ok){
      setUsers(prev => prev.map(u => u.id === id ? {...u,disabled:false} : u));
    }else{
      alert('凍結解除に失敗しました');
    }
  }

  return (
    <Layout>
      <h2>ユーザー管理（凍結 / 解除）</h2>
      {users.length === 0 && <p>ユーザーがいません。</p>}
      {users.map(u =>
        <div key={u.id} style={{display:'flex',gap:8,alignItems:'center',padding:'4px 0',borderBottom:'1px solid #eee'}}>
          <span>ID:{u.id} / {u.email} / 役割:{u.role} / 状態:{u.disabled ? '凍結中' : '有効'}</span>
          {u.role !== 'admin' && (
            u.disabled
              ? <button onClick={()=>unfreeze(u.id)}>凍結解除</button>
              : <button onClick={()=>freeze(u.id)}>凍結</button>
          )}
        </div>
      )}
    </Layout>
  );
}

const router = createBrowserRouter([
  { path: '/',               element: <MyPage/> },
  { path: '/login',          element: <Login/> },
  { path: '/register',       element: <Register/> },
  { path: '/listings',       element: <ListingList/> },
  { path: '/listings/:id',   element: <ListingDetail/> },
  { path: '/listings/:id/edit', element: <ListingEdit/> },
  { path: '/sell',           element: <Sell/> },
  { path: '/orders',         element: <Orders/> },
  { path: '/orders/:id',     element: <OrderDetail/> },
  { path: '/admin/listings', element: <AdminListings/> },
  { path: '/admin/orders',   element: <AdminOrders/> },
  { path: '/admin/users',    element: <AdminUsers/> },
]);

createRoot(document.getElementById('root')).render(
  <RouterProvider router={router} />
);
