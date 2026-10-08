// Mở trang thật trên Edge cho từng biến thể, in tiêu đề / thời gian / số dòng / lỗi. Cần `npm start` đang chạy.
import { chromium } from 'playwright';
import { urlOf } from '../shared/config.js';

const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['baseline', 'bff', 'graphql'];
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge' });
const page = await browser.newPage();
for (const v of variants) {
  await page.goto(`${urlOf('gateway')}/dashboard.html?variant=${v}`);
  await page.waitForFunction(() => window.__done !== undefined, null, { timeout: 60_000 });
  console.log([v, await page.textContent('#title'), await page.textContent('#timing'),
    `rows=${await page.locator('#orders tr').count()}`, await page.textContent('#errors')].join(' | '));
}
await browser.close();
