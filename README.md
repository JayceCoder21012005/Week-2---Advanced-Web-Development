# API Composition: Baseline REST vs BFF vs GraphQL

Bài tập Web nâng cao, tuần 2, block 2.

Hệ thống có hai loại client dùng chung dữ liệu:
- **Dashboard web:** tên user, danh sách đơn đầy đủ field, tên product.
- **App mobile:** chỉ mã đơn, trạng thái, tên product và thumbnail.

Dữ liệu nằm ở 3 service (User, Order, Product), mỗi service một file JSON riêng. Bài so sánh 3 cách ghép dữ liệu:
- **Baseline:** browser tự gọi từng service rồi tự ghép.
- **BFF:** mỗi client một endpoint.
- **GraphQL:** một endpoint, mỗi client một query; có tái hiện N+1 rồi sửa bằng DataLoader.

**Báo cáo giải thích các lựa chọn và kết quả:** [REPORT.md](REPORT.md) / [REPORT.html](REPORT.html)

## Sản phẩm nộp

| Thành phần | Vị trí |
|---|---|
| Mã nguồn | `services/`, `gateway/`, `shared/`, `web/`, `scripts/`, `tests/` |
| Dữ liệu (giả) | `data/small/`, `data/large/` (sinh bằng `npm run seed`) |
| Hướng dẫn triển khai | file này |
| Báo cáo lựa chọn và kết quả | `REPORT.md`, `REPORT.html` |
| Kết quả đo thật | `results/`: `raw.csv`, `summary.md`, `waterfall.html`, `trace-*.log`, `verify.txt`, ảnh `*.png` |

## 1. Yêu cầu

- **Node.js ≥ 24** (nhóm chạy trên Node 26). Kiểm tra bằng `node -v`.
- **Microsoft Edge**, chỉ cần cho `npm run smoke` và `npm run bench`. Edge có sẵn trên Windows, nên **không cần** chạy `npx playwright install`. Muốn dùng Chrome thì đặt `$env:BROWSER_CHANNEL='chrome'`.
- Các cổng **4000–4003** phải đang trống.

## 2. Cài đặt

```powershell
npm install
npm run seed      # (tuỳ chọn) sinh lại data/small và data/large; dữ liệu đã có sẵn trong repo
```

## 3. Chạy hệ thống

```powershell
npm start
```

Lệnh này chạy cùng lúc 4 process; terminal in log trace của mọi request:

| Process | Cổng | Vai trò |
|---|---|---|
| gateway | 4000 | Phục vụ trang web, BFF và GraphQL |
| user-service | 4001 | `data/<ds>/users.json` |
| order-service | 4002 | `data/<ds>/orders.json` |
| product-service | 4003 | `data/<ds>/products.json` |

Mở trình duyệt:
- **Web:** <http://localhost:4000/>. Bấm **Baseline (REST) / BFF / GraphQL** để đổi biến thể.
- **Mobile:** <http://localhost:4000/mobile.html>, hoặc bấm "📱 Bản mobile" trên trang web. Nên bật chế độ thiết bị di động của DevTools: `F12` rồi `Ctrl+Shift+M`.
- **GraphiQL:** <http://localhost:4000/graphql>. Thử query `Dashboard` (web) và `MobileOrders` (mobile), chép từ `shared/contract.js`.

Dừng bằng `Ctrl + C`.

### API

| Endpoint | Mô tả |
|---|---|
| `GET :4001/users/:id` | User Service |
| `GET :4002/orders?userId=` | Order Service |
| `GET :4003/products/:id`, `GET :4003/products?ids=a,b` | Product Service (lấy lẻ hoặc theo lô) |
| `GET :400x/metrics`, `POST :400x/metrics/reset` | Bộ đếm call và DB query của từng service |
| `GET :4000/bff/web/dashboard/:userId` | BFF cho web |
| `GET :4000/bff/mobile/orders/:userId` | BFF cho mobile, chỉ trả `id`, `status`, `product.name`, `product.thumbnail` |
| `POST :4000/graphql` | GraphQL, một endpoint cho cả hai client |

