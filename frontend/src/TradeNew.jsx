import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { tradeApi } from "./tradeApi";

const LISTING_URL = import.meta.env.VITE_LISTING_URL || "http://localhost:4110";

function authHeader() {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function useQuery() {
  const { search } = useLocation();
  return React.useMemo(() => new URLSearchParams(search), [search]);
}

function isInStock(l) {
  const q = Number(l?.quantity ?? 0);
  const st = String(l?.status ?? "Active");
  if (q <= 0) return false;
  if (st === "Traded" || st === "Sold" || st === "Inactive") return false;
  return true;
}

export default function TradeNew() {
  const nav = useNavigate();
  const q = useQuery();

  const takeListingIdFromQuery = Number(q.get("take_listing_id") || "0");

  const [target, setTarget] = React.useState(null);
  const [others, setOthers] = React.useState([]);
  const [mine, setMine] = React.useState([]);

  const [takeListingId, setTakeListingId] = React.useState(takeListingIdFromQuery);
  const [giveListingId, setGiveListingId] = React.useState(0);

  const [takeQty, setTakeQty] = React.useState(1); // もらう数量（提案先）
  const [giveQty, setGiveQty] = React.useState(1); // 自分が出す数量

  const [proposal, setProposal] = React.useState("");
  const [err, setErr] = React.useState("");
  const [ok, setOk] = React.useState("");

  const mySellerId = mine?.[0]?.seller_id ?? null;

  React.useEffect(() => {
    setErr("");
    setOk("");

    // 自分の出品（在庫0は後でUIから除外）
    fetch(`${LISTING_URL}/listings/mine`, { headers: { ...authHeader() } })
      .then(async (r) => {
        if (r.status === 401) throw new Error("ログインが必要です（自分の出品を取得できません）");
        if (!r.ok) throw new Error("自分の出品の取得に失敗しました");
        return r.json();
      })
      .then((xs) => setMine(Array.isArray(xs) ? xs : []))
      .catch((e) => setErr(String(e?.message || e)));

    // 提案先がクエリで指定されている場合はそれを取得して固定
    if (takeListingIdFromQuery > 0) {
      fetch(`${LISTING_URL}/listings/${takeListingIdFromQuery}`, { headers: { ...authHeader() } })
        .then(async (r) => {
          if (!r.ok) throw new Error("提案先の出品を取得できません");
          return r.json();
        })
        .then((x) => {
          setTarget(x);
          setTakeListingId(takeListingIdFromQuery);
        })
        .catch((e) => setErr(String(e?.message || e)));
      return;
    }

    // クエリ指定が無い場合：全出品から「自分以外 + 在庫あり」だけ候補にする
    fetch(`${LISTING_URL}/listings`, { headers: { ...authHeader() } })
      .then(async (r) => {
        if (!r.ok) throw new Error("提案先の候補一覧を取得できません");
        return r.json();
      })
      .then((xs) => setOthers(Array.isArray(xs) ? xs : []))
      .catch((e) => setErr(String(e?.message || e)));
  }, [takeListingIdFromQuery]);

  // クエリ指定無しの時だけ、選択された提案先の詳細を追従
  React.useEffect(() => {
    if (takeListingIdFromQuery > 0) return;
    if (!(takeListingId > 0)) {
      setTarget(null);
      return;
    }
    fetch(`${LISTING_URL}/listings/${takeListingId}`, { headers: { ...authHeader() } })
      .then(async (r) => {
        if (!r.ok) throw new Error("提案先の出品を取得できません");
        return r.json();
      })
      .then(setTarget)
      .catch((e) => setErr(String(e?.message || e)));
  }, [takeListingId, takeListingIdFromQuery]);

  const mineInStock = React.useMemo(() => {
    const xs = Array.isArray(mine) ? mine : [];
    return xs.filter(isInStock);
  }, [mine]);

  const othersInStock = React.useMemo(() => {
    const xs = Array.isArray(others) ? others : [];
    return xs
      .filter(isInStock)
      .filter((x) => (mySellerId ? Number(x.seller_id) !== Number(mySellerId) : true));
  }, [others, mySellerId]);

  async function submit() {
    setErr("");
    setOk("");

    if (!(takeListingId > 0)) {
      setErr("提案先の出品を選んでください");
      return;
    }
    if (!target) {
      setErr("提案先の出品を取得できていません");
      return;
    }
    if (mySellerId && Number(target.seller_id) === Number(mySellerId)) {
      setErr("自分の出品には交換提案できません");
      return;
    }
    if (!isInStock(target)) {
      setErr("提案先が在庫なしのため提案できません");
      return;
    }

    const giveObj = mineInStock.find((x) => Number(x.id) === Number(giveListingId));
    if (!giveObj) {
      setErr("自分が出す出品を選んでください（在庫ありのみ表示）");
      return;
    }
    if (!Number.isInteger(giveQty) || giveQty <= 0) {
      setErr("自分が出す数量が不正です");
      return;
    }
    if (!Number.isInteger(takeQty) || takeQty <= 0) {
      setErr("もらう数量が不正です");
      return;
    }
    if (giveQty > Number(giveObj.quantity)) {
      setErr("自分が出す数量が在庫を超えています");
      return;
    }
    if (takeQty > Number(target.quantity)) {
      setErr("もらう数量が相手の在庫を超えています");
      return;
    }

    const receiver_id = Number(target.seller_id);

    try {
      await tradeApi.create(
        receiver_id,
        [{ listing_id: Number(giveObj.id), quantity: giveQty }],
        [{ listing_id: Number(target.id), quantity: takeQty }],
        proposal
      );
      setOk("提案を作成しました");
      nav("/trades");
    } catch (e) {
      setErr(String(e?.message || e));
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 900 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/trades">← 取引一覧へ</Link>
      </div>

      <h2>交換提案を作成</h2>

      {/* 提案先 */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700 }}>提案先</div>

        {takeListingIdFromQuery > 0 ? (
          <div style={{ marginTop: 6 }}>
            #{target?.id} {target?.fruit_name || target?.title || "不明"}（在庫:{target?.quantity ?? "-"}）
          </div>
        ) : (
          <select
            style={{ marginTop: 6, width: "100%", padding: 8 }}
            value={takeListingId || 0}
            onChange={(e) => setTakeListingId(Number(e.target.value))}
          >
            <option value={0}>選択してください</option>
            {othersInStock.map((x) => (
              <option key={x.id} value={x.id}>
                #{x.id} {x.fruit_name || x.title || "不明"}（在庫:{x.quantity}）
              </option>
            ))}
          </select>
        )}

        {/* ここに「もらう数量」を置く */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700 }}>もらう数量</div>
          <input
            style={{ width: 120, marginTop: 6, padding: 6 }}
            type="number"
            min="1"
            value={takeQty}
            onChange={(e) => setTakeQty(Number(e.target.value))}
          />
        </div>
      </div>

      {/* 自分が出す */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 700 }}>自分が出すもの（在庫ありのみ）</div>

        <select
          style={{ marginTop: 6, width: "100%", padding: 8 }}
          value={giveListingId || 0}
          onChange={(e) => setGiveListingId(Number(e.target.value))}
        >
          <option value={0}>選択してください</option>
          {mineInStock.map((x) => (
            <option key={x.id} value={x.id}>
              #{x.id} {x.fruit_name || x.title || "不明"}（在庫:{x.quantity}）
            </option>
          ))}
        </select>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700 }}>自分が出す数量</div>
          <input
            style={{ width: 120, marginTop: 6, padding: 6 }}
            type="number"
            min="1"
            value={giveQty}
            onChange={(e) => setGiveQty(Number(e.target.value))}
          />
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 700 }}>メッセージ（任意）</div>
        <textarea
          style={{ width: "100%", marginTop: 6, padding: 8, minHeight: 80 }}
          value={proposal}
          onChange={(e) => setProposal(e.target.value)}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={submit}>提案する</button>
        {ok ? <span style={{ marginLeft: 10 }}>{ok}</span> : null}
      </div>

      {err ? <pre style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{err}</pre> : null}
    </div>
  );
}
