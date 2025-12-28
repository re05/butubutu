import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { tradeApi } from "./tradeApi";

const AUTH_URL = import.meta.env.VITE_AUTH_URL || "http://localhost:4100";
const LISTING_URL = import.meta.env.VITE_LISTING_URL || "http://localhost:4110";

function statusJa(s) {
  const v = String(s || "");
  if (v === "Proposed") return "提案中";
  if (v === "Accepted") return "承諾済み";
  if (v === "Shipping") return "発送中";
  if (v === "Completed") return "完了";
  if (v === "Rejected") return "却下";
  return v || "-";
}


function authHeader() {
  const t = localStorage.getItem("token") || "";
  return t ? { Authorization: "Bearer " + t } : {};
}

function resolveImg(url) {
  if (!url) return "";
  if (url.startsWith("/fruits/")) return url;
  if (url.startsWith("/uploads/")) return LISTING_URL + url;
  return url;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { ...authHeader() } });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = typeof data === "string" ? data : data?.error || `http_${r.status}`;
    throw new Error(msg);
  }
  return data;
}

function BadgeYou() {
  return (
    <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 999, border: "1px solid #666", fontSize: 12, opacity: 0.85 }}>
      あなた
    </span>
  );
}

function ItemsTable({ title, isYou, rows, editable, onChangeQty }) {
  return (
    <div style={{ flex: 1, border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
      <div style={{ fontWeight: 800 }}>
        {title}
        {isYou ? <BadgeYou /> : null}
      </div>

      <table border="1" cellPadding="6" style={{ borderCollapse: "collapse", width: "100%", marginTop: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 72 }}>画像</th>
            <th>品名</th>
            <th style={{ width: 110 }}>取引数量</th>
            <th style={{ width: 90 }}>現在庫</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan="4">なし</td></tr>
          ) : (
            rows.map((x, idx) => {
              const outOfStock = Number(x.stock_now) <= 0 || x.status === "Traded";
              return (
                <tr key={idx}>
                  <td>
                    {x.image_url ? (
                      <img src={resolveImg(x.image_url)} alt="fruit" style={{ width: 60, height: 45, objectFit: "cover", borderRadius: 6 }} />
                    ) : null}
                  </td>
                  <td>{x.name || `#${x.listing_id}`}</td>
                  <td>
                    {editable ? (
                      <input
                        type="number"
                        min="1"
                        style={{ width: 90, padding: 4 }}
                        value={x.trade_qty}
                        onChange={(e) => onChangeQty(x.side, x.listing_id, Number(e.target.value))}
                      />
                    ) : (
                      x.trade_qty
                    )}
                  </td>
                  <td>
                    {outOfStock ? <span style={{ color: "#b00020", fontWeight: 700 }}>在庫なし</span> : x.stock_now}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function TradeDetail() {
  const { id } = useParams();
  const tradeId = Number(id);

  const [me, setMe] = useState(null);
  const [trade, setTrade] = useState(null);
  const [err, setErr] = useState("");

  const [users, setUsers] = useState({});
  const [listings, setListings] = useState({});

  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState("");

  // 提案者が数量を編集するための下書き
  const [draftQty, setDraftQty] = useState({}); // key: "give:1" / "take:2"

  const myId = Number(me?.id || 0);
  const status = trade?.status || "";
  const proposerId = Number(trade?.proposer_id || 0);
  const receiverId = Number(trade?.receiver_id || 0);

  const youAreReceiver = myId > 0 && receiverId === myId;
  const youAreProposer = myId > 0 && proposerId === myId;

  const canDecide = !!trade && status === "Proposed" && youAreReceiver;

  // 承諾前もチャット可能（Rejected だけ不可、という設計に合わせる）
  const canChat = !!trade && status !== "Rejected";

  // 提案者のみ、Proposed の間だけ数量を変更可能
  const canEditItems = !!trade && status === "Proposed" && youAreProposer;

  const shippedMine = youAreProposer ? trade?.shipped_proposer_at : trade?.shipped_receiver_at;
  const receivedMine = youAreProposer ? trade?.received_proposer_at : trade?.received_receiver_at;
  const bothShipped = !!trade?.shipped_proposer_at && !!trade?.shipped_receiver_at;

  const canShip =
    !!trade &&
    (status === "Accepted" || status === "Shipping") &&
    (youAreProposer || youAreReceiver) &&
    !shippedMine;

  const canReceived =
    !!trade &&
    status === "Shipping" &&
    bothShipped &&
    (youAreProposer || youAreReceiver) &&
    !receivedMine;


  useEffect(() => {
    const t = localStorage.getItem("token");
    if (!t) { setMe(null); return; }
    fetch(`${AUTH_URL}/me`, { headers: { ...authHeader() } })
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  async function reload() {
    setErr("");
    try {
      const t = await tradeApi.get(tradeId);
      setTrade(t);

      // draftQty 初期化（取引の items をベースに）
      const init = {};
      (Array.isArray(t?.items) ? t.items : []).forEach((it) => {
        const k = `${it.side}:${Number(it.listing_id)}`;
        init[k] = Number(it.quantity);
      });
      setDraftQty(init);

      const p = Number(t?.proposer_id);
      const r = Number(t?.receiver_id);

      for (const uid of [p, r]) {
        if (Number.isFinite(uid) && uid > 0 && !users[uid]) {
          try {
            const u = await fetchJson(`${AUTH_URL}/users/${uid}`);
            setUsers((prev) => ({ ...prev, [uid]: u }));
          } catch {}
        }
      }

      const items = Array.isArray(t?.items) ? t.items : [];
      const needListingIds = Array.from(
        new Set(items.map((x) => Number(x?.listing_id)).filter((x) => Number.isFinite(x) && x > 0))
      );
      for (const lid of needListingIds) {
        if (!listings[lid]) {
          try {
            const li = await fetchJson(`${LISTING_URL}/listings/${lid}`);
            setListings((prev) => ({ ...prev, [lid]: li }));
          } catch {}
        }
      }

      if (t && t.status !== "Rejected") {
        const ms = await tradeApi.messages(tradeId);
        setMessages(Array.isArray(ms) ? ms : []);
      } else {
        setMessages([]);
      }
    } catch (e) {
      setErr(String(e?.message || e));
    }
  }

  useEffect(() => {
    if (Number.isFinite(tradeId) && tradeId > 0) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeId, myId]);

  const view = useMemo(() => {
    const items = Array.isArray(trade?.items) ? trade.items : [];
    const proposerGive = items.filter((x) => x.side === "give");
    const proposerTake = items.filter((x) => x.side === "take");

    // 左: 受け手が出す = proposerTake
    // 右: 提案者が出す = proposerGive
    function enrich(side, it) {
      const lid = Number(it?.listing_id);
      const li = listings[lid];
      const k = `${side}:${lid}`;
      return {
        side,
        listing_id: lid,
        name: li?.fruit_name || li?.title || "",
        image_url: li?.image_url || "",
        status: li?.status || "",
        stock_now: Number(li?.quantity ?? 0),
        trade_qty: Number(draftQty[k] ?? it?.quantity ?? 0),
      };
    }

    return {
      left: proposerTake.map((it) => enrich("take", it)),
      right: proposerGive.map((it) => enrich("give", it)),
    };
  }, [trade, listings, draftQty]);

  function setQty(side, listing_id, qty) {
    if (!Number.isInteger(qty) || qty <= 0) return;
    const k = `${side}:${Number(listing_id)}`;
    setDraftQty((prev) => ({ ...prev, [k]: qty }));
  }

  async function saveItems() {
    setErr("");
    try {
      const items = Array.isArray(trade?.items) ? trade.items : [];
      const give_items = items
        .filter((x) => x.side === "give")
        .map((x) => {
          const lid = Number(x.listing_id);
          const k = `give:${lid}`;
          return { listing_id: lid, quantity: Number(draftQty[k] ?? x.quantity) };
        });

      const take_items = items
        .filter((x) => x.side === "take")
        .map((x) => {
          const lid = Number(x.listing_id);
          const k = `take:${lid}`;
          return { listing_id: lid, quantity: Number(draftQty[k] ?? x.quantity) };
        });

      await tradeApi.updateItems(tradeId, give_items, take_items);
      await reload();
    } catch (e) {
      setErr(String(e?.message || e));
    }
  }

  async function accept() {
    setErr("");
    try { await tradeApi.accept(tradeId); await reload(); }
    catch (e) { setErr(String(e?.message || e)); }
  }

  async function reject() {
    setErr("");
    try { await tradeApi.reject(tradeId); await reload(); }
    catch (e) { setErr(String(e?.message || e)); }
  }
  async function ship() {
  setErr("");
  try { await tradeApi.ship(tradeId); await reload(); }
  catch (e) { setErr(String(e?.message || e)); }
}

  async function markReceived() {
    setErr("");
    try { await tradeApi.received(tradeId); await reload(); }
    catch (e) { setErr(String(e?.message || e)); }
  }

  async function send() {
    const v = content.trim();
    if (!v) return;
    setErr("");
    try {
      await tradeApi.postMessage(tradeId, v);
      setContent("");
      await reload();
    } catch (e) {
      setErr(String(e?.message || e));
    }
  }

  const proposerEmail = proposerId ? users[proposerId]?.email : "";
  const receiverEmail = receiverId ? users[receiverId]?.email : "";

  return (
    <div style={{ padding: 16, maxWidth: 1100 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/trades">← 取引一覧へ</Link>
      </div>

      <h2>取引詳細 id={tradeId}</h2>
      {err ? <pre style={{ whiteSpace: "pre-wrap", color: "#b00020" }}>{err}</pre> : null}

      {trade ? (
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginTop: 10 }}>
          <div>状態: {statusJa(status)}</div>

          <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
              <div style={{ fontWeight: 800 }}>受け手</div>
              <div style={{ marginTop: 4 }}>
                {receiverEmail ? receiverEmail : `ID:${receiverId}`}
                {youAreReceiver ? <BadgeYou /> : null}
              </div>
            </div>

            <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
              <div style={{ fontWeight: 800 }}>提案者</div>
              <div style={{ marginTop: 4 }}>
                {proposerEmail ? proposerEmail : `ID:${proposerId}`}
                {youAreProposer ? <BadgeYou /> : null}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 8 }}>提案メッセージ: {trade.proposal_message || ""}</div>

          <div style={{ marginTop: 10 }}>
            <button onClick={reload}>更新</button>

            {canDecide ? (
              <>
                <button onClick={accept} style={{ marginLeft: 8 }}>承諾</button>
                <button onClick={reject} style={{ marginLeft: 6 }}>却下</button>
              </>
            ) : null}

            {canEditItems ? (
              <button onClick={saveItems} style={{ marginLeft: 8 }}>数量を変更</button>
            ) : null}

            {canShip ? (
              <button onClick={ship} style={{ marginLeft: 8 }}>発送した</button>
            ) : null}

            {canReceived ? (
              <button onClick={markReceived} style={{ marginLeft: 8 }}>受取確認</button>
            ) : null}

          </div>
        </div>
      ) : (
        <div>読み込み中...</div>
      )}

      {trade ? (
        <div style={{ display: "flex", gap: 12, marginTop: 14, alignItems: "flex-start" }}>
          <ItemsTable
            title="受け手の出品"
            isYou={youAreReceiver}
            rows={view.left}
            editable={canEditItems}
            onChangeQty={setQty}
          />
          <ItemsTable
            title="提案者の出品"
            isYou={youAreProposer}
            rows={view.right}
            editable={canEditItems}
            onChangeQty={setQty}
          />
        </div>
      ) : null}

      <div style={{ marginTop: 16, border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
        <div style={{ fontWeight: 800 }}>コメント</div>

        {!canChat ? (
          <div style={{ marginTop: 8, opacity: 0.8 }}>この状態では使えません</div>
        ) : (
          <>
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <input
                style={{ flex: 1, padding: 8 }}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="メッセージ"
              />
              <button onClick={send} disabled={!content.trim()}>送信</button>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {messages.length === 0 ? (
                <div style={{ opacity: 0.8 }}>メッセージなし</div>
              ) : (
                messages.map((m) => {
                  const mine = myId > 0 && Number(m.sender_id) === myId;
                  const mail = users[m.sender_id]?.email || `ID:${m.sender_id}`;
                  return (
                    <div
                      key={m.id}
                      style={{
                        justifySelf: mine ? "end" : "start",
                        maxWidth: 700,
                        border: "1px solid #ddd",
                        borderRadius: 10,
                        padding: 10,
                        background: mine ? "#f6f6ff" : "#fff",
                      }}
                    >
                      <div style={{ fontSize: 12, opacity: 0.75 }}>{mail}</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
