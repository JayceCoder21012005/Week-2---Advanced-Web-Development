# 00 — Plan: API Composition (Baseline REST vs BFF vs GraphQL)

> Viết **trước** khi hiện thực BFF và GraphQL (yêu cầu nộp của đề). Mọi quyết định dưới đây đã chốt với agent.
> Ngày chốt: 2026-10-08.

## 1. Bài toán

Dashboard web hiển thị **tên người dùng + danh sách đơn, mỗi đơn kèm tên product**. Dữ liệu nằm ở 3 service độc lập (User, Order, Product), mỗi service một "CSDL" riêng (file JSON riêng). Câu hỏi: ghép dữ liệu ở đâu — browser (baseline), BFF, hay GraphQL — và chi phí (số request, số call nội bộ, số DB query, thời gian, payload) thay đổi thế nào khi số đơn tăng.

**Phạm vi:** chỉ client **web**. Không làm client/endpoint mobile (quyết định của nhóm).

## 2. Kiến trúc

```
                    ┌──────────── gateway :4000 ─────────────┐
browser ── static ──┤  /            → web/dashboard.html      │
 (Playwright)       │  GET /bff/web/dashboard/:userId  (BFF)  │──┐
                    │  POST /graphql                (GraphQL) │  │ fetch + x-request-id
                    └─────────────────────────────────────────┘  │
     │ baseline: browser gọi thẳng (CORS)                        ▼
     └──────────────→ user-service :4001   (data/<ds>/users.json)
                      order-service :4002  (data/<ds>/orders.json)
                      product-service :4003 (data/<ds>/products.json)
```

- BFF và GraphQL chạy **chung một process gateway** → cùng chi phí hạ tầng, so sánh công bằng.
- Mỗi service chỉ đọc file JSON của mình (database-per-service). File được nạp vào RAM lúc khởi động; mọi truy cập đi qua lớp **repository** (nơi đếm DB query).

## 3. Công nghệ (dùng thư viện có sẵn)

| Việc | Thư viện | Lý do |
|---|---|---|
| HTTP server | `express` | Phổ biến, ít code |
| CORS cho baseline | `cors` | Browser gọi thẳng service khác origin |
| GraphQL server | `graphql-yoga` + `graphql` | Nhẹ, có GraphiQL để demo |
| Sửa N+1 | `dataloader` | Chuẩn de-facto: batching + dedup per-request |
| Chạy nhiều process | `concurrently` | 1 lệnh `npm start` |
| Đo trên browser thật | `playwright` (Chromium) | Tự động lạnh/ấm, Resource Timing |
| HTTP client nội bộ | `fetch` có sẵn của Node 26 | Không cần axios |

Ngôn ngữ: JavaScript ESM, 1 `package.json` ở gốc.

## 4. Dữ liệu

- `scripts/seed.js` sinh dữ liệu giả với seed cố định (tái lập được) vào `data/small/` và `data/large/`.
- **small:** 1 user `u1`, 5 đơn, 3 product → product lặp giữa các đơn.
- **large:** 1 user `u1`, 200 đơn, 20 product → product lặp nhiều.
- Chọn bộ dữ liệu bằng `DATASET=small|large` (mọi service dùng cùng giá trị).

Schema:

```
User    { id, name, email }
Order   { id, userId, productId, qty, unitPrice, status, createdAt }
Product { id, name, price, thumbnail, category }
```

## 5. Contract từng service

| Service | Endpoint | Repo call (= 1 DB query) |
|---|---|---|
| User :4001 | `GET /users/:id` | `findById` |
| Order :4002 | `GET /orders?userId=` | `findByUser` |
| Product :4003 | `GET /products/:id` | `findById` |
| Product :4003 | `GET /products?ids=a,b,c` (batch) | `findByIds` — **1 query** dù nhiều id |

Lỗi chuẩn: `404 {error}`. Mọi service có thêm `GET /metrics`, `POST /metrics/reset`.

## 6. Ba biến thể — dùng chung tối đa, chỉ khác nơi ghép

- **1 trang** `web/dashboard.html?variant=baseline|bff|graphql&user=u1`.
- 3 hàm fetch trả **cùng 1 view-model** `{ user, orders: [{ ...order, product }], errors }` → **cùng 1 hàm `render()`**.

| Biến thể | Ai ghép | Request từ browser |
|---|---|---|
| Baseline | Browser: `GET /users/u1` → `GET /orders?userId=u1` → `GET /products/:id` **tuần tự cho từng đơn** | 2 + N |
| BFF | Gateway: user ∥ orders (song song) → 1 batch `GET /products?ids=` (đã dedup) | 1 |
| GraphQL | Gateway: query `Dashboard` → `user(id)`; resolver `Order.product` | 1 |

**GraphQL N+1 — một resolver, 2 chế độ** bằng `GQL_MODE`:
- `naive`: mỗi order gọi `GET /products/:id` → N call, N DB query (tái hiện N+1).
- `loader`: `DataLoader` tạo **mới cho mỗi request** (trong context), gom id trong 1 tick, dedup, gọi 1 lần `GET /products?ids=` → 1 call, 1 DB query, **không tăng theo số đơn**.

