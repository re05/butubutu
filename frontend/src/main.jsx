import React from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
  Link,
  Navigate,
  useNavigate,
  useLocation,
  useParams,
} from "react-router-dom";

import Trades from "./Trades.jsx";
import TradeDetail from "./TradeDetail.jsx";
import TradeNew from "./TradeNew.jsx";

const AUTH_URL = import.meta.env.VITE_AUTH_URL || "http://localhost:4100";
const LISTING_URL = import.meta.env.VITE_LISTING_URL || "http://localhost:4110";
const TRADE_URL = import.meta.env.VITE_TRADE_URL || "http://localhost:4120";

function saveToken(t) {
  localStorage.setItem("token", t);
}
function getToken() {
  return localStorage.getItem("token");
}
function clearToken() {
  localStorage.removeItem("token");
  localStorage.removeItem("uid");
}
function authHeader() {
  const t = getToken();
  return t ? { Authorization: "Bearer " + t } : {};
}

function resolveImg(url, LISTING_URL) {
  if (!url) return "";
  if (url.startsWith("/fruits/")) return url;                 // フロントのpublic配信
  if (url.startsWith("/uploads/")) return LISTING_URL + url;  // listing-svc配信
  return url;
}


function Layout({ children }) {
  const [me, setMe] = React.useState(null);
  const [loaded, setLoaded] = React.useState(false);
  const nav = useNavigate();
  const loc = useLocation();

  React.useEffect(() => {
    const t = getToken();
    if (!t) {
      setMe(null);
      setLoaded(true);
      return;
    }
    fetch(AUTH_URL + "/me", { headers: { ...authHeader() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        setMe(u);
        setLoaded(true);
        if (u && u.id) localStorage.setItem("uid", String(u.id));
      })
      .catch(() => {
        setMe(null);
        setLoaded(true);
      });
  }, [loc.pathname]);

  function onLogout() {
    clearToken();
    setMe(null);
    nav("/login");
  }

  return (
    <div
      style={{
        maxWidth: 980,
        margin: "24px auto",
        fontFamily: "system-ui",
        padding: "0 12px",
      }}
    >
      <nav
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 16,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Link to="/">マイページ</Link>
        <Link to="/listings">出品一覧</Link>
        <Link to="/sell">出品</Link>
        <Link to="/trades">取引（提案）</Link>

        <span style={{ marginLeft: "auto" }} />
        {!loaded ? <span>読込中...</span> : null}
        {loaded && !me ? (
          <>
            <Link to="/login">ログイン</Link>
            <Link to="/register">新規登録</Link>
          </>
        ) : null}
        {loaded && me ? (
          <>
            <span>{me.email}</span>
            <button
              onClick={onLogout}
              style={{ marginLeft: 8, padding: "4px 8px", cursor: "pointer" }}
            >
              ログアウト
            </button>
          </>
        ) : null}
      </nav>
      <hr />
      <div style={{ marginTop: 16 }}>{children}</div>
      <div style={{ marginTop: 24, fontSize: 12, opacity: 0.6 }}>
        API: auth={AUTH_URL} listing={LISTING_URL} trade={TRADE_URL}
      </div>
    </div>
  );
}

function RequireAuth({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

function Login() {
  const nav = useNavigate();
  const [email, setEmail] = React.useState("test@test.com");
  const [password, setPassword] = React.useState("pass");
  const [err, setErr] = React.useState("");

  async function onLogin(e) {
    e.preventDefault();
    setErr("");
    const r = await fetch(AUTH_URL + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      if (body && body.error === "disabled") {
        setErr("このユーザーは凍結されています");
      } else {
        setErr("ログインに失敗しました");
      }
      return;
    }
    const j = await r.json();
    saveToken(j.token);
    nav("/");
  }

  return (
    <Layout>
      <h2>ログイン</h2>
      <form onSubmit={onLogin}>
        <div style={{ margin: "8px 0" }}>
          <label>メールアドレス</label>
          <br />
          <input
            style={{ padding: "8px", width: "260px" }}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div style={{ margin: "8px 0" }}>
          <label>パスワード</label>
          <br />
          <input
            style={{ padding: "8px", width: "260px" }}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button style={{ padding: "8px 16px", cursor: "pointer" }}>
          ログイン
        </button>
      </form>
      {err ? <p style={{ color: "red" }}>{err}</p> : null}
      <p style={{ marginTop: 16 }}>
        アカウントをお持ちでない方は <Link to="/register">新規登録</Link>
      </p>
    </Layout>
  );
}

function Register() {
  const nav = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  const [fullName, setFullName] = React.useState("");
  const [postalCode, setPostalCode] = React.useState("");
  const [prefecture, setPrefecture] = React.useState("");
  const [city, setCity] = React.useState("");
  const [addressLine, setAddressLine] = React.useState("");
  const [phone, setPhone] = React.useState("");

  const [err, setErr] = React.useState("");

  async function onRegister(e) {
    e.preventDefault();
    setErr("");

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
      setErr("すべての項目を入力してください");
      return;
    }

    const r = await fetch(AUTH_URL + "/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        fullName,
        postalCode,
        prefecture,
        city,
        addressLine,
        phone,
      }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      if (body && body.error === "exists") setErr("既に登録されています");
      else setErr("登録に失敗しました");
      return;
    }
    const j = await r.json();
    saveToken(j.token);
    nav("/");
  }

  return (
    <Layout>
      <h2>新規登録</h2>
      <form onSubmit={onRegister}>
        <Field label="メールアドレス" value={email} onChange={setEmail} />
        <Field label="パスワード" value={password} onChange={setPassword} type="password" />
        <hr style={{ margin: "12px 0" }} />
        <Field label="氏名" value={fullName} onChange={setFullName} />
        <Field label="郵便番号" value={postalCode} onChange={setPostalCode} />
        <Field label="都道府県" value={prefecture} onChange={setPrefecture} />
        <Field label="市区町村" value={city} onChange={setCity} />
        <Field label="住所" value={addressLine} onChange={setAddressLine} />
        <Field label="電話" value={phone} onChange={setPhone} />

        <button style={{ padding: "8px 16px", cursor: "pointer" }}>
          登録
        </button>
      </form>
      {err ? <p style={{ color: "red" }}>{err}</p> : null}
    </Layout>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <div style={{ margin: "8px 0" }}>
      <label>{label}</label>
      <br />
      <input
        style={{ padding: "8px", width: "360px", maxWidth: "90vw" }}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function MyPage() {
  const [mine, setMine] = React.useState([]);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    setErr("");
    fetch(LISTING_URL + "/listings/mine", { headers: { ...authHeader() } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((rows) => setMine(Array.isArray(rows) ? rows : []))
      .catch(() => setErr("自分の出品を取得できません"));
  }, []);

  return (
    <Layout>
      <h2>マイページ</h2>
      {err ? <p style={{ color: "red" }}>{err}</p> : null}
      <div style={{ marginTop: 8 }}>自分の出品</div>
      <ListingCards rows={mine} />
      <div style={{ marginTop: 12 }}>
        <Link to="/sell">出品する</Link>
      </div>
    </Layout>
  );
}

function ListingCards({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return <div style={{ marginTop: 8 }}>なし</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginTop: 8 }}>
      {rows.map((l) => {
        const outOfStock = Number(l.quantity) <= 0 || l.status === "Traded";

        return (
          <div
            key={l.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 12,
              opacity: outOfStock ? 0.6 : 1,
            }}
          >
            {l.image_url ? (
              <img
                src={resolveImg(l.image_url, LISTING_URL)}
                alt="fruit"
                style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 8 }}
              />
            ) : null}

            <div style={{ marginTop: 8, fontWeight: 700 }}>{l.fruit_name || l.title}</div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div>数量: {l.quantity}</div>
              {outOfStock ? (
                <div style={{ fontWeight: 700, color: "#b00020" }}>在庫なし</div>
              ) : null}
            </div>

            <div style={{ fontSize: 12, opacity: 0.75 }}>
              欲しい: {(l.wants || []).map((w) => w.name).join(" / ") || "-"}
            </div>

            <div style={{ marginTop: 8 }}>
              <Link to={`/listings/${l.id}`}>詳細</Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}



function ListingList() {
  const [items, setItems] = React.useState([]);
  const [fruitId, setFruitId] = React.useState("");
  const [wantId, setWantId] = React.useState("");
  const [rows, setRows] = React.useState([]);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    fetch(LISTING_URL + "/catalog/items")
      .then((r) => (r.ok ? r.json() : []))
      .then((x) => setItems(Array.isArray(x) ? x : []))
      .catch(() => setItems([]));
  }, []);

  async function search() {
    setErr("");
    const qs = new URLSearchParams();
    if (fruitId) qs.set("fruit_item_id", fruitId);
    if (wantId) qs.set("want_id", wantId);
    const url = LISTING_URL + "/listings" + (qs.toString() ? `?${qs}` : "");
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error();
      const x = await r.json();
      setRows(Array.isArray(x) ? x : []);
    } catch {
      setErr("出品一覧を取得できません");
    }
  }

  React.useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fruitId, wantId]);

  return (
    <Layout>
      <h2>出品一覧</h2>
      {err ? <p style={{ color: "red" }}>{err}</p> : null}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          出す果物
          <select value={fruitId} onChange={(e) => setFruitId(e.target.value)} style={{ marginLeft: 6 }}>
            <option value="">すべて</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>{it.name}</option>
            ))}
          </select>
        </div>
        <div>
          欲しい果物
          <select value={wantId} onChange={(e) => setWantId(e.target.value)} style={{ marginLeft: 6 }}>
            <option value="">すべて</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>{it.name}</option>
            ))}
          </select>
        </div>
        <button onClick={search}>更新</button>
      </div>
      <ListingCards rows={rows} />
    </Layout>
  );
}

