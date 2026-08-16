// Bundle the Vite build output into one self-contained HTML file (for artifact
// publishing / sharing — no external requests, everything inlined).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = join(dist, 'assets');

for (const f of readdirSync(assets)) {
  const content = readFileSync(join(assets, f), 'utf8');
  if (f.endsWith('.js')) {
    html = html.replace(
      new RegExp(`<script type="module"[^>]*src="/assets/${f}"[^>]*></script>`),
      () => `<script type="module">${content.replaceAll('</script>', '<\\/script>')}</script>`,
    );
  } else if (f.endsWith('.css')) {
    html = html.replace(
      new RegExp(`<link rel="stylesheet"[^>]*href="/assets/${f}"[^>]*>`),
      () => `<style>${content}</style>`,
    );
  }
}

const out = process.argv[2] ?? join(dist, 'bastion-single.html');
writeFileSync(out, html);
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`);
