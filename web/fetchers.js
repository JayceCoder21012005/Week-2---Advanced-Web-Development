import { getJson, toUserView, toOrderView, productError, DASHBOARD_QUERY, PRODUCT_TIMEOUT_MS } from '../shared/contract.js';

/** 3 cách lấy cùng một view-model. services: URL 3 service; gateway: '' (browser) hoặc URL gateway (Node). */
export function createFetchers({ services, gateway = '' }) {
  return {
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
    async graphql(userId) {
      const res = await fetch(`${gateway}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: DASHBOARD_QUERY, variables: { userId } }),
      });
      const body = await res.json();
      // user null KÈM lỗi = User/Order sập, không phải "không tìm thấy" → báo lỗi như BFF.
      if (!body.data?.user && body.errors?.length) throw new Error(body.errors[0].message);
      return { user: body.data?.user ?? null, errors: (body.errors ?? []).map(({ path, message }) => ({ path, message })) };
    },
  };
}
