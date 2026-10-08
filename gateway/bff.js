import { toUserView, toOrderView, toMobileOrderView, productError, httpError } from '../shared/contract.js';

/**
 * Phần chung của mọi BFF endpoint:
 *   user ∥ orders (song song, không phụ thuộc nhau)
 *   → 1 batch GET /products?ids=… với id đã dedup.
 * Mỗi endpoint (web, mobile) chỉ khác ở bước cắt field cuối cùng.
 */
async function loadOrdersWithProducts(clients, userId) {
  // Lấy user + orders song song
  const [user, orders] = await Promise.all([clients.getUser(userId), clients.getOrdersByUser(userId)]);
  //dedup productId để batch call /products?ids=…
  const ids = [...new Set(orders.map((o) => o.productId))];

  let byId = new Map();
  let failure = null;
  // Nếu có productId → batch call /products?ids=…
  if (ids.length) {
    try {
      byId = new Map((await clients.getProductsByIds(ids)).map((p) => [p.id, p]));
    } catch (e) {
      failure = e; // policy: partial + đánh dấu lỗi, không bịa dữ liệu
    }
  }
  // Lỗi theo từng đơn: cả batch hỏng, hoặc id không có trong kết quả (giống 404 của baseline).
  const errors = orders.flatMap((o, i) => {
    if (failure) return [productError(i, failure.message)];
    if (!byId.has(o.productId)) return [productError(i, httpError(`/products/${o.productId}`, 404).message)];
    return [];
  });
  return { user, orders, productOf: (o) => byId.get(o.productId), errors };
}

/** GET /bff/web/dashboard/:userId — đủ field cho dashboard web. */
export async function composeDashboard(clients, userId) {
  const { user, orders, productOf, errors } = await loadOrdersWithProducts(clients, userId);
  return {
    user: { ...toUserView(user), orders: orders.map((o) => toOrderView(o, productOf(o))) },
    errors,
  };
}

/** GET /bff/mobile/orders/:userId — chỉ mã đơn, trạng thái, tên product, thumbnail. */
export async function composeMobileOrders(clients, userId) {
  const { orders, productOf, errors } = await loadOrdersWithProducts(clients, userId);
  return { orders: orders.map((o) => toMobileOrderView(o, productOf(o))), errors };
}
