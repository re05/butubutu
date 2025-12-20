import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../api'   // POST /login を呼ぶ関数

export default function Login(){
  const nav = useNavigate()
  const [email,setEmail] = useState('test@test.com')
  const [password,setPassword] = useState('pass')
  const [err,setErr] = useState('')

  async function onSubmit(e){
    e.preventDefault()
    setErr('')
    const ok = await login(email, password)   // 成功ならローカルストレージにJWT保存
    if(!ok){ setErr('ログインに失敗しました'); return }
    nav('/')                                   // 常にトップへ
  }

  return (
    <div style={{maxWidth:380, margin:'48px auto', fontFamily:'system-ui'}}>
      <h2>ログイン</h2>
      <form onSubmit={onSubmit}>
        <div style={{margin:'8px 0'}}>
          <label>メールアドレス</label><br/>
          <input style={{padding:'8px',width:'100%'}} value={email} onChange={e=>setEmail(e.target.value)} placeholder="メールアドレス"/>
        </div>
        <div style={{margin:'8px 0'}}>
          <label>パスワード</label><br/>
          <input style={{padding:'8px',width:'100%'}} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="パスワード"/>
        </div>
        <button style={{padding:'10px 16px', cursor:'pointer'}}>ログイン</button>
      </form>
      {err && <p style={{color:'crimson'}}>{err}</p>}
      <p style={{marginTop:8, fontSize:13, color:'#666'}}>デモ: test@test.com / pass</p>
    </div>
  )
}
