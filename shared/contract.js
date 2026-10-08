// Dùng chung cho browser (baseline) và Node (gateway, scripts). Không import gì.

export const PRODUCT_TIMEOUT_MS = 1000;

export const toUserView = (u) => ({ id: u.id, name: u.name, email: u.email });
export const toProductView = (p) => (p ? { id: p.id, name: p.name, price: p.price, thumbnail: p.thumbnail } : null);
export const toOrderView = (o, p) => ({
  id: o.id, qty: o.qty, unitPrice: o.unitPrice, status: o.status, createdAt: o.createdAt, product: toProductView(p),
});
/** Mobile chỉ cần: mã đơn, trạng thái, tên product, thumbnail. */
export const toMobileOrderView = (o, p) => ({
  id: o.id, status: o.status, product: p ? { name: p.name, thumbnail: p.thumbnail } : null,
});
/** Cùng hình dạng với lỗi GraphQL: path tới field product của đơn thứ i. */
export const productError = (index, message) => ({ path: ['user', 'orders', index, 'product'], message });

const pathOf = (url) => url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
export function httpError(url, status) {
  const e = new Error(`${pathOf(url)} → HTTP ${status}`);
  e.status = status;
  return e;
}
export function timeoutError(url, ms) {
  const e = new Error(`${pathOf(url)} timeout after ${ms}ms`);
  e.status = 504;
  return e;
}

/** GET JSON; lỗi luôn là httpError/timeoutError để mọi biến thể có cùng thông điệp. */
export async function getJson(url, { headers, timeoutMs } = {}) {
  let res;
  try {
    res = await fetch(url, { headers, signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined });
  } catch (e) {
    if (e.name === 'TimeoutError') throw timeoutError(url, timeoutMs);
    throw e;
  }
  if (!res.ok) throw httpError(url, res.status);
  return res.json();
}

export const DASHBOARD_QUERY = `query Dashboard($userId: ID!) {
  user(id: $userId) {
    id name email
    orders { id qty unitPrice status createdAt product { id name price thumbnail } }
  }
}`;

/** Cùng schema, cùng endpoint — client mobile chỉ chọn field nó cần. */
export const MOBILE_ORDERS_QUERY = `query MobileOrders($userId: ID!) {
  user(id: $userId) {
    orders { id status product { name thumbnail } }
  }
}`;
