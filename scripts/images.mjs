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
import grade from './grade.json' with { type: 'json' };

const SRC_DIRS = ['public/images/light', 'public/images/uploads'];
const OUT_DIR = 'public/images/derived';
const WIDTHS = [480, 800, 1200, 1600];
const manifest = {};

/* Photographs in light/ were graded by hand before they were committed. Anything
   arriving through the CMS has not been, and an untreated snapshot next to a
   treated one is exactly the mismatch the look was built to remove — so uploads
   are put through the same table here, on the way past. See grade.json. */
const NEEDS_GRADING = (dir) => dir.endsWith('/uploads');

/* Apply the table to every pixel. sharp has no lookup-table operation, so the
   pixels are read out raw, mapped, and handed back. Any fourth channel is
   transparency and must be left exactly as it is. */
async function applyLook(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const lut = [grade.r, grade.g, grade.b];
  const n = info.channels;
  for (let i = 0; i < data.length; i += n) {
    data[i] = lut[0][data[i]];
    data[i + 1] = lut[1][data[i + 1]];
    data[i + 2] = lut[2][data[i + 2]];
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: n } });
}

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
    const graded = NEEDS_GRADING(dir);

    /* Graded once at full size, then every size cut from that, so the treatment
       cannot drift between one width and the next. */
    const treated = graded ? await applyLook(src) : null;
    const source = () => (treated ? treated.clone() : sharp(src));

    for (const w of widths) {
      for (const [fmt, opts] of [['avif', { quality: 52 }], ['webp', { quality: 76 }]]) {
        const out = path.join(OUT_DIR, `${base}-${w}.${fmt}`);
        const fresh = existsSync(out) && (await stat(out)).mtimeMs > srcTime;
        if (!fresh) {
          await source().resize({ width: w, withoutEnlargement: true })[fmt](opts).toFile(out);
        }
        variants.push({ w, fmt, path: out.replace(/^public\//, '') });
      }
    }

    /* The plain <img> underneath the modern formats points at the file on disk,
       which for an upload is the untreated one. A browser old enough to need it
       would otherwise be the only one shown an ungraded photograph, so a treated
       JPEG is written for it to use instead. */
    let fallback = null;
    if (graded) {
      const out = path.join(OUT_DIR, `${base}-plain.jpg`);
      const fresh = existsSync(out) && (await stat(out)).mtimeMs > srcTime;
      if (!fresh) await source().jpeg({ quality: 82, mozjpeg: true }).toFile(out);
      fallback = out.replace(/^public\//, '');
    }

    manifest[key] = { width: w0, height: h0, variants, ...(fallback && { fallback }) };
  }
}

await writeFile('src/data/images.json', JSON.stringify(manifest, null, 2));
const n = Object.keys(manifest).length;
const files = Object.values(manifest).reduce((a, m) => a + m.variants.length, 0);
const g = Object.values(manifest).filter((m) => m.fallback).length;
console.log(`images: ${n} source photograph${n === 1 ? '' : 's'} → ${files} derivatives` + (g ? `, ${g} given the house look` : ''));
