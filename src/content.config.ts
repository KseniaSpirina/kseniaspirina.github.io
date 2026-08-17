import { defineCollection, z } from 'astro:content';

const projects = defineCollection({
  type: 'content',
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
