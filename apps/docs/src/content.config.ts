import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { docsSchema } from '@astrojs/starlight/schema'

export const collections = {
  docs: defineCollection({
    loader: glob({ base: '../../docs', pattern: ['index.md', '404.md', 'guides/*.md', 'reference/*.md'] }),
    schema: docsSchema(),
  }),
}
