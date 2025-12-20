import React, { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '../api'

export default function MyPage(){
  const { user } = useOutletContext();
  const [mine,setMine]=useState([]);
  const [orders,setOrders]=useState([]);
  useEffect(()=>{ api.listings.mine().then(setMine); api.orders.mine().then(setOrders); },[]);
  return (
    <div>
      <h3>自分の出品</h3>
      {mine.map(l=> <div key={l.id}>#{l.id} {l.title} ¥{l.price} [{l.status}]</div>)}
      <h3 style={{ marginTop: 16 }}>自分の購入履歴</h3>
      {orders.map(o => (
          <div key={o.id}>
            <Link to={`/orders/${o.id}`}>
              order#{o.id} listing:{o.listing_id}
            </Link>
          </div>
))}

    </div>
  )
}
