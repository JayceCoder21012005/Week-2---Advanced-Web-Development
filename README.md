# API Composition: Baseline REST vs BFF vs GraphQL

Bài tập Web nâng cao, tuần 2, block 2. Hai loại client dùng chung dữ liệu: **dashboard web** (tên user, danh sách đơn đầy đủ field, tên product) và **app mobile** (chỉ mã đơn, trạng thái, tên product, thumbnail). Dữ liệu nằm ở 3 service (User, Order, Product), mỗi service một file JSON riêng. So sánh 3 cách ghép dữ liệu: **browser tự ghép (baseline)**, **BFF** và **GraphQL** (N+1 trước và sau khi sửa bằng DataLoader).

## Yêu cầu

- Node.js ≥ 24 (đã chạy trên Node 26)
- Microsoft Edge, dùng cho Playwright. Không cần `npx playwright install`. Muốn dùng Chrome thì đặt `$env:BROWSER_CHANNEL='chrome'`.

## Cài đặt và chạy

```powershell
npm install
npm run seed          # sinh data/small và data/large (đã có sẵn trong repo)
npm start             # user :4001, order :4002, product :4003, gateway :4000
```

- **Web:** <http://localhost:4000/>, bấm **Baseline (REST) / BFF / GraphQL**. Terminal in log trace của từng request.
- **Mobile:** <http://localhost:4000/mobile.html>, hoặc bấm "📱 Bản mobile" trên trang web. Nên mở chế độ thiết bị di động trong DevTools (F12 → Ctrl+Shift+M).
- **GraphiQL:**
<http://localhost:4000/graphql>. Thử query `Dashboard` và `MobileOrders` (chép từ `shared/contract.js`).

| Endpoint | Mô tả |
|---|---|
| `GET :4001/users/:id` | User Service |
| `GET :4002/orders?userId=` | Order Service |
| `GET :4003/products/:id`, `GET :4003/products?ids=a,b` | Product Service (lẻ và batch) |
| `GET :400x/metrics`, `POST :400x/metrics/reset` | Bộ đếm call và DB query của từng service |
| `GET :4000/bff/web/dashboard/:userId` | BFF cho dashboard web |
| `GET :4000/bff/mobile/orders/:userId` | BFF cho app mobile (chỉ `id`, `status`, `product.name`, `product.thumbnail`) |
| `POST :4000/graphql` | GraphQL, một endpoint cho cả hai client: query `Dashboard` (web) và `MobileOrders` (mobile) trong `shared/contract.js` |

## Biến môi trường (PowerShell)

| Biến | Giá trị | Ý nghĩa |
|---|---|---|
| `DATASET` | `small` (mặc định) / `large` | 5 hoặc 200 đơn của `u1` |
| `GQL_MODE` | `loader` (mặc định) / `naive` | GraphQL có hoặc không có DataLoader |
| `PRODUCT_FAULT` | `none` / `error` / `slow` | Gây lỗi cho Product Service |
| `PRODUCT_DELAY_MS` | `2000` | Độ trễ của chế độ `slow` (timeout của gateway là 1000 ms) |
| `QUIET` | `1` | Tắt log request |
| `RUNS` | `6` | Số lần chạy mỗi tổ hợp khi bench (1 lạnh + phần còn lại ấm) |
| `BROWSER_CHANNEL` | `msedge` | Trình duyệt Playwright dùng |

```powershell
$env:GQL_MODE='naive'; npm start
Remove-Item Env:GQL_MODE
```

## Kiểm thử, đối chiếu và đo

```powershell
npm test          # unit + integration (node:test)
npm run smoke     # mở trang thật: web + mobile × 3 biến thể (cần npm start đang chạy)
                  # npm run smoke -- mobile   → chỉ mobile
# Ba lệnh dưới tự khởi động stack, nên tắt npm start trước:
npm run verify    # cùng dữ liệu (web + mobile)? mobile chỉ đúng field? N+1? lỗi Product? → results/verify.txt
npm run trace     # trace N+1 trước/sau, call graph BFF, trace mobile → results/trace-*.log
npm run bench     # đo bằng Playwright, web + mobile → results/raw.csv, summary.md, waterfall.html
```

## Kịch bản demo (dữ liệu small)

1. `npm start`, mở `/`, bấm **Baseline**: terminal hiện 7 request từ `browser`, p1 và p2 bị gọi 2 lần.
2. Bấm **BFF**: 1 request, gateway gọi user và order song song, rồi 1 lần `GET /products?ids=p1,p2,p3`.
3. Bấm **GraphQL** (loader): 1 request, 1 lần gọi product. Mở GraphiQL để thử chọn field.
4. Bấm **📱 Bản mobile**, lần lượt bấm Baseline / BFF / GraphQL. Log cho thấy BFF gọi `GET /bff/mobile/orders/u1` (endpoint riêng), còn GraphQL vẫn là `POST /graphql` (chỉ khác query). Trong DevTools → Network, so sánh kích thước response mobile với web.
5. Tắt, chạy `$env:GQL_MODE='naive'; npm start`, bấm **GraphQL**: 5 lần `GET /products/pX`, đó là N+1.
6. Tắt, chạy `$env:PRODUCT_FAULT='error'; npm start`: cả 3 biến thể vẫn hiện 5 đơn kèm "⚠ không tải được product".

## Cấu trúc

```
data/{small,large}/          users.json, orders.json, products.json (dữ liệu giả)
services/{user,order,product} 3 service REST (Express)
shared/                      config (cổng), contract (view-model, lỗi, query), service (metrics, trace)
gateway/                     BFF (bff.js), GraphQL + DataLoader (graphql.js), clients.js
web/                         dashboard.html + app.js (web), mobile.html + mobile.js (mobile), fetchers.js (3 biến thể × 2 client)
scripts/                     seed, smoke, trace, verify, bench, lib/stack.js
tests/                       node:test
results/                     số liệu thật đã chạy
docs/                        tài liệu (bên dưới)
```

## Tài liệu

- [00-plan.md](docs/00-plan.md): plan và các quyết định đã chốt (viết trước khi code)
- [01-baseline.md](docs/01-baseline.md): bài toán, 3 service, baseline
- [02-bff.md](docs/02-bff.md): BFF và call graph nội bộ
- [03-graphql-n+1.md](docs/03-graphql-n+1.md): GraphQL, N+1, DataLoader, trace trước/sau
- [04-measurement.md](docs/04-measurement.md): cách đếm, bảng đo, waterfall, đối chiếu dữ liệu
- [05-fault.md](docs/05-fault.md): Product chậm hoặc lỗi
- [06-tradeoffs.md](docs/06-tradeoffs.md): trade-off, giới hạn phép đo, dàn ý thuyết trình
- [07-mobile.md](docs/07-mobile.md): client mobile, endpoint BFF riêng và query GraphQL riêng

Toàn bộ dữ liệu là dữ liệu giả, không có secret.
