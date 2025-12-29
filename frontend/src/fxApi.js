const FX_BASE = import.meta.env.VITE_FX_URL || "http://localhost:4130";

async function request(path) {
  const res = await fetch(`${FX_BASE}${path}`);
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const e = new Error(data?.error || "request_failed");
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

export const fxApi = {
  rate: (from, to) => request(`/fx/rate?from=${from}&to=${to}`),
};
