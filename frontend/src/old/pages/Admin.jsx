import React from 'react'
import { useOutletContext, Navigate } from 'react-router-dom'

export default function Admin(){
  const { user } = useOutletContext()
  if(!user) return null
  if(user.role !== 'admin') return <Navigate to="/" replace />
  // ここに管理画面の中身
  return <div><h2>管理</h2></div>
}
