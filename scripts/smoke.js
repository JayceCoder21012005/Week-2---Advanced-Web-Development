// Mở trang thật trên Edge cho từng client × biến thể, in tiêu đề / thời gian / số dòng / lỗi. Cần `npm start` đang chạy.
// Ví dụ: npm run smoke            (web + mobile, cả 3 biến thể)
//        npm run smoke -- mobile  (chỉ mobile)
//        npm run smoke -- web bff (chỉ web, chỉ BFF)
import { chromium } from 'playwright';
import { urlOf } from '../shared/config.js';

const PAGES = { web: 'dashboard.html', mobile: 'mobile.html' };
const args = process.argv.slice(2);
const clients = args.filter((a) => a in PAGES);
const variants = args.filter((a) => !(a in PAGES));

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge' });
for (const client of clients.length ? clients : Object.keys(PAGES)) {
  const page = await browser.newPage(client === 'mobile' ? { viewport: { width: 390, height: 844 } } : {});
  for (const v of variants.length ? variants : ['baseline', 'bff', 'graphql']) {
    await page.goto(`${urlOf('gateway')}/${PAGES[client]}?variant=${v}`);
    await page.waitForFunction(() => window.__done !== undefined, null, { timeout: 60_000 });
    console.log([`${client}/${v}`, await page.textContent('#title'), await page.textContent('#timing'),
      `rows=${await page.locator('#orders > *').count()}`, await page.textContent('#errors')].join(' | '));
  }
  await page.close();
}
await browser.close();
