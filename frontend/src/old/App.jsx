import React, { useEffect, useState } from 'react'
import { Link, Outlet, useNavigate } from 'react-router-dom'
import { me } from './api'
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import OrderDetail from './pages/OrderDetail';

export default function App() {
  const [user, setUser] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    me().then(u => {
      if (!u) { 
        nav('/login'); 
        return; 
      }
      setUser(u);
    });
  }, []);

  if (!user) return <div>読み込み中...</div>;

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: '0 auto', fontFamily: 'system-ui' }}>
      <nav style={{ display: 'flex', gap: 16, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <Link to="/">マイページ</Link>
        <Link to="/listings">出品一覧</Link>
        <Link to="/sell">出品</Link>
        {user.role === 'admin' && <Link to="/admin">管理</Link>}
        <span style={{ marginLeft: 'auto', fontSize: 14, color: '#555' }}>
          {user.email}（{user.role === 'admin' ? '管理者' : 'ユーザー'}）
        </span>
      </nav>
      <div style={{ background: '#fafafa', padding: 16, borderRadius: 8, boxShadow: '0 0 6px rgba(0,0,0,0.1)' }}>
        <Outlet context={{ user }} />
      </div>
    </div>
  );
}


function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 既存ルート */}
        {/* <Route path="/" element={<ListingList />} /> */}
        {/* <Route path="/listings/:id" element={<ListingDetail />} /> */}

        <Route path="/orders/:id" element={<OrderDetail />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;