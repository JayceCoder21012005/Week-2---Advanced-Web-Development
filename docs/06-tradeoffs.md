# 06 — Trade-off, giới hạn phép đo và dàn ý thuyết trình

## 1. So sánh ba cách ghép dữ liệu

| Tiêu chí | Baseline (browser ghép) | BFF | GraphQL |
|---|---|---|---|
| Request từ client | 2 + N, tuần tự | **1** | **1** |
| Call tới Product | N (không dedup) | 1 (dedup + batch tự viết) | naive: N; loader: **1** |
| Ai sở hữu logic ghép | Frontend | Team BFF (thường là team frontend) | Schema và resolver dùng chung |
| Thêm màn hình hoặc client mới | Sửa frontend | **Thêm endpoint** (đã làm: `/bff/mobile/orders/:userId`) | **Viết query mới** (đã làm: `MobileOrders`), không đổi server |
| Payload cho mobile (large) | 46.5 KB, như web, vì REST trả hết | 19.8 KB | 19.8 KB |
| Over/under-fetching | Nhận cả object, thừa field | Trả đúng field màn hình cần | Client chọn field |
| Song song hóa | Tùy client (ở đây tuần tự) | Toàn quyền (`Promise.all`) | Theo cây resolver: field con chờ field cha |
| Rủi ro N+1 | Có, ở client | Thấp, do tự viết batch | **Cao nếu quên DataLoader** (đo được 200 call) |
| HTTP cache / CDN | Cache từng resource | `GET` dễ cache | `POST /graphql` khó cache, cần persisted query hoặc cache ở client |
| Lỗi một phần | Tự xử lý | Tự định nghĩa `errors[]` | Có sẵn: field nullable + `errors[]` có `path` |
| Bảo mật | Browser thấy mọi service, phải mở CORS | Service ẩn sau gateway | Service ẩn; nhưng query tùy ý cần giới hạn độ sâu và độ phức tạp |
| Độ phức tạp vận hành | Thấp nhất | Thêm một service | Thêm một service, schema, công cụ và giám sát resolver |

**Kết luận của nhóm:**

- **BFF** hợp khi số loại client ít và màn hình ổn định. Code dễ đọc, kiểm soát được song song và cache. Mỗi client mới cần thêm một endpoint: mobile tốn thêm 1 hàm compose và 1 route.
- **GraphQL** hợp khi có nhiều client hoặc màn hình cùng dùng một mô hình dữ liệu và yêu cầu thay đổi thường xuyên. Mobile chỉ cần viết thêm 1 query, không sửa server. Đổi lại phải **luôn dùng DataLoader**: bản naive vẫn gửi 200 call nội bộ dù client chỉ gửi 1 request.
- Ở bộ large, BFF và GraphQL loader có thời gian tương đương nhau: web 74 ms và 96 ms, mobile 79 ms và 57 ms (median), các khoảng min–max chồng nhau. Cả hai đều nhanh hơn baseline khoảng 4–7 lần.
- **Baseline** chỉ chấp nhận được với dữ liệu rất nhỏ. Thời gian tăng gần tuyến tính theo số đơn: khoảng 116 ms với small, 413 ms với large (web). Mobile vẫn phải tải đủ dữ liệu như web. Khi Product chậm, baseline chờ N lần timeout.

## 2. Giới hạn của phép đo

1. **Chạy localhost**: độ trễ mạng gần như bằng 0. Trên mạng thật (mỗi request từ browser mất 50–200 ms RTT), baseline sẽ tệ hơn nhiều so với số đo, vì 202 request tuần tự nhân với RTT.
2. **"CSDL" là JSON trong RAM**: một DB query gần như không tốn thời gian. Vì vậy **số lượng** call/query quan trọng hơn thời gian ở đây. Với CSDL thật, N+1 còn tốn thêm connection và I/O.
3. **Một máy, một user, không có tải đồng thời**: không đo throughput hay ảnh hưởng của N+1 lên service khi nhiều người dùng cùng lúc.
4. **Ít lần chạy** (1 lạnh + 5 ấm): ở bộ small, các khoảng min–max chồng lên nhau, **không kết luận được về tốc độ**. Lần lạnh dao động rất mạnh (87–968 ms) và mỗi tổ hợp chỉ có 1 mẫu lạnh.
5. **"Lạnh" chỉ là khởi động lại process Node**: chưa xóa cache của hệ điều hành hay đĩa, nên chưa phải cold start thật như trên serverless.
6. **Thời gian màn hình hoàn tất gồm cả tải HTML/JS** (giống nhau giữa các biến thể) và có overhead của Playwright và Edge.
7. **Payload là `encodedBodySize` của response** (chưa nén gzip, vì Express không bật compression). Không tính header, cũng không tính body của request (query GraphQL khoảng 200 B mỗi lần).
8. **Client mobile là trang web với viewport 390 px** chạy trên cùng máy, không phải app native trên mạng di động. Vì vậy lợi ích về payload (mobile nhận khoảng một nửa số byte) chưa thể hiện thành thời gian, do localhost không bị giới hạn băng thông.
9. GraphQL trong bài chưa có giới hạn độ sâu hoặc độ phức tạp của query, chưa có persisted query, chưa cache.

## 3. Dàn ý thuyết trình 5 phần

| Phần | Nội dung | Tài liệu / demo |
|---|---|---|
| **Problem** | Dashboard cần dữ liệu từ 3 service; baseline: 2 + N request tuần tự, N+1 ở client | `01-baseline.md`, waterfall baseline large |
| **Solution** | BFF (song song + dedup + batch, mỗi client một endpoint) và GraphQL (resolver + DataLoader, mỗi client một query) | `02-bff.md`, `03-graphql-n+1.md`, `07-mobile.md` |
| **Demo** (dữ liệu small, chạy thật) | `npm start` → mở `http://localhost:4000/`, bấm Baseline / BFF / GraphQL và xem log terminal; bấm "📱 Bản mobile" và làm lại; mở GraphiQL `/graphql`, chạy query web rồi query mobile; khởi động lại với `GQL_MODE=naive` để thấy 5 call; khởi động lại với `PRODUCT_FAULT=error` | `README.md` |
| **Evidence** | Bảng đo web và mobile, waterfall, trace N+1 trước/sau, verify (dữ liệu và field mobile), kết quả khi lỗi | `04-measurement.md`, `05-fault.md`, `07-mobile.md`, `results/` |
| **Trade-off** | Bảng ở mục 1 và giới hạn ở mục 2 | file này |
