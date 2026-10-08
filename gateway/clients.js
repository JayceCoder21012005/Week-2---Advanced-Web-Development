import { getJson, PRODUCT_TIMEOUT_MS } from '../shared/contract.js';
import { SERVICE_URLS } from '../shared/config.js';

/** Client gọi 3 service; mọi call mang x-request-id của request gốc để dựng trace. */
export function createClients(rid, urls = SERVICE_URLS) {
  const opts = { headers: { 'x-request-id': rid } };
  const productOpts = { ...opts, timeoutMs: PRODUCT_TIMEOUT_MS };
  const q = encodeURIComponent;
  return {
    getUser: (id) => getJson(`${urls.user}/users/${q(id)}`, opts),
    getOrdersByUser: (userId) => getJson(`${urls.order}/orders?userId=${q(userId)}`, opts),
    getProduct: (id) => getJson(`${urls.product}/products/${q(id)}`, productOpts),
    getProductsByIds: (ids) => getJson(`${urls.product}/products?ids=${ids.map(q).join(',')}`, productOpts),
  };
}
