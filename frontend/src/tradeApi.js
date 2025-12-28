const TRADE_BASE =
  import.meta.env.VITE_TRADE_URL ||
  import.meta.env.VITE_ORDER_URL ||
  "http://localhost:4120";

function getToken() {
  return localStorage.getItem("token") || "";
}

async function request(path, { method = "GET", body } = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;

  const res = await fetch(`${TRADE_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg = typeof data === "string" ? data : (data?.error || `http_${res.status}`);
    const e = new Error(msg);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

export const tradeApi = {
  base: TRADE_BASE,
  create: (receiver_id, give_items, take_items, proposal_message = "") =>
    request("/trades", { method: "POST", body: { receiver_id, give_items, take_items, proposal_message } }),
  outbox: () => request("/trades/me/outbox"),
  inbox: () => request("/trades/me/inbox"),
  get: (id) => request(`/trades/${id}`),
  accept: (id) => request(`/trades/${id}/accept`, { method: "PATCH" }),
  reject: (id) => request(`/trades/${id}/reject`, { method: "PATCH" }),
  ship: (id) => request(`/trades/${id}/ship`, { method: "PATCH" }),
  received: (id) => request(`/trades/${id}/received`, { method: "PATCH" }),
  messages: (id) => request(`/trades/${id}/messages`),
  postMessage: (id, content) => request(`/trades/${id}/messages`, { method: "POST", body: { content } }),
};
