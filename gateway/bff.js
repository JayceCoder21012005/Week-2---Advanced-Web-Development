import { toUserView, toOrderView, productError } from '../shared/contract.js';

/**
 * BFF cho dashboard web:
 *   user ∥ orders (song song, không phụ thuộc nhau)
 *   → 1 batch GET /products?ids=… với id đã dedup
 *   → ghép thành view-model (chỉ field web cần).
 */
export async function composeDashboard(clients, userId) {
  const [user, orders] = await Promise.all([clients.getUser(userId), clients.getOrdersByUser(userId)]);
  const ids = [...new Set(orders.map((o) => o.productId))];

  let byId = new Map();
  let failure = null;
  if (ids.length) {
    try {
      byId = new Map((await clients.getProductsByIds(ids)).map((p) => [p.id, p]));
    } catch (e) {
      failure = e; // policy: partial + đánh dấu lỗi, không bịa dữ liệu
    }
  }
  return {
    user: { ...toUserView(user), orders: orders.map((o) => toOrderView(o, byId.get(o.productId))) },
    errors: failure ? orders.map((_, i) => productError(i, failure.message)) : [],
  };
}
