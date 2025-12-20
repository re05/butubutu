import React, { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '../api'

export default function Listings(){
  const { user } = useOutletContext();
  const [items,setItems]=useState([]);
  const load=()=> api.listings.list().then(setItems);
  useEffect(load,[]);
  const buy=async id=>{ try{ await api.orders.buy(id); }catch(e){ alert('購入不可'); } finally{ load(); } };
  const del=async id=>{ await api.listings.del(id); load(); };
  return (
    <div>
      <h3>出品一覧</h3>
      {items.map(x=> (
        <div key={x.id} style={{display:'flex', gap:8, alignItems:'center'}}>
          <span>#{x.id} {x.title} ¥{x.price} [{x.status}]</span>
          {x.seller_id===user.uid ? (
            x.status==='Active' && <button onClick={()=>del(x.id)}>削除</button>
          ) : (
            x.status==='Active' && <button onClick={()=>buy(x.id)}>購入</button>
          )}
        </div>
      ))}
    </div>
  )
}
