// Sinh REPORT.html từ REPORT.md (marked) — 1 file HTML tự chứa CSS, ảnh trỏ tương đối tới results/.
import { readFileSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';

const md = readFileSync(new URL('../REPORT.md', import.meta.url), 'utf8');
const title = md.match(/^# (.+)$/m)?.[1] ?? 'Report';
const body = marked.parse(md, { gfm: true });

writeFileSync(new URL('../REPORT.html', import.meta.url), `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { --fg: #1f2937; --muted: #6b7280; --bg: #ffffff; --line: #e5e7eb; --code: #f3f4f6; --accent: #1d4ed8; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e5e7eb; --muted: #9ca3af; --bg: #111827; --line: #374151; --code: #1f2937; --accent: #93c5fd; }
  }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.65 system-ui, "Segoe UI", sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 30px; line-height: 1.25; }
  h2 { margin-top: 48px; padding-bottom: 6px; border-bottom: 2px solid var(--line); }
  h3 { margin-top: 32px; }
  a { color: var(--accent); }
  hr { border: 0; border-top: 1px solid var(--line); margin: 32px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 14px; display: block; overflow-x: auto; }
  th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: var(--code); }
  code { background: var(--code); padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
  pre { background: var(--code); padding: 12px 14px; border-radius: 8px; overflow-x: auto; line-height: 1.45; }
  pre code { padding: 0; background: none; }
  img { max-width: 100%; border: 1px solid var(--line); border-radius: 6px; margin: 6px 0; background: #fff; }
  em { color: var(--muted); }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`);
console.log('→ REPORT.html');
