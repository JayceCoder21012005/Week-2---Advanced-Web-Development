import {
  getJson, toUserView, toOrderView, toMobileOrderView, productError,
  DASHBOARD_QUERY, MOBILE_ORDERS_QUERY, PRODUCT_TIMEOUT_MS,
} from '../shared/contract.js';

/**
 * 3 cách lấy cùng một view-model, cho 2 loại client.
 *   web:    baseline(userId), bff(userId), graphql(userId)                → { user, errors }
 *   mobile: mobile.baseline(userId), mobile.bff(userId), mobile.graphql(userId) → { orders, errors }
 * services: URL 3 service; gateway: '' (browser) hoặc URL gateway (Node).
 */
export function createFetchers({ services, gateway = '' }) {
  async function postGraphQL(query, userId) {
    const res = await fetch(`${gateway}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { userId } }),
    });
    const body = await res.json();
    // user null KÈM lỗi = User/Order sập, không phải "không tìm thấy" → báo lỗi như BFF.
    if (!body.data?.user && body.errors?.length) throw new Error(body.errors[0].message);
    return { user: body.data?.user ?? null, errors: (body.errors ?? []).map(({ path, message }) => ({ path, message })) };
  }

  const web = {
    // Baseline: client tự gọi TUẦN TỰ 2 + N request rồi tự ghép.
    async baseline(userId) {
      const user = await getJson(`${services.user}/users/${userId}`);
      const orders = await getJson(`${services.order}/orders?userId=${userId}`);
      const views = [];
      const errors = [];
      for (const [i, o] of orders.entries()) {
        let product = null;
        try {
          product = await getJson(`${services.product}/products/${o.productId}`, { timeoutMs: PRODUCT_TIMEOUT_MS });
        } catch (e) {
          errors.push(productError(i, e.message));
        }
        views.push(toOrderView(o, product));
      }
      return { user: { ...toUserView(user), orders: views }, errors };
    },

    // BFF: 1 request, server đã ghép sẵn.
    bff: (userId) => getJson(`${gateway}/bff/web/dashboard/${userId}`),

    // GraphQL: 1 request, client chọn field.
    graphql: (userId) => postGraphQL(DASHBOARD_QUERY, userId),
  };

  const mobile = {
    // Baseline: vẫn phải gọi đủ 2 + N request, nhận TOÀN BỘ object rồi tự cắt (over-fetching).
    async baseline(userId) {
      const { user, errors } = await web.baseline(userId);
      return { orders: user.orders.map((o) => toMobileOrderView(o, o.product)), errors };
    },

    // BFF: endpoint RIÊNG cho mobile.
    bff: (userId) => getJson(`${gateway}/bff/mobile/orders/${userId}`),

    // GraphQL: cùng endpoint, QUERY RIÊNG cho mobile.
    async graphql(userId) {
      const { user, errors } = await postGraphQL(MOBILE_ORDERS_QUERY, userId);
      return { orders: user?.orders ?? null, errors };
    },
  };

  return { ...web, mobile };
}
