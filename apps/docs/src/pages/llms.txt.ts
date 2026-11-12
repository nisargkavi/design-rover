import { getCollection } from 'astro:content'
import type { APIRoute } from 'astro'
import { absoluteMarkdownUrl, indexPath } from '../lib/documents.mjs'

const sections = [
  { title: 'Start here', ids: ['index', 'guides/quickstart'] },
  { title: 'Workflows', ids: [
    'guides/review',
    'guides/context',
    'guides/watch',
    'guides/mcp',
    'guides/ci',
    'guides/git-tracking',
  ] },
  { title: 'Reference', ids: ['reference/cli', 'reference/model', 'reference/limits'] },
]
const optionalIds = ['guides/troubleshooting', 'guides/contributing']

export const GET: APIRoute = async ({ site }) => {
  const base = import.meta.env.BASE_URL
  const entries = (await getCollection('docs')).filter((entry) => entry.id !== '404').sort((a, b) => a.id.localeCompare(b.id))
  const byId = new Map(entries.map((entry) => [entry.id || 'index', entry]))
  const listed = new Set([...sections.flatMap((section) => section.ids), ...optionalIds])
  const otherIds = [...byId.keys()].filter((id) => !listed.has(id))
  const entryLine = (id: string) => {
    const entry = byId.get(id)
    if (!entry) throw new Error(`Missing documentation page in llms.txt: ${id}`)
    const description = entry.data.description ? `: ${entry.data.description}` : ''
    return `- [${entry.data.title}](${absoluteMarkdownUrl(id, { site, base })})${description}`
  }
  const lines = [
    '# Design Rover',
    '',
    '> Local design knowledge for React/TypeScript projects and coding agents.',
    '',
    'Design Rover is a local CLI and MCP server that helps coding agents reuse existing components, scoped design tokens and UI conventions. The links below provide Markdown documentation without site navigation.',
    '',
    'Observed inventory is evidence. Inferred rules stay pending until explicitly approved. Watch refreshes observations; changed reviewed contracts and human decisions still require review. Context checks freshness by default.',
    '',
    ...sections.flatMap((section) => [
      `## ${section.title}`,
      '',
      ...section.ids.map(entryLine),
      '',
    ]),
    // Keep future pages discoverable even before their section is curated.
    ...(otherIds.length ? ['## Other documentation', '', ...otherIds.map(entryLine), ''] : []),
    '## Optional',
    '',
    ...optionalIds.map(entryLine),
    `- [Full documentation as text](${new URL(indexPath(base).replace(/llms\.txt$/, 'llms-full.txt'), site)}): All documentation in one text export.`,
    '- [GitHub](https://github.com/nisargkavi/design-rover): Source, issues and releases.',
    '- [npm](https://www.npmjs.com/package/design-rover): Published CLI package.',
    '',
  ]
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
