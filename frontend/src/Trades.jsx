import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { tradeApi } from "./tradeApi";

function statusJa(s) {
  const v = String(s || "");
  if (v === "Proposed") return "提案中";
  if (v === "Accepted") return "承諾済み";
  if (v === "Shipping") return "発送中";
  if (v === "Completed") return "完了";
  if (v === "Rejected") return "却下";
  return v || "-";
}


export default function Trades() {
  const [outbox, setOutbox] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [err, setErr] = useState("");

async function reload() {
  setErr("");
  try {
    const [o, i] = await Promise.all([tradeApi.outbox(), tradeApi.inbox()]);

    const normalize = (xs) =>
      (Array.isArray(xs) ? xs : []).filter((t) => String(t?.status) !== "Completed");

    setOutbox(normalize(o));
    setInbox(normalize(i));
  } catch (e) {
    setErr(String(e?.message || e));
  }
}


  async function reject(id) {
    setErr("");
    try {
      await tradeApi.reject(id);
      await reload();
    } catch (e) {
      setErr(String(e?.message || e));
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 16, maxWidth: 1100 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/">マイページ</Link>
        <span style={{ marginLeft: 10 }} />
        <Link to="/listings">出品一覧</Link>
      </div>

      <h2>取引（提案）</h2>
      <div style={{ fontSize: 12, opacity: 0.7 }}>API: {tradeApi.base}</div>
      {err ? <pre style={{ whiteSpace: "pre-wrap" }}>{err}</pre> : null}

      <div style={{ marginTop: 12 }}>
        <Link to="/trades/new">提案を作る</Link>
        <button onClick={reload} style={{ marginLeft: 10 }}>再読み込み</button>
      </div>

      <h3 style={{ marginTop: 20 }}>受信箱（inbox）</h3>
      <TradeTable
        rows={inbox}
        actions={(t) => {
          const canDecide = t.status === "Proposed"; // 提案中だけ操作できる
          if (!canDecide) return <span style={{ opacity: 0.6 }}>-</span>;

          return (
            <>
              <button onClick={() => accept(t.id)}>承諾</button>
              <button onClick={() => reject(t.id)} style={{ marginLeft: 6 }}>却下</button>
            </>
          );
        }}
      />

      <h3 style={{ marginTop: 20 }}>送信箱（outbox）</h3>
      <TradeTable rows={outbox} actions={null} />
    </div>
  );
}

function TradeTable({ rows, actions }) {
  if (!Array.isArray(rows) || rows.length === 0) return <div style={{ marginTop: 8 }}>なし</div>;

  return (
    <table border="1" cellPadding="6" style={{ borderCollapse: "collapse", width: "100%", marginTop: 8 }}>
      <thead>
        <tr>
          <th>id</th>
          <th>status</th>
          <th>proposer_id</th>
          <th>receiver_id</th>
          <th>詳細</th>
          {actions ? <th>操作</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id}>
            <td>{t.id}</td>
            <td>{statusJa(t.status)}</td>
            <td>{t.proposer_id}</td>
            <td>{t.receiver_id}</td>
            <td><Link to={`/trades/${t.id}`}>開く</Link></td>
            {actions ? <td>{actions(t)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
