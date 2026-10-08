import { createFetchers } from './fetchers.js';
import { SERVICE_URLS } from '../shared/config.js';

const params = new URLSearchParams(location.search);
const variant = params.get('variant') ?? 'baseline';
const userId = params.get('user') ?? 'u1';
const fetchers = createFetchers({ services: SERVICE_URLS });

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => `${n.toLocaleString('vi-VN')} ₫`;

/** Một hàm render cho cả 3 biến thể. */
function render(vm) {
  if (!vm.user) { $('#title').textContent = `Không tìm thấy user ${userId}`; return; }
  $('#title').textContent = `${vm.user.name} — ${vm.user.orders.length} đơn`;
  $('#orders').innerHTML = vm.user.orders.map((o) => `<tr>
    <td>${esc(o.id)}</td>
    <td>${o.product ? esc(o.product.name) : '<span class="warn">⚠ không tải được product</span>'}</td>
    <td>${o.qty}</td><td>${money(o.unitPrice)}</td><td>${esc(o.status)}</td>
    <td>${o.createdAt.slice(0, 16).replace('T', ' ')}</td></tr>`).join('');
  $('#errors').textContent = vm.errors.length ? `${vm.errors.length} lỗi — ${vm.errors[0].message}` : '';
}

for (const a of document.querySelectorAll('nav a')) a.classList.toggle('active', a.dataset.variant === variant);
try {
  render(await fetchers[variant](userId));
} catch (e) {
  $('#title').textContent = `Lỗi: ${e.message}`;
}
performance.mark('done');            // mốc "màn hình hoàn tất"
window.__done = performance.now();   // ms tính từ navigation start
$('#timing').textContent = `variant=${variant} · màn hình hoàn tất sau ${window.__done.toFixed(0)} ms`;