User có dữ liệu mẫu là `u1` và `u2`. Đổi user bằng tham số `?user=u2`.

### Biến môi trường (cú pháp PowerShell)

| Biến | Giá trị | Ý nghĩa |
|---|---|---|
| `DATASET` | `small` (mặc định) / `large` | u1 có 5 hoặc 200 đơn |
| `GQL_MODE` | `loader` (mặc định) / `naive` | GraphQL có DataLoader, hoặc tái hiện N+1 |
| `PRODUCT_FAULT` | `none` (mặc định) / `error` / `slow` | Gây lỗi cho Product Service |
| `PRODUCT_DELAY_MS` | `2000` | Độ trễ của chế độ `slow` (timeout của gateway là 1000 ms) |
| `QUIET` | `1` | Tắt log request |
| `RUNS` | `6` | Số lần chạy mỗi tổ hợp khi bench (1 lạnh + phần còn lại ấm) |
| `BROWSER_CHANNEL` | `msedge` | Trình duyệt Playwright dùng |

```powershell
$env:DATASET='large'; npm start
Remove-Item Env:DATASET            # trả về mặc định
```

## 4. Kiểm thử, đối chiếu và đo

```powershell
npm test          # 24 test (unit + integration, chạy trên cổng ngẫu nhiên)
npm run smoke     # mở trang thật: web + mobile × 3 biến thể (cần npm start đang chạy)
```

Bốn lệnh dưới **tự bật và tắt** hệ thống, nên **phải tắt `npm start` trước** khi chạy:

```powershell
npm run verify    # cùng dữ liệu (web + mobile)? mobile chỉ đúng field? N+1? Product lỗi/chậm? → results/verify.txt
npm run trace     # trace N+1 trước/sau, call graph BFF, trace mobile → results/trace-*.log
npm run bench     # đo bằng Edge, khoảng 3–4 phút → results/raw.csv, summary.md, waterfall.html
npm run report    # sinh lại REPORT.html từ REPORT.md
```

## 5. Kịch bản demo (dữ liệu small)

1. `npm start`, mở <http://localhost:4000/>, bấm **Baseline**. Terminal hiện 7 request từ `browser`; p1 và p2 bị gọi 2 lần.
2. Bấm **BFF**. Có 1 request; gateway gọi user và order song song, rồi gọi `GET /products?ids=p1,p2,p3` một lần.
3. Bấm **GraphQL**. Có 1 request, product được gọi 1 lần. Mở GraphiQL để thử chọn field.
4. Bấm **📱 Bản mobile** rồi lần lượt bấm Baseline / BFF / GraphQL:
   - BFF gọi **endpoint riêng** `GET /bff/mobile/orders/u1`.
   - GraphQL vẫn là `POST /graphql`, chỉ **khác query**.
   - Trong DevTools → Network, response mobile nhỏ hơn web khoảng một nửa.
5. `Ctrl + C`, chạy `$env:GQL_MODE='naive'; npm start`, bấm **GraphQL**. Terminal hiện 5 lần `GET /products/pX`: đây là N+1.
6. `Ctrl + C`, chạy `Remove-Item Env:GQL_MODE; $env:PRODUCT_FAULT='error'; npm start`. Cả 3 biến thể, ở cả web và mobile, vẫn hiện 5 đơn kèm "⚠ không tải được product".

## 6. Cấu trúc thư mục

```
data/{small,large}/           users.json, orders.json, products.json (dữ liệu giả)
services/{user,order,product}  3 service REST (Express), mỗi service một file JSON
shared/                       config.js (cổng), contract.js (view-model, lỗi, 2 query GraphQL), service.js (metrics, trace)
gateway/                      bff.js (BFF web + mobile), graphql.js (GraphQL + DataLoader), clients.js, index.js
web/                          dashboard.html + app.js (web), mobile.html + mobile.js (mobile), fetchers.js (3 biến thể × 2 client)
scripts/                      seed, smoke, trace, verify, bench, report, lib/stack.js
tests/                        node:test
results/                      kết quả đo thật
REPORT.md, REPORT.html        báo cáo
```

Toàn bộ dữ liệu là dữ liệu giả, không có secret hay token.
