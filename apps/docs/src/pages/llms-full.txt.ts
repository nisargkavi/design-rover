import { getCollection } from 'astro:content'
import type { APIRoute } from 'astro'
import { exportDocument } from '../lib/documents.mjs'

export const GET: APIRoute = async ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const entries = (await getCollection('docs')).filter((entry) => entry.id !== '404').sort((a, b) => a.id.localeCompare(b.id))
  const sections = await Promise.all(entries.map((entry) => exportDocument(entry, { site, base })))
  return new Response(`${sections.join('\n\n---\n\n')}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