Query web:
```graphql
query Dashboard($userId: ID!) {
  user(id: $userId) { id name email
    orders { id qty unitPrice status createdAt
      product { id name price thumbnail } } }
}
```

## 7. Cách đếm (định nghĩa đo)

| Chỉ số | Định nghĩa | Đo ở đâu |
|---|---|---|
| Client request | Số request fetch/XHR browser gửi tới API (không tính file tĩnh) | Playwright `performance.getEntriesByType('resource')` |
| Service call | Số HTTP request **một service nhận** | Middleware đếm trong service → `/metrics` |
| DB query | Số lần gọi hàm repository | Counter trong repo → `/metrics` |
| Payload | Tổng `encodedBodySize`/`transferSize` các response API | Resource Timing |
| Màn hình hoàn tất | `performance.now()` lúc `render()` xong DOM (mark `done`), tính từ navigation start | Trang set `window.__done` |
| Trace | `x-request-id` gateway sinh và truyền xuống; mỗi service log `[rid] METHOD path` | stdout → `results/trace-*.log` |

**Chế độ chạy:**
- **Lạnh:** restart toàn bộ service → lần chạy đầu.
- **Ấm:** 5 lần tiếp theo (không restart).
- Mỗi tổ hợp `variant × dataset × gqlMode` → 1 lạnh + 5 ấm. Báo **median và min–max** của 5 lần ấm, lạnh báo riêng.
- Trước mỗi lần: `POST /metrics/reset` mọi service. Browser context mới mỗi lần (không cache HTTP).

**Sản phẩm đo:** `results/raw.csv` (từng lần chạy), `results/summary.md` (median/khoảng), `results/waterfall.html` (mọi tổ hợp, lần ấm median, vẽ từ Resource Timing, có vạch "done"), `results/trace-*.log` (trace N+1 trước/sau, call graph BFF), `results/verify.txt` (đối chiếu dữ liệu + lỗi).
- Browser đo: Chromium qua Playwright, mặc định `channel: 'msedge'` (Edge có sẵn trên Windows → không phải tải Chromium).

## 8. Policy lỗi — Partial + đánh dấu lỗi

- Product Service gây lỗi bằng `PRODUCT_FAULT=none|slow|error`, `PRODUCT_DELAY_MS` (mặc định 2000).
- BFF & GraphQL gọi product với **timeout 1000 ms** (`AbortSignal.timeout`).
- Khi lỗi/timeout: vẫn trả `200` với `user` + `orders`, mỗi đơn `product: null`, và `errors: [{ path, message }]`.
  - GraphQL: hành vi chuẩn (field nullable → `null` + `errors[]`).
  - BFF: tự tạo cùng hình dạng `errors[]`.
- **Không** thay tên/giá bằng giá trị giả. UI hiển thị "⚠ không tải được product".
- Baseline: browser tự bắt lỗi từng request product, hiển thị giống vậy.

## 9. Kiểm chứng (tiêu chí đạt)

`scripts/verify.js`:
1. Gọi 3 biến thể cho `u1` trên cả small/large → chuẩn hóa → `deepStrictEqual` → in PASS/FAIL.
2. `GQL_MODE=loader`: product-service `calls == 1` ở cả small (5 đơn) và large (200 đơn).
3. `GQL_MODE=naive`: product-service `calls == N` (bằng chứng N+1).

Số liệu nộp là kết quả chạy thật, kể cả chưa đạt.

## 10. Cấu trúc repo

```
src/
  package.json, README.md
  data/{small,large}/{users,orders,products}.json
  services/{user,order,product}/index.js
  shared/{metrics.js, service.js}      # middleware đếm, log, CORS, repo counter
  gateway/{index.js, clients.js, bff.js, graphql.js}
  web/{dashboard.html, app.js}
  scripts/{seed.js, verify.js, bench.js}
  results/                             # output đo
  docs/00-plan.md … 06-tradeoffs.md
```

## 11. Thứ tự hiện thực & tài liệu

| Bước | Việc | Tài liệu |
|---|---|---|
| 1 | Seed + 3 service + metrics | `01-baseline.md` |
| 2 | Trang web + baseline | `01-baseline.md` |
| 3 | BFF | `02-bff.md` (call graph nội bộ) |
| 4 | GraphQL naive → loader | `03-graphql-n+1.md` (trace trước/sau) |
| 5 | verify + bench Playwright | `04-measurement.md` |
| 6 | Lỗi Product | `05-fault.md` |
| 7 | Trade-off & giới hạn | `06-tradeoffs.md` |

## 12. Giới hạn đã biết

- Mọi thứ chạy localhost → độ trễ mạng gần 0; chênh lệch thực tế sẽ lớn hơn. Có thể thêm `NET_DELAY_MS` mô phỏng nếu cần.
- "DB" là JSON trong RAM → DB query rất rẻ; đếm số lượng quan trọng hơn thời gian.
- Không làm client mobile → không chứng minh được lợi ích "mỗi client một endpoint" của BFF.