function ListingDetail() {
  const { listingId } = useParams();
  const id = Number(listingId);
  const nav = useNavigate();

  const [l, setL] = React.useState(null);
  const [err, setErr] = React.useState("");
  const [seller, setSeller] = React.useState(null);
  const [me, setMe] = React.useState(null);

  // 自分情報（自分の出品か判定に使う）
  React.useEffect(() => {
    const t = getToken();
    if (!t) {
      setMe(null);
      return;
    }
    fetch(`${AUTH_URL}/me`, { headers: { ...authHeader() } })
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  // 出品取得
  React.useEffect(() => {
    setErr("");
    setL(null);

    if (!Number.isInteger(id) || id <= 0) {
      setErr("URLのIDが不正です");
      return;
    }

    fetch(`${LISTING_URL}/listings/${id}`, { headers: { ...authHeader() } })
      .then(async (r) => {
        if (r.status === 401) throw new Error("ログインが必要です");
        if (!r.ok) throw new Error(`出品を取得できません (${r.status})`);
        return r.json();
      })
      .then(setL)
      .catch((e) => setErr(String(e?.message || e)));
  }, [id]);

  // 出品者情報
  React.useEffect(() => {
    if (!l?.seller_id) return;
    fetch(`${AUTH_URL}/users/${l.seller_id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setSeller)
      .catch(() => setSeller(null));
  }, [l?.seller_id]);

  if (err) {
    return (
      <Layout>
        <h2>出品詳細</h2>
        <p style={{ color: "red" }}>{err}</p>
      </Layout>
    );
  }

  if (!l) {
    return (
      <Layout>
        <h2>出品詳細</h2>
        <p>読み込み中...</p>
      </Layout>
    );
  }

  const isMine = me && Number(me.id) === Number(l.seller_id);
  const outOfStock = Number(l.quantity) <= 0 || l.status === "Traded";

  return (
    <Layout>
      <h2>出品詳細</h2>

      {l.image_url ? (
        <img
          src={resolveImg(l.image_url, LISTING_URL)}
          alt="fruit"
          style={{
            width: 320,
            height: 240,
            objectFit: "cover",
            borderRadius: 10,
            border: "1px solid #ddd",
            marginBottom: 10,
          }}
        />
      ) : null}

      <div>出品者：{seller?.email ?? `ID:${l.seller_id}`}</div>
      <div>商品：{l.fruit_name || l.title || "-"}</div>
      <div>数量：{l.quantity}</div>

      {outOfStock ? (
        <div style={{ marginTop: 12, fontWeight: 700, color: "#b00020" }}>
          在庫なし
        </div>
      ) : isMine ? (
        <div style={{ marginTop: 12, opacity: 0.8 }}>
          自分の出品には交換提案できません
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <button onClick={() => nav(`/trades/new?take_listing_id=${id}`)}>
            交換を提案する
          </button>
        </div>
      )}
    </Layout>
  );
}





function Sell() {
  const nav = useNavigate();
  const [items, setItems] = React.useState([]);
  const [fruitItemId, setFruitItemId] = React.useState(1);
  const [quantity, setQuantity] = React.useState(1);
  const [description, setDescription] = React.useState("");
  const [wants, setWants] = React.useState([]);
  const [msg, setMsg] = React.useState("");

  React.useEffect(() => {
    fetch(`${LISTING_URL}/catalog/items`)
      .then((r) => (r.ok ? r.json() : []))
      .then((x) => setItems(Array.isArray(x) ? x : []))
      .catch(() => setItems([]));
  }, []);

const imgFor = (id) => {
  const base = import.meta.env.BASE_URL || "/";
  const map = {
    1: "fruits/apple.png",
    2: "fruits/banana.png",
    3: "fruits/orange.png",
    4: "fruits/grape.png",
    5: "fruits/strawberry.png",
  };
  const p = map[id];
  return p ? base + p : null;
};


  const toggleWant = (id) => {
    setWants((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  };
  const token = localStorage.getItem("token") || "";
  if (!token) return <div style={{ padding: 16 }}>ログインしてください</div>;

  async function onSubmit(e) {
    e.preventDefault();
    setMsg("");

    if (wants.length === 0) {
      setMsg("欲しい果物を1つ以上選んでください");
      return;
    }

    const r = await fetch(`${LISTING_URL}/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({
        fruit_item_id: fruitItemId,
        quantity,
        want_fruit_item_ids: wants,
        description,
      }),
    });

    if (!r.ok) {
      if (r.status === 409) {
        setErr("既に登録されています");
        return;
      }
      setErr("登録に失敗しました");
      return;
    }


    setMsg("出品しました");
    nav("/listings");
  }

  return (
    <Layout>
      <h2>出品（果物）</h2>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, maxWidth: 520 }}>
        <label>
          出す果物
          <select
            value={fruitItemId}
            onChange={(e) => setFruitItemId(Number(e.target.value))}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
          >
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </select>
        </label>

        <div>
          <div>画像プレビュー</div>
          <img
            src={imgFor(fruitItemId)}
            alt="fruit"
            style={{ width: 180, height: 180, objectFit: "cover", borderRadius: 8, marginTop: 6 }}
          />
        </div>

        <label>
          数量
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
          />
        </label>

        <div>
          <div>欲しい果物（最大3つ）</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            {items.map((it) => {
              const checked = wants.includes(it.id);
              const disabled = !checked && wants.length >= 3;
              return (
                <button
                  type="button"
                  key={it.id}
                  onClick={() => toggleWant(it.id)}
                  disabled={disabled}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid #ccc",
                    background: checked ? "#eee" : "#fff",
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >
                  {it.name}
                  {checked ? " ✓" : ""}
                </button>
              );
            })}
          </div>
        </div>

        <label>
          説明（任意）
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
          />
        </label>

        <button type="submit" style={{ padding: 10 }}>
          出品する
        </button>
        {msg ? <div>{msg}</div> : null}
      </form>
    </Layout>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <RequireAuth>
        <MyPage />
      </RequireAuth>
    ),
  },
  { path: "/login", element: <Login /> },
  { path: "/register", element: <Register /> },
  { path: "/listings", element: <ListingList /> },
  { path: "/listings/:listingId", element: (<RequireAuth><ListingDetail /></RequireAuth>) },
  {
    path: "/sell",
    element: (
      <RequireAuth>
        <Sell />
      </RequireAuth>
    ),
  },
  {
    path: "/trades",
    element: (
      <RequireAuth>
        <Layout>
          <Trades />
        </Layout>
      </RequireAuth>
    ),
  },
  {
    path: "/trades/new",
    element: (
      <RequireAuth>
        <Layout>
          <TradeNew />
        </Layout>
      </RequireAuth>
    ),
  },
  {
    path: "/trades/:id",
    element: (
      <RequireAuth>
        <Layout>
          <TradeDetail />
        </Layout>
      </RequireAuth>
    ),
  },

]);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
