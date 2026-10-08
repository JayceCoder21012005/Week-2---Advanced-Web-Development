// Sinh dữ liệu giả, tái lập được (PRNG có seed cố định).
import { mkdirSync, writeFileSync } from 'node:fs';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Bàn phím cơ', 'Chuột không dây', 'Tai nghe Bluetooth', 'Màn hình 24 inch', 'Ổ SSD 1TB',
  'Webcam HD', 'Loa mini', 'Sạc dự phòng', 'Cáp USB-C', 'Đế tản nhiệt', 'Balo laptop', 'Bút cảm ứng',
  'Hub USB', 'Micro thu âm', 'Đèn bàn LED', 'Giá đỡ điện thoại', 'Thẻ nhớ 128GB', 'Router WiFi 6',
  'Bàn di chuột', 'Ghế công thái học'];
const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
const USERS = [
  { id: 'u1', name: 'Nguyễn Văn An', email: 'an@example.com' },
  { id: 'u2', name: 'Trần Thị Bình', email: 'binh@example.com' },
];

function build(seed, nOrders, nProducts) {
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const products = NAMES.slice(0, nProducts).map((name, i) => ({
    id: `p${i + 1}`, name, price: (Math.floor(rand() * 50) + 1) * 10000,
    thumbnail: `/thumbs/p${i + 1}.svg`, category: pick(['accessory', 'audio', 'storage', 'network']),
  }));
  const orders = [];
  const add = (userId, n) => {
    for (let i = 0; i < n; i++) {
      const p = pick(products); // nhiều đơn trùng product → có cái để dedup
      orders.push({
        id: `o${orders.length + 1}`, userId, productId: p.id, qty: 1 + Math.floor(rand() * 3),
        unitPrice: p.price, status: pick(STATUSES),
        createdAt: new Date(Date.UTC(2026, 0, 1) + orders.length * 3_600_000).toISOString(),
      });
    }
  };
  add('u1', nOrders);
  add('u2', 3);
  return { users: USERS, products, orders };
}

for (const [name, nOrders, nProducts] of [['small', 5, 3], ['large', 200, 20]]) {
  const dir = new URL(`../data/${name}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const [table, rows] of Object.entries(build(42, nOrders, nProducts))) {
    writeFileSync(new URL(`${table}.json`, dir), JSON.stringify(rows, null, 2));
  }
  console.log(`data/${name}: ${nOrders} đơn của u1, ${nProducts} product`);
}
