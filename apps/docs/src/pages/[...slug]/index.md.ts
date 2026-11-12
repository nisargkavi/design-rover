import { getCollection } from 'astro:content'
import type { APIRoute, GetStaticPaths } from 'astro'
import { exportDocument } from '../../lib/documents.mjs'

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = (await getCollection('docs')).filter((entry) => entry.id !== '404')
  return entries.map((entry) => ({
    params: { slug: entry.id === 'index' || !entry.id ? undefined : entry.id },
    props: { entry },
  }))
}

export const GET: APIRoute = async ({ props, site }) => new Response(
  await exportDocument(props.entry, { site, base: import.meta.env.BASE_URL }),
  { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } },
)
