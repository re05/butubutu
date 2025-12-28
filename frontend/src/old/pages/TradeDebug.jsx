import { useEffect, useState } from 'react';
import api from '../api';

export default function TradeDebug() {
  const [outbox, setOutbox] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [err, setErr] = useState('');

  const [receiverId, setReceiverId] = useState('2');
  const [giveListingId, setGiveListingId] = useState('1');
  const [giveQty, setGiveQty] = useState('1');
  const [takeListingId, setTakeListingId] = useState('3');
  const [takeQty, setTakeQty] = useState('1');
  const [msg, setMsg] = useState('交換しませんか');

  async function reload() {
    setErr('');
    try {
      const o = await api.trade.outbox();
      const i = await api.trade.inbox();
      setOutbox(o);
      setInbox(i);
    } catch (e) {
      setErr(String(e?.message || e));
    }
  }

  useEffect(() => { reload(); }, []);

  async function createTrade() {
    setErr('');
    try {
      const receiver_id = Number(receiverId);
      const give_items = [{ listing_id: Number(giveListingId), quantity: Number(giveQty) }];
      const take_items = [{ listing_id: Number(takeListingId), quantity: Number(takeQty) }];
      await api.trade.create(receiver_id, give_items, take_items, msg);
      await reload();
    } catch (e) {
      setErr(String(e?.message || e));
    }
  }

  async function accept(tradeId) {
    setErr('');
    try {
      await api.trade.accept(tradeId);
      await reload();
    } catch (e) {
      setErr(String(e?.message || e));
    }
  }

  async function reject(tradeId) {
    setErr('');
    try {
      await api.trade.reject(tradeId);
      await reload();
    } catch (e) {
      setErr(String(e?.message || e));
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 900 }}>
      <h2>Trade Debug</h2>
      <p>ログイン済み（tokenが保存済み）で使う。</p>
      {err && <pre style={{ whiteSpace:'pre-wrap' }}>{err}</pre>}

      <h3>提案作成</h3>
      <div style={{ display:'grid', gridTemplateColumns:'160px 1fr', gap: 8, alignItems:'center' }}>
        <div>receiver_id</div><input value={receiverId} onChange={e=>setReceiverId(e.target.value)} />
        <div>give listing_id</div><input value={giveListingId} onChange={e=>setGiveListingId(e.target.value)} />
        <div>give qty</div><input value={giveQty} onChange={e=>setGiveQty(e.target.value)} />
        <div>take listing_id</div><input value={takeListingId} onChange={e=>setTakeListingId(e.target.value)} />
        <div>take qty</div><input value={takeQty} onChange={e=>setTakeQty(e.target.value)} />
        <div>message</div><input value={msg} onChange={e=>setMsg(e.target.value)} />
      </div>
      <button onClick={createTrade} style={{ marginTop: 10 }}>提案作成</button>
      <button onClick={reload} style={{ marginLeft: 8 }}>再読込</button>

      <h3 style={{ marginTop: 20 }}>送信箱（outbox）</h3>
      <pre style={{ whiteSpace:'pre-wrap' }}>{JSON.stringify(outbox, null, 2)}</pre>

      <h3 style={{ marginTop: 20 }}>受信箱（inbox）</h3>
      <pre style={{ whiteSpace:'pre-wrap' }}>{JSON.stringify(inbox, null, 2)}</pre>

      <h3 style={{ marginTop: 20 }}>受信箱 操作</h3>
      <p>inbox の trade id を入れて承諾/却下する。</p>
      <InboxActions inbox={inbox} onAccept={accept} onReject={reject} />
    </div>
  );
}

function InboxActions({ inbox, onAccept, onReject }) {
  const [id, setId] = useState('');
  return (
    <div>
      <input value={id} onChange={e=>setId(e.target.value)} placeholder="trade id" />
      <button onClick={()=>onAccept(Number(id))} style={{ marginLeft: 8 }}>承諾</button>
      <button onClick={()=>onReject(Number(id))} style={{ marginLeft: 8 }}>却下</button>
      <div style={{ marginTop: 8, fontSize: 12 }}>
        <div>inbox ids: {inbox.map(x=>x.id).join(', ')}</div>
      </div>
    </div>
  );
}
