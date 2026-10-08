# 02 — BFF (Backend for Frontend)

> Phần **Solution 1** của bài trình bày.

## 1. BFF là gì

**Backend for Frontend** là một lớp server viết riêng cho **một loại client**. Client gọi đúng **một endpoint**, BFF thay mặt client gọi các service nội bộ, ghép dữ liệu rồi trả về đúng hình dạng màn hình cần.

- Mỗi loại client có một endpoint riêng:
  - `GET /bff/web/dashboard/:userId` cho web.
  - `GET /bff/mobile/orders/:userId` cho mobile, xem `07-mobile.md`.

  Cả hai dùng chung phần lấy dữ liệu (`loadOrdersWithProducts`), chỉ khác bước cắt field ở cuối.
- Logic ghép chuyển từ browser (mạng chậm, không tin cậy) vào **mạng nội bộ** (nhanh, gần service).
- Browser không cần biết địa chỉ các service. Chỉ gateway mới gọi tới chúng.

## 2. Hiện thực

`gateway/bff.js`:

```js
export async function composeDashboard(clients, userId) {
  // (1) user và orders không phụ thuộc nhau → gọi SONG SONG
  const [user, orders] = await Promise.all([clients.getUser(userId), clients.getOrdersByUser(userId)]);
  // (2) dedup productId → 1 batch duy nhất
  const ids = [...new Set(orders.map((o) => o.productId))];
  let byId = new Map(), failure = null;
  if (ids.length) {
    try { byId = new Map((await clients.getProductsByIds(ids)).map((p) => [p.id, p])); }
    catch (e) { failure = e; } // policy lỗi: partial + đánh dấu lỗi
  }
  // (3) ghép thành view-model chung (chỉ field web hiển thị)
  return {
    user: { ...toUserView(user), orders: orders.map((o) => toOrderView(o, byId.get(o.productId))) },
    errors: failure ? orders.map((_, i) => productError(i, failure.message)) : [],
  };
}
```

`gateway/index.js`: route trả 404 nếu user không tồn tại, 502 nếu User/Order lỗi:

```js
app.get('/bff/web/dashboard/:userId', async (req, res) => {
  try { res.json(await composeDashboard(createClients(req.headers['x-request-id'], urls), req.params.userId)); }
  catch (e) { res.status(e.status === 404 ? 404 : 502).json({ error: e.message }); }
});
```

Ba kỹ thuật làm BFF nhanh hơn baseline:

| Kỹ thuật | Baseline | BFF |
|---|---|---|
| Gọi song song những gì độc lập | user → orders (nối tiếp) | user ∥ orders |
| Dedup | p1, p2 bị tải 2 lần | `new Set(productIds)` |
| Batch | N × `GET /products/:id` | 1 × `GET /products?ids=…` |

## 3. Call graph nội bộ

```
browser ──1 request──▶ gateway  GET /bff/web/dashboard/u1        [rid = gw-xxxx]
                         ├──▶ user-service    GET /users/u1        ┐ song song
                         ├──▶ order-service   GET /orders?userId=u1 ┘
                         └──▶ product-service GET /products?ids=p1,p2,p3   (1 batch, đã dedup)
```

Gateway sinh `x-request-id` và truyền xuống mọi service, nên có thể ghép log thành trace. **Log thật** (dữ liệu small):

```
02:23:49.609 [gw-5752fdc9] gateway GET /bff/web/dashboard/u1
02:23:49.674 [gw-5752fdc9] order   GET /orders?userId=u1
02:23:49.677 [gw-5752fdc9] user    GET /users/u1             ← cách order 3 ms: chạy song song
02:23:49.688 [gw-5752fdc9] product GET /products?ids=p1,p2,p3  ← 5 đơn, 3 id duy nhất, 1 call
```

So với baseline (cùng dữ liệu, `npm run smoke -- baseline bff`, một lần chạy, chưa phải số liệu đo chính thức):

```
baseline | Nguyễn Văn An — 5 đơn | variant=baseline · màn hình hoàn tất sau 496 ms | rows=5 |
bff      | Nguyễn Văn An — 5 đơn | variant=bff · màn hình hoàn tất sau 128 ms | rows=5 |
```

## 4. Kiểm thử

`tests/bff.test.js` (client giả) và `tests/gateway.test.js` (service thật, chạy trong cùng process):

- Product lặp (`p1,p2,p1`) → batch chỉ có `['p1','p2']`. BFF **không** gọi `getProduct` lẻ.
- Response chỉ chứa field cần hiển thị (không lộ `category` hay field thừa của user).
- User không có đơn → không gọi Product Service.
- 5 đơn → Product Service nhận **1 call, 1 DB query**.
- User không tồn tại → 404.
- Product chậm hơn timeout → trả partial trong khoảng 1 s (xem `05-fault.md`).

## 5. Đánh đổi (tóm tắt, chi tiết ở `06-tradeoffs.md`)

- Endpoint **gắn chặt với màn hình**: màn hình đổi thì BFF đổi. Mỗi client mới cần thêm endpoint.
- `GET` nên cache HTTP được, dễ đặt CDN.
- Thêm một hop mạng và một thành phần cần vận hành.
