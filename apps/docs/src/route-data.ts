import { defineRouteMiddleware } from '@astrojs/starlight/route-data'

// The content collection lives at the repository root, outside this Astro app.
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute
  route.editUrl = route.entry.id === '404'
    ? undefined
    : new URL(`https://github.com/nisargkavi/design-rover/edit/main/docs/${route.entry.id || 'index'}.md`)
})
