# 01 — Baseline: 3 service REST + browser tự ghép

> Phần **Problem** của bài trình bày. Mọi log/số liệu dưới đây là output chạy thật.

## 1. Bài toán

Dashboard web cần: **tên user + danh sách đơn, mỗi đơn kèm tên product**. Ba thứ này nằm ở **ba service khác nhau**, mỗi service sở hữu dữ liệu riêng (database-per-service). Không service nào được đọc dữ liệu của service khác → *ai đó* phải ghép.

| Service | Cổng | "CSDL" | Endpoint | Repo call (= 1 DB query) |
|---|---|---|---|---|
| User | 4001 | `data/<ds>/users.json` | `GET /users/:id` | `findById` |
| Order | 4002 | `data/<ds>/orders.json` | `GET /orders?userId=` | `findByUser` |
| Product | 4003 | `data/<ds>/products.json` | `GET /products/:id` | `findById` |
| Product | 4003 | | `GET /products?ids=a,b,c` (batch) | `findByIds` — 1 query cho cả lô |

Mọi service có thêm `GET /metrics` (`{ service, calls, dbQueries }`) và `POST /metrics/reset`.

Schema:

```
User    { id, name, email }
Order   { id, userId, productId, qty, unitPrice, status, createdAt }
Product { id, name, price, thumbnail, category }
```

### Dữ liệu mẫu

`npm run seed` (`scripts/seed.js`) sinh dữ liệu giả **tái lập được** (PRNG seed = 42):

| Bộ | Đơn của `u1` | Product | Ghi chú |
|---|---|---|---|
| `small` | 5 | 3 | productId của u1: `p1,p2,p3,p2,p1` → p1, p2 lặp |
| `large` | 200 | 20 | mỗi product lặp ~10 lần |

`u2` có thêm 3 đơn để chứng minh Order Service lọc đúng theo user. Chọn bộ bằng biến môi trường `DATASET=small|large`.

## 2. Database-per-service và cách đếm DB query

Mỗi service nạp file JSON **của riêng nó** vào RAM lúc khởi động. Mọi truy cập dữ liệu đi qua một "repository", và mỗi hàm repository được bọc bởi `db()` để đếm (`shared/service.js`):

```js
/** Bọc hàm repository: mỗi lần gọi = 1 DB query. */
const db = (fn) => (...args) => { metrics.dbQueries++; return fn(...args); };
```

```js
// services/product/index.js
const repo = {
  findById:  db((id)  => products.get(id)),
  findByIds: db((ids) => ids.map((id) => products.get(id)).filter(Boolean)), // 1 query cho cả lô
};
```

**Service call** được đếm bằng middleware: mỗi HTTP request service nhận được thì `calls++`. `/metrics` và `/metrics/reset` được khai báo **trước** middleware này nên không bị đếm (đã có test).

Mỗi request còn được log một dòng trace: `giờ [x-request-id] service METHOD url`. Request từ browser không có id nên hiện là `browser`.

## 3. Baseline: browser tự gọi và tự ghép

`web/fetchers.js`:

```js
async baseline(userId) {
  const user = await getJson(`${services.user}/users/${userId}`);
  const orders = await getJson(`${services.order}/orders?userId=${userId}`);
  for (const [i, o] of orders.entries()) {
    product = await getJson(`${services.product}/products/${o.productId}`, { timeoutMs: PRODUCT_TIMEOUT_MS });
    ...
  }
}
```

- **2 + N request, tuần tự**: user → orders → product của từng đơn. Thời gian màn hình ≈ tổng độ trễ của từng request.
- **N+1 ở phía client**: 1 request lấy danh sách đơn, rồi N request lấy product.
- **Không dedup**: product lặp thì gọi lại.
- Browser phải biết địa chỉ của cả 3 service, nên các service phải bật **CORS**.

Ba biến thể (baseline, BFF, GraphQL) đều trả về **cùng một view-model** (`shared/contract.js`) và dùng **cùng một hàm `render()`** (`web/app.js`). Nhờ vậy khác biệt đo được chỉ đến từ *nơi ghép dữ liệu*:

```js
{ user: { id, name, email, orders: [{ id, qty, unitPrice, status, createdAt, product: { id, name, price, thumbnail } | null }] }, errors: [] }
```

Mốc **"màn hình hoàn tất"** được lấy sau khi `render()` xong: `performance.mark('done'); window.__done = performance.now()`, tính bằng ms kể từ navigation start.

## 4. Evidence (chạy thật, dữ liệu small)

`npm start` rồi `npm run smoke -- baseline`:

```
baseline | Nguyễn Văn An — 5 đơn | variant=baseline · màn hình hoàn tất sau 246 ms | rows=5 |
```

Log của các service (thứ tự thời gian):

```
02:22:30.382 [browser] user GET /users/u1
02:22:30.440 [browser] order GET /orders?userId=u1
02:22:30.455 [browser] product GET /products/p1
02:22:30.465 [browser] product GET /products/p2
02:22:30.470 [browser] product GET /products/p3
02:22:30.475 [browser] product GET /products/p2   ← lặp
02:22:30.479 [browser] product GET /products/p1   ← lặp
```

→ **7 request từ browser** cho 5 đơn. Các request chạy nối đuôi nhau, và p1, p2 bị tải 2 lần. Với bộ large (200 đơn) sẽ là **202 request**. Số liệu đo đầy đủ nằm ở `04-measurement.md`.
