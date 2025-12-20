import React, { useState } from 'react';
import { api } from '../api';

export default function Sell() {
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [condition, setCondition] = useState('目立った傷や汚れなし');
  const [category, setCategory] = useState('ファッション');
  const [fashionGenre, setFashionGenre] = useState('');
  const [size, setSize] = useState('');

  const submit = async e => {
    e.preventDefault();
    const body = {
      title,
      price: Number(price),
      imageUrl,          // ここにはとりあえず文字列を入れる
      category,
      fashionGenre,
      size,
      condition,
    };
    const res = await api.listings.create(body);
    console.log('created', res);
    setTitle('');
    setPrice('');
    setImageUrl('');
    setFashionGenre('');
    setSize('');
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 8, width: 320 }}>
      <h3>新規出品</h3>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="タイトル" />
      <input value={price} onChange={e => setPrice(e.target.value)} type="number" placeholder="価格" />

      <input
        value={imageUrl}
        onChange={e => setImageUrl(e.target.value)}
        placeholder="画像URL（テスト用）"
      />

      <select value={condition} onChange={e => setCondition(e.target.value)}>
        <option value="目立った傷や汚れなし">目立った傷や汚れなし</option>
        <option value="やや傷や汚れあり">やや傷や汚れあり</option>
      </select>

      <select value={category} onChange={e => setCategory(e.target.value)}>
        <option value="ファッション">ファッション</option>
        <option value="その他">その他</option>
      </select>

      <input
        value={fashionGenre}
        onChange={e => setFashionGenre(e.target.value)}
        placeholder="ファッションジャンル"
      />

      <input value={size} onChange={e => setSize(e.target.value)} placeholder="サイズ" />

      <button>出品する</button>
    </form>
  );
}
