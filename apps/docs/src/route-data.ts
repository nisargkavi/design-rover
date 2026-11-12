import { defineRouteMiddleware } from '@astrojs/starlight/route-data'
import { absoluteMarkdownUrl, indexPath } from './lib/documents.mjs'

// The content collection lives at the repository root, outside this Astro app.
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute
  route.editUrl = route.entry.id === '404'
    ? undefined
    : new URL(`https://github.com/nisargkavi/design-rover/edit/main/docs/${route.entry.id || 'index'}.md`)

  if (route.entry.id === '404') return

  const base = import.meta.env.BASE_URL
  route.head.push(
    { tag: 'link', attrs: { rel: 'describedby', href: new URL(indexPath(base), context.site).href } },
    { tag: 'link', attrs: {
      rel: 'alternate',
      type: 'text/markdown',
      href: absoluteMarkdownUrl(route.entry.id, { site: context.site, base }),
    } },
  )
})
