import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/* Expeditions. `order` decides where an entry sits on the page — lowest
   first — so Stafford can promote a trip without renaming files. */
const expeditions = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/expeditions' }),
  schema: z.object({
    title: z.string(),
    order: z.number().default(50),
    latitude: z.string(),                 // shown large, e.g. "82°N"
    stampTop: z.string().default(''),     // small note beside the latitude
    stampBottom: z.string().default(''),
    meta: z.array(z.string()).default([]),
    photo: z.string(),
    photoPosition: z.string().default('center center'),
    photoAlt: z.string(),
    patch: z.string().optional(),
    patchAlt: z.string().default(''),
    note: z.string().optional(),          // the grey route panel
    flip: z.boolean().default(false),     // photograph on the right
    draft: z.boolean().default(false),
  }),
});

const journal = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/journal' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date().optional(),
    tag: z.string().default('Draft'),
    order: z.number().default(50),        // tiebreaker when there is no date
    summary: z.string(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { expeditions, journal };
