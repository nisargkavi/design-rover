import { getCollection } from 'astro:content'
import type { APIRoute } from 'astro'

export const GET: APIRoute = async ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const entries = (await getCollection('docs')).filter((entry) => entry.id !== '404').sort((a, b) => a.id.localeCompare(b.id))
  const lines = [
    '# Design Rover',
    '',
    '> Local design knowledge for React/TypeScript projects and coding agents.',
    '',
    'Observed components and tokens are evidence. Inferred rules require explicit approval. Watch refreshes observed inventory; approved contracts and human decisions require review. Context checks freshness by default.',
    '',
    '## Documentation',
    `- [Full documentation as text](${new URL(`${base}/llms-full.txt`, site)})`,
    ...entries.map((entry) => `- [${entry.data.title}](${new URL(`${base}/${entry.id === 'index' ? '' : `${entry.id}/`}`, site)}): ${entry.data.description ?? ''}`),
    '',
    '## Source',
    '- [GitHub](https://github.com/nisargkavi/design-rover)',
    '- [npm](https://www.npmjs.com/package/design-rover)',
    '',
  ]
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
