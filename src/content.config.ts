import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      date: z.date(),
      tags: z.array(z.string()),
      role: z.string().optional(),
      tools: z.array(z.string()).optional(),
      cover: image(),
      featured: z.boolean().default(false),
      order: z.number().default(0),
      externalUrl: z.string().url().optional(),
    }),
});

export const collections = { projects };
