# 03 — GraphQL: tái hiện N+1 rồi sửa bằng DataLoader

> Phần **Solution 2** của bài trình bày. Trace dưới đây lấy từ `npm run trace` (file `results/trace-*.log`).

## 1. GraphQL trong bài này

- **Một endpoint** `POST /graphql` (graphql-yoga, mount trong gateway). Mở `GET /graphql` trên browser sẽ thấy GraphiQL để demo.
- Client **tự chọn field** cần lấy. Dashboard web gửi đúng một query:

```graphql
query Dashboard($userId: ID!) {
  user(id: $userId) {
    id name email
    orders { id qty unitPrice status createdAt product { id name price thumbnail } }
  }
}
```

Schema (`gateway/graphql.js`):

```graphql
type Query   { user(id: ID!): User }
type User    { id: ID! name: String! email: String! orders: [Order!]! }
type Order   { id: ID! qty: Int! unitPrice: Float! status: String! createdAt: String! product: Product }
type Product { id: ID! name: String! price: Float! thumbnail: String! }
```

`Order.product` để **nullable** có chủ đích: Product Service lỗi thì field này thành `null` kèm `errors[]`, đúng policy lỗi đã chọn.

Mỗi field có một **resolver**: `Query.user` gọi User Service, `User.orders` gọi Order Service, `Order.product` gọi Product Service.

## 2. N+1 là gì

GraphQL thực thi resolver **theo từng node của cây**. `Order.product` chạy **một lần cho mỗi đơn**. Nếu viết thẳng:

```js
Order: { product: (order, _, ctx) => ctx.clients.getProduct(order.productId) } // GQL_MODE=naive
```

thì 1 query lấy danh sách đơn kéo theo **N call** lấy product. Đó là **N+1**.

**Trace thật, `GQL_MODE=naive`, dữ liệu small** (`results/trace-graphql-naive-small.log`):

```
02:25:08.950 [gw-ea4b5a3a] gateway POST /graphql
02:25:08.984 [gw-ea4b5a3a] user    GET /users/u1
02:25:08.990 [gw-ea4b5a3a] order   GET /orders?userId=u1
02:25:08.998 [gw-ea4b5a3a] product GET /products/p1
02:25:08.999 [gw-ea4b5a3a] product GET /products/p2
02:25:09.000 [gw-ea4b5a3a] product GET /products/p2   ← trùng
02:25:09.000 [gw-ea4b5a3a] product GET /products/p3
02:25:09.001 [gw-ea4b5a3a] product GET /products/p1   ← trùng

user: calls=1 db=1 | order: calls=1 db=1 | product: calls=5 db=5
```

Dữ liệu large: `product: calls=200 db=200`. **Số call tăng tuyến tính theo số đơn.**

Client vẫn chỉ gửi 1 request, nên N+1 không biến mất mà **chuyển vào trong server**. Nếu không có cơ chế batch, GraphQL còn tệ hơn BFF.

## 3. Sửa bằng DataLoader (batching + dedup trong một request)

```js
Order: { product: (order, _, ctx) => ctx.productLoader.load(order.productId) } // GQL_MODE=loader

context: ({ request }) => {
  const clients = createClients(request.headers.get('x-request-id'), urls);
  // Loader mới cho MỖI request: dedup/cache chỉ sống trong request này.
  const productLoader = new DataLoader(async (ids) => {
    const byId = new Map((await clients.getProductsByIds(ids)).map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id) ?? null); // đúng thứ tự + đúng độ dài như ids
  });
  return { clients, productLoader };
}
```

Cách DataLoader hoạt động:

1. **Batching**: mọi `load(id)` gọi trong **cùng một tick** của event loop được gom lại. Hết tick, hàm batch được gọi **một lần** với cả mảng id.
2. **Dedup và cache**: `load('p1')` hai lần chỉ tạo một key, cả hai nơi gọi nhận cùng một Promise.
3. **Phạm vi một request**: loader được tạo trong `context`, mỗi request GraphQL có một loader riêng. Nhờ vậy không có dữ liệu cũ hay dữ liệu của user khác lọt sang request khác. Test `2 request = 2 call` chứng minh điều này.
4. Hợp đồng của hàm batch: trả mảng **cùng độ dài, cùng thứ tự** với `ids`. Id không tồn tại thì trả `null`.

**Trace thật, `GQL_MODE=loader`, dữ liệu small** (`results/trace-graphql-loader-small.log`):

```
02:25:10.039 [gw-11b913ff] gateway POST /graphql
02:25:10.076 [gw-11b913ff] user    GET /users/u1
02:25:10.084 [gw-11b913ff] order   GET /orders?userId=u1
02:25:10.089 [gw-11b913ff] product GET /products?ids=p1,p2,p3   ← 5 đơn → 1 call, đã dedup

user: calls=1 db=1 | order: calls=1 db=1 | product: calls=1 db=1
```

## 4. Trước và sau khi sửa

| Dữ liệu | Số đơn | Product calls (naive) | Product calls (loader) | Product DB query (naive → loader) |
|---|---|---|---|---|
| small | 5 | 5 | **1** | 5 → 1 |
| large | 200 | 200 | **1** | 200 → 1 |

Sau khi sửa, **số call tới Product Service không còn tăng theo số đơn**. Đây là tiêu chí đạt của đề.

Chạy lại: `npm run trace` (small) và `$env:DATASET='large'; npm run trace` (PowerShell).

## 5. So với BFF

| | BFF | GraphQL (loader) |
|---|---|---|
| user và orders | **song song** (`Promise.all`) | **nối tiếp**: `User.orders` chỉ chạy sau khi `Query.user` xong (resolver theo cây) |
| Batch và dedup product | tự viết (`new Set` + batch) | DataLoader |
| Trace | `order` và `user` cùng 11:026 | `user` 076 rồi mới `order` 084 |

Muốn GraphQL song song như BFF thì có thể cho `Query.user` trả ngay `{ id }`, còn các field `name` và `email` thì để resolver riêng gọi User Service. Khi đó `User.orders` chạy song song với `User.name`. Bài này giữ cách viết resolver đơn giản để thấy rõ khác biệt.
