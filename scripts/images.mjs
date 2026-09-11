/* Build responsive derivatives of the photographs.
 *
 * Runs before `astro build`, so anything Stafford uploads through the CMS is
 * picked up automatically on the next deploy. Only the photographic JPEGs are
 * processed — the patches and sponsor marks are already small transparent
 * WebP and gain nothing from resizing.
 *
 * Output: public/images/derived/<name>-<width>.avif|webp
 * Manifest: src/data/images.json, read by the Photo component.
 */
import sharp from 'sharp';
import { readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SRC_DIRS = ['public/images/light', 'public/images/uploads'];
const OUT_DIR = 'public/images/derived';
const WIDTHS = [480, 800, 1200, 1600];
const manifest = {};

await mkdir(OUT_DIR, { recursive: true });

for (const dir of SRC_DIRS) {
  if (!existsSync(dir)) continue;
  for (const file of await readdir(dir)) {
    if (!/\.(jpe?g|png)$/i.test(file)) continue;

    const src = path.join(dir, file);
    const key = src.replace(/^public\//, '');       // e.g. images/light/foo.jpg
    const base = file.replace(/\.[^.]+$/, '');
    const img = sharp(src);
    const { width: w0, height: h0 } = await img.metadata();
    const srcTime = (await stat(src)).mtimeMs;

    const widths = WIDTHS.filter((w) => w < w0).concat(w0);
    const variants = [];

    for (const w of widths) {
      for (const [fmt, opts] of [['avif', { quality: 52 }], ['webp', { quality: 76 }]]) {
        const out = path.join(OUT_DIR, `${base}-${w}.${fmt}`);
        const fresh = existsSync(out) && (await stat(out)).mtimeMs > srcTime;
        if (!fresh) {
          await sharp(src).resize({ width: w, withoutEnlargement: true })[fmt](opts).toFile(out);
        }
        variants.push({ w, fmt, path: out.replace(/^public\//, '') });
      }
    }
    manifest[key] = { width: w0, height: h0, variants };
  }
}

await writeFile('src/data/images.json', JSON.stringify(manifest, null, 2));
const n = Object.keys(manifest).length;
const files = Object.values(manifest).reduce((a, m) => a + m.variants.length, 0);
console.log(`images: ${n} source photograph${n === 1 ? '' : 's'} → ${files} derivatives`);
