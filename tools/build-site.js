/* Assemble the published site in _site/: only tracked web files, developer comments stripped.
   Run by the Pages workflow; run locally with `node tools/build-site.js` before a security scan. */
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { run } = require('./strip-comments.js');

const root = path.resolve(__dirname, '..'), out = path.join(root, '_site');
const WEB = /\.(html?|css|m?js|jpe?g|png|webp|avif|gif|svg|ico|mp4|webm|woff2?|xml|txt|pdf)$/i;
const SKIP = /^(\.github|tools|New style)\/|^report\d*\.png$|^screenshot/i;
const KEEP = new Set(['CNAME', '.nojekyll']);

fs.rmSync(out, { recursive: true, force: true });
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
let n = 0;
for (const f of files) {
  if (SKIP.test(f) || !(KEEP.has(f) || WEB.test(f))) continue;
  fs.mkdirSync(path.join(out, path.dirname(f)), { recursive: true });
  fs.copyFileSync(path.join(root, f), path.join(out, f));
  n++;
}
const r = run(out, true);
for (const p of r.problems) console.log('PROBLEM ' + p);
console.log(`_site: ${n} files, ${r.total} comments stripped from ${r.changed.length} files`);
if (r.problems.length) process.exit(2);
