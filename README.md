# Stafford Tyrrell

Expedition site. Static site built with [Astro](https://astro.build), edited
through [Sveltia CMS](https://github.com/sveltia/sveltia-cms) at `/admin`.

## For Stafford — editing the site

1. Go to **yoursite.com/admin**
2. Sign in with GitHub
3. Change what you like and press **Save**

The site rebuilds itself within a minute or so. Nothing can be permanently
broken: every save is a commit, so any change can be undone.

What you can edit:

| Section | Where |
|---|---|
| Expeditions — add, remove, reorder, change photographs | **Expeditions** |
| Journal entries | **Journal** |
| Everything else — the name, the numbers, the boat, the About text, sponsors, the "At sea now" bar | **The rest of the page** |

Two things worth knowing:

- **"Position on the page"** on an expedition decides the order. Lower numbers
  come first. They go 10, 20, 30 so there is room to slot a new trip between
  two existing ones without renumbering everything.
- **The "At sea now" bar** has a *Show the bar* switch. Turn it off when he is
  home, rather than deleting the text.

## For a developer

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # → dist/
```

- Content: `src/content/expeditions/*.md`, `src/content/journal/*.md`,
  `src/data/site.json`
- Schemas (what fields exist, and their types): `src/content.config.ts`
- CMS fields shown to the editor: `public/admin/config.yml` — **keep these two
  in step**; the schema validates at build time, so a mismatch fails the build
  rather than shipping a broken page
- Styles: `src/styles/site.css`
- Photographs: `public/images/` — `light/` holds the graded set the site uses,
  `_originals/` the untouched files

### Photograph grading

Every photograph is graded to one recipe so a mix of phone snaps, camera
frames and drone stills reads as one body of work: cool shadows, warm
highlights, saturation pulled back, a gentle S-curve in linear light, near-true
blacks and an open white point. `scripts/` holds the grading code used; rerun it
over new files in `_originals/` to keep new photographs consistent.

### Deploying

Any static host. Netlify or Vercel, pointed at this repo:

- Build command: `npm run build`
- Publish directory: `dist`

The admin screen needs an OAuth backend to talk to GitHub. On Netlify, enable
its GitHub OAuth provider; elsewhere, Sveltia's docs cover the alternatives.
