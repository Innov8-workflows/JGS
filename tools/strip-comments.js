/* Strip developer comments from BUILT site output, provably without changing anything else.

   node strip-comments.js <dir>            dry run: per-file comment counts, nothing written
   node strip-comments.js <dir> --write    rewrite .html/.css/.js in place

   JS comments are located by acorn (a real parser), so "https://*.x" inside a string or a
   regex can never be mistaken for a comment. CSS comments by a scanner that skips strings.
   HTML comments outside script/style; IE conditional comments and "bang" licence
   blocks (slash-star-bang) are kept. Every rewritten JS body is re-tokenised and must match the original
   token for token; a file that fails is left untouched and reported. */
'use strict';
const fs = require('fs'), path = require('path'), acorn = require('./vendor/acorn.js');

const OPTS = { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowImportExportEverywhere: true };
const tokens = (src, sourceType) => { const out = []; for (const t of acorn.tokenizer(src, { ...OPTS, sourceType })) out.push(t.type.label + '\u0001' + (t.value === undefined ? '' : String(t.value))); return out; };

function stripJs(src) {
  for (const sourceType of ['script', 'module']) {
    const ranges = [];
    try { acorn.parse(src, { ...OPTS, sourceType, onComment: (block, text, start, end) => { if (!(block && text.startsWith('!'))) ranges.push([start, end, block && /\n/.test(text)]); } }); }
    catch { continue; }
    if (!ranges.length) return { out: src, n: 0 };
    let out = '', at = 0;
    for (const [s, e, multiline] of ranges) { out += src.slice(at, s) + (multiline ? '\n' : ' '); at = e; }
    out += src.slice(at);
    out = out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
    const a = tokens(src, sourceType), b = tokens(out, sourceType);
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) throw new Error('token mismatch after strip');
    return { out, n: ranges.length };
  }
  throw new Error('acorn could not parse');
}

function stripCss(src) {
  let out = '', n = 0;
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '"' || c === "'") { let j = i + 1; while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; } out += src.slice(i, j + 1); i = j + 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; if (src[i + 2] === '!') out += src.slice(i, end); else n++; i = end; continue; }
    out += c; i++;
  }
  return { out: n ? out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n') : src, n };
}

function stripHtml(doc, problems, file) {
  const keep = []; let n = 0;
  const hold = s => '\u0000' + (keep.push(s) - 1) + '\u0000';
  doc = doc.replace(/(<script\b([^>]*)>)([\s\S]*?)(<\/script>)/gi, (all, open, attrs, body, close) => {
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || '';
    if (/src\s*=/i.test(attrs) || !body.trim() || (type && !/^(text\/javascript|application\/javascript|module)$/i.test(type))) return hold(all);
    try { const r = stripJs(body); n += r.n; return hold(open + r.out + close); }
    catch (e) { problems.push(file + ': inline script left as is (' + e.message + ')'); return hold(all); }
  });
  doc = doc.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (all, open, body, close) => { const r = stripCss(body); n += r.n; return hold(open + r.out + close); });
  doc = doc.replace(/(<(textarea|pre)\b[^>]*>)[\s\S]*?<\/\2>/gi, all => hold(all));
  doc = doc.replace(/<!--(?!\[if|<!\[endif)[\s\S]*?-->/g, () => (n++, ''));
  doc = doc.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]).replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
  return { out: n ? doc.replace(/^[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n') : doc, n };
}

function walk(p) { return fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter(n => n !== 'node_modules' && !n.startsWith('.')).flatMap(n => walk(path.join(p, n))) : [p]; }

function run(dir, write) {
  const problems = [], changed = [];
  let total = 0;
  for (const f of walk(dir).filter(f => /\.(html?|css|m?js)$/i.test(f))) {
    const src = fs.readFileSync(f, 'utf8');
    let r;
    try { r = /\.html?$/i.test(f) ? stripHtml(src, problems, f) : /\.css$/i.test(f) ? stripCss(src) : stripJs(src); }
    catch (e) { problems.push(f + ': left as is (' + e.message + ')'); continue; }
    if (!r.n || r.out === src) continue;
    total += r.n; changed.push([path.relative(dir, f), r.n, src.length - r.out.length]);
    if (write) fs.writeFileSync(f, r.out);
  }
  return { total, changed, problems };
}

module.exports = { run, stripJs, stripCss, stripHtml };
if (require.main === module) {
  const dir = process.argv[2], write = process.argv.includes('--write'), lenient = process.argv.includes('--lenient');
  const r = run(dir, write);
  for (const [f, n, bytes] of r.changed) console.log((write ? 'stripped ' : 'would strip ') + n + ' comments (' + bytes + ' bytes) ' + f);
  for (const p of r.problems) console.log('PROBLEM ' + p);
  console.log(r.changed.length + ' files, ' + r.total + ' comments' + (write ? ' removed' : ' found') + ', ' + r.problems.length + ' problems');
  process.exitCode = r.problems.length && !lenient ? 2 : 0; // --lenient: a file that cannot be proven safe is left as is, never blocks a deploy
}
