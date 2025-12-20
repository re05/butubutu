// frontend/src/pages/OrderDetail.jsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const AUTH_BASE  = import.meta.env.VITE_AUTH_BASE  || 'http://localhost:4000';
const ORDER_BASE = import.meta.env.VITE_ORDER_BASE || 'http://localhost:4020';

function token() {
  return localStorage.getItem('jwt') || '';
}

export default function OrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError('');

        // 自分の情報
        const meRes = await fetch(`${AUTH_BASE}/me`, {
          headers: { Authorization: `Bearer ${token()}` },
        });
        if (meRes.ok) {
          const meJson = await meRes.json();
          setMe(meJson);
        } else {
          setMe(null);
        }

        // 取引詳細
        const orderRes = await fetch(`${ORDER_BASE}/orders/${id}`, {
          headers: { Authorization: `Bearer ${token()}` },
        });
        if (!orderRes.ok) {
          throw new Error('failed to fetch order');
        }
        const orderJson = await orderRes.json();
        setOrder(orderJson);
      } catch (e) {
        console.error(e);
        setError('取引情報の取得に失敗しました');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id]);

  if (loading) return <div>読み込み中...</div>;
  if (error)   return <div>{error}</div>;
  if (!order)  return <div>取引が見つかりません</div>;

  const isSeller = me && me.id === order.seller_id;
  const isBuyer  = me && me.id === order.buyer_id;

  async function callAction(path) {
    try {
      const res = await fetch(`${ORDER_BASE}/orders/${order.id}/${path}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token()}`,
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error(err);
        alert('操作に失敗しました');
        return;
      }
      const updated = await res.json();
      setOrder(prev => ({ ...prev, ...updated }));
    } catch (e) {
      console.error(e);
      alert('通信エラーが発生しました');
    }
  }


  function fmt(dt) {
    if (!dt) return null;
    return new Date(dt).toLocaleString();
  }

  return (
    <div style={{ padding: '1rem' }}>
      <h1>取引詳細</h1>

      <div style={{ marginTop: '1rem' }}>
        {order.image_url && (
          <img
            src={order.image_url}
            alt={order.title}
            style={{ maxWidth: '200px', display: 'block', marginBottom: '1rem' }}
          />
        )}
        <p>商品名: {order.title}</p>
        <p>価格: {order.price} 円</p>
        <p>ステータス: {order.status}</p>
        {fmt(order.shipped_at)   && <p>発送日時: {fmt(order.shipped_at)}</p>}
        {fmt(order.delivered_at) && <p>到着報告日時: {fmt(order.delivered_at)}</p>}
        {fmt(order.confirmed_at) && <p>受取確定日時: {fmt(order.confirmed_at)}</p>}
      </div>

      <div style={{ marginTop: '1rem' }}>
        {isSeller && order.status === 'CREATED' && (
          <button onClick={() => callAction('ship')}>発送した</button>
        )}

        {isBuyer && order.status === 'SHIPPED' && (
          <button onClick={() => callAction('deliver')}>商品が到着した</button>
        )}

        {isBuyer && order.status === 'DELIVERED' && (
          <button onClick={() => callAction('complete')}>受取を確定する</button>
        )}
      </div>
    </div>
  );
}
