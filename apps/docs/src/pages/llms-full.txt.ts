import { getCollection } from 'astro:content'
import type { APIRoute } from 'astro'

export const GET: APIRoute = async ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const entries = (await getCollection('docs')).filter((entry) => entry.id !== '404').sort((a, b) => a.id.localeCompare(b.id))
  const sections = entries.map((entry) => [
    `# ${entry.data.title}`,
    `Documentation: ${new URL(`${base}/${entry.id === 'index' ? '' : `${entry.id}/`}`, site)}`,
    `Markdown source: https://github.com/nisargkavi/design-rover/blob/main/docs/${entry.id}.md`,
    '',
    entry.body ?? '',
  ].join('\n'))
  return new Response(`${sections.join('\n\n---\n\n')}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
