import React, { useEffect, useMemo, useState } from "react";
import { fxApi } from "./fxApi.js";

const FRUITS = [
  { id: 1, name: "リンゴ" },
  { id: 2, name: "バナナ" },
  { id: 3, name: "オレンジ" },
  { id: 4, name: "ぶどう" },
  { id: 5, name: "いちご" },
];

export default function FxRates() {
  const [from, setFrom] = useState(1);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]); // {toId,toName,rate,n,err}
  const [err, setErr] = useState("");

  const fromName = useMemo(() => FRUITS.find((x) => x.id === from)?.name || "", [from]);
  const tos = useMemo(() => FRUITS.filter((x) => x.id !== from), [from]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setErr("");
      setRows([]);
      setLoading(true);

      try {
        const results = await Promise.all(
          tos.map(async (t) => {
            try {
              const r = await fxApi.rate(from, t.id);
              return {
                toId: t.id,
                toName: t.name,
                rate: Number(r.rate),
                n: Number(r.n || 0),
                err: "",
              };
            } catch (e) {
              const msg =
                e?.status === 404
                  ? "実績なし"
                  : `失敗（${e?.data?.error || e?.message || "error"}）`;
              return { toId: t.id, toName: t.name, rate: null, n: 0, err: msg };
            }
          })
        );

        if (cancelled) return;
        setRows(results);
      } catch (e) {
        if (cancelled) return;
        setErr("相場の取得に失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [from, tos]);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>相場</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>交換元</div>
          <select value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            {FRUITS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 16, fontSize: 12, opacity: 0.85 }}>
        Completed の実績だけを集計しています（中央値）。
      </div>

      <div style={{ marginTop: 12 }}>
        {loading ? (
          <div>取得中...</div>
        ) : err ? (
          <div style={{ color: "crimson" }}>{err}</div>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: "6px 4px" }}>交換先</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: "6px 4px" }}>相場</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #444", padding: "6px 4px" }}>実績</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.toId}>
                  <td style={{ padding: "6px 4px", borderBottom: "1px solid #333" }}>{r.toName}</td>
                  <td style={{ padding: "6px 4px", borderBottom: "1px solid #333" }}>
                    {r.err
                      ? <span style={{ color: "crimson" }}>{r.err}</span>
                      : `${r.rate.toFixed(3)}個`}
                  </td>
                  <td style={{ padding: "6px 4px", borderBottom: "1px solid #333", textAlign: "right" }}>
                    {r.err ? "-" : r.n}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
