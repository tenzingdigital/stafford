/* Astro emits root-relative asset paths (/assets/…). Those are correct for a
   site served from a domain root, but break in any preview served from a
   subpath. index.html sits at the root, so the relative form resolves to the
   same URL in both cases — rewrite it and get both for free. */
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'dist/index.html';
const html = readFileSync(file, 'utf8');
const pattern = /(href|src)="\/(assets\/|images\/)/g;
const n = (html.match(pattern) || []).length;
writeFileSync(file, html.replace(pattern, '$1="$2'));
console.log(`relativise: rewrote ${n} asset path${n === 1 ? '' : 's'} in ${file}`);
