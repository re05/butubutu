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

/**
 * 相場（固定表）
 * fruit_item_id -> 価値（数値が大きいほど高い）
 * 必要に応じて追加/調整してください
 */
const FRUIT_VALUE = {
  1: 100, // リンゴ
  2: 80,  // バナナ
  3: 90,  // オレンジ
  // 例:
  // 4: 120, // ブドウ
  // 5: 200, // イチゴ
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

function fmtQty(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  // 1.00 -> 1 / 1.25 -> 1.25
  const v = Math.round(x * 100) / 100;
  return Number.isInteger(v) ? String(v) : String(v);
}

function FruitLabel({ name, img }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {img ? (
        <img
          src={img}
          alt=""
          style={{ width: 22, height: 18, objectFit: "cover", borderRadius: 4 }}
        />
      ) : null}
      <span>{name}</span>
    </span>
  );
}


/**
 * 相手(take)の数量に対して、自分(give)が出す「目安数量」を返す
 * fair = (take価値 * takeQty) / give価値
 */
function calcFairGiveQty(giveFruitItemId, takeFruitItemId, takeQty) {
  const gv = FRUIT_VALUE[Number(giveFruitItemId)];
  const tv = FRUIT_VALUE[Number(takeFruitItemId)];
  const tq = Number(takeQty);
  if (!gv || !tv) return null;
  if (!Number.isFinite(tq) || tq <= 0) return null;
  return (tv * tq) / gv;
}

function judgeOffer(giveQty, fairGiveQty) {
  const g = Number(giveQty);
  const f = Number(fairGiveQty);
  if (!Number.isFinite(g) || !Number.isFinite(f) || f <= 0) return "";
  const diff = (g - f) / f;
  if (Math.abs(diff) <= 0.1) return "だいたい相場";
  return diff > 0 ? "相場より多め（相手に有利）" : "相場より少なめ（相手に不利）";
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

    fetch(`${LISTING_URL}/listings/mine`, { headers: { ...authHeader() } })
      .then(async (r) => {
        if (r.status === 401) throw new Error("ログインが必要です（自分の出品を取得できません）");
        if (!r.ok) throw new Error("自分の出品の取得に失敗しました");
        return r.json();
      })
      .then((xs) => setMine(Array.isArray(xs) ? xs : []))
      .catch((e) => setErr(String(e?.message || e)));

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

    fetch(`${LISTING_URL}/listings`, { headers: { ...authHeader() } })
      .then(async (r) => {
        if (!r.ok) throw new Error("提案先の候補一覧を取得できません");
        return r.json();
      })
      .then((xs) => setOthers(Array.isArray(xs) ? xs : []))
      .catch((e) => setErr(String(e?.message || e)));
  }, [takeListingIdFromQuery]);

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

  // ここから相場表示（mineInStock が定義された後に置く）
  const giveSelected = React.useMemo(() => {
    return mineInStock.find((x) => Number(x.id) === Number(giveListingId)) || null;
  }, [mineInStock, giveListingId]);

  const marketInfo = React.useMemo(() => {
    if (!target || !giveSelected) return null;

    const fair = calcFairGiveQty(
      giveSelected.fruit_item_id,
      target.fruit_item_id,
      takeQty
    );
    if (fair == null) return { missing: true };

    const per1 = calcFairGiveQty(
      giveSelected.fruit_item_id,
      target.fruit_item_id,
      1
    );

    return {
      missing: false,
      giveName: giveSelected.fruit_name || giveSelected.title || "自分の果物",
      takeName: target.fruit_name || target.title || "相手の果物",
      giveImg: giveSelected.image_url || "",
      takeImg: target.image_url || "",
      per1: per1 == null ? null : round2(per1),
      fairGive: round2(fair),
      judge: judgeOffer(giveQty, fair),
    };
  }, [target, giveSelected, takeQty, giveQty]);


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

{target && giveSelected ? (
  <div style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
    <div style={{ fontWeight: 700 }}>相場（目安）</div>

    {marketInfo?.missing ? (
      <div style={{ marginTop: 8 }}>
        この組み合わせの相場データが未登録です（FRUIT_VALUE を追加してください）
      </div>
    ) : marketInfo ? (
      <>
        {/* 相場：表だけ（数量=1 の列は出さない） */}
        <table
          border="1"
          cellPadding="8"
          style={{ borderCollapse: "collapse", width: "100%", marginTop: 10 }}
        >
          <thead>
            <tr>
              <th style={{ width: "45%" }}>相手（1個）</th>
              <th style={{ width: "55%" }}>同じ価値の目安</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <FruitLabel name={marketInfo.takeName} img={marketInfo.takeImg} />
              </td>
              <td style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <FruitLabel name={marketInfo.giveName} img={marketInfo.giveImg} />
                <span style={{ fontWeight: 800, fontSize: 16 }}>
                  {fmtQty(marketInfo.per1)}
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* あなたの提案：果物と数量を分ける（くっつけない、+も出さない） */}
        <div style={{ marginTop: 12, fontWeight: 700 }}>あなたの提案（入力に連動）</div>

        <table
          border="1"
          cellPadding="8"
          style={{ borderCollapse: "collapse", width: "100%", marginTop: 8 }}
        >
          <thead>
            <tr>
              <th>あなたが出す</th>
              <th style={{ width: 120 }}>数量</th>
              <th>あなたがもらう</th>
              <th style={{ width: 120 }}>数量</th>
              <th style={{ width: 260 }}>判定</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><FruitLabel name={marketInfo.giveName} img={marketInfo.giveImg} /></td>
              <td style={{ textAlign: "right", fontWeight: 800 }}>{fmtQty(giveQty)}</td>
              <td><FruitLabel name={marketInfo.takeName} img={marketInfo.takeImg} /></td>
              <td style={{ textAlign: "right", fontWeight: 800 }}>{fmtQty(takeQty)}</td>
              <td style={{ fontWeight: 800 }}>{marketInfo.judge}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          目安の出す数量（もらう数量 {fmtQty(takeQty)} に対して）: {fmtQty(marketInfo.fairGive)}
        </div>
      </>
    ) : null}
  </div>
) : null}


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
