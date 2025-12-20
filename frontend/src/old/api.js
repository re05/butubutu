const AUTH = import.meta.env.VITE_AUTH_BASE || 'http://localhost:4000';
const LIST = import.meta.env.VITE_LISTING_BASE || 'http://localhost:4010';
const ORDER = import.meta.env.VITE_ORDER_BASE || 'http://localhost:4020';

export function token() { return localStorage.getItem('jwt') || ''; }
export function setToken(t) { localStorage.setItem('jwt', t); }
export async function me() {
  const r = await fetch(`${AUTH}/me`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) return null; return r.json();
}
export async function login(email, password) {
  const r = await fetch(`${AUTH}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password}) });
  if (!r.ok) throw new Error('login failed');
  const { token: t } = await r.json(); setToken(t); return t;
}
export const api = {
  listings: {
    list: (params={}) => {
      const q = new URLSearchParams(params).toString();
      return fetch(`${LIST}/listings${q?`?${q}`:''}`).then(r=>r.json());
    },
    mine: () => fetch(`${LIST}/listings/mine`, { headers:{ Authorization:`Bearer ${token()}` } }).then(r=>r.json()),
    create: (body) => fetch(`${LIST}/listings`, { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token()}`}, body:JSON.stringify(body) }).then(r=>r.json()),
    del: (id) => fetch(`${LIST}/listings/${id}`, { method:'DELETE', headers:{ Authorization:`Bearer ${token()}` } }),
    pause: (id) => fetch(`${LIST}/listings/${id}/pause`, { method:'PATCH', headers:{ Authorization:`Bearer ${token()}` } }).then(r=>r.json()),
    activate: (id) => fetch(`${LIST}/listings/${id}/activate`, { method:'PATCH', headers:{ Authorization:`Bearer ${token()}` } }).then(r=>r.json()),
  },
  orders: {
    buy: (listingId) => fetch(`${ORDER}/orders`, { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token()}`}, body:JSON.stringify({ listingId }) }).then(async r=>{ if(!r.ok) throw new Error(await r.text()); return r.json(); }),
    mine: () => fetch(`${ORDER}/orders/buyer/me`, { headers:{ Authorization:`Bearer ${token()}` } }).then(r=>r.json()),
  }
};
