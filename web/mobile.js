import { createFetchers } from './fetchers.js';
import { SERVICE_URLS } from '../shared/config.js';

const params = new URLSearchParams(location.search);
const variant = params.get('variant') ?? 'baseline';
const userId = params.get('user') ?? 'u1';
const { mobile } = createFetchers({ services: SERVICE_URLS });

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Mobile chỉ dùng: mã đơn, trạng thái, tên product, thumbnail. */
function render(vm) {
  if (!vm.orders) { $('#title').textContent = `Không tìm thấy user ${userId}`; return; }
  $('#title').textContent = `Đơn hàng của tôi (${vm.orders.length})`;
  $('#orders').innerHTML = vm.orders.map((o) => `<li>
    ${o.product ? `<img src="${esc(o.product.thumbnail)}" alt="" loading="lazy">` : '<span class="noimg">⚠</span>'}
    <div>
      <div class="name ${o.product ? '' : 'warn'}">${o.product ? esc(o.product.name) : 'Không tải được product'}</div>
      <div class="meta">#${esc(o.id)}</div>
    </div>
    <span class="badge ${esc(o.status)}">${esc(o.status)}</span>
  </li>`).join('');
  $('#errors').textContent = vm.errors.length ? `${vm.errors.length} lỗi — ${vm.errors[0].message}` : '';
}

for (const a of document.querySelectorAll('nav a')) a.classList.toggle('active', a.dataset.variant === variant);
try {
  render(await mobile[variant](userId));
} catch (e) {
  $('#title').textContent = `Lỗi: ${e.message}`;
}
performance.mark('done');            // mốc "màn hình hoàn tất" (không chờ ảnh tải xong)
window.__done = performance.now();
$('#timing').textContent = `variant=${variant} · hoàn tất sau ${window.__done.toFixed(0)} ms`;
