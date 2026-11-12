import path from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { toMarkdown } from 'mdast-util-to-markdown'

const defaultSite = 'https://nisargkavi.github.io'
const defaultBase = '/design-rover'
const sourceBase = 'https://github.com/nisargkavi/design-rover/blob/main/'
const imageBase = 'https://raw.githubusercontent.com/nisargkavi/design-rover/main/'
const parser = unified().use(remarkParse)

/** @typedef {{ site?: string | URL, base?: string }} Deployment */

function documentId(id) {
  return id || 'index'
}

function prefix(base) {
  return `/${base.split('/').filter(Boolean).join('/')}`.replace(/\/$/, '')
}

export function htmlPath(id, base = defaultBase) {
  const route = documentId(id) === 'index' ? '' : `${id}/`
  return `${prefix(base)}/${route}`
}

export function markdownPath(id, base = defaultBase) {
  return `${htmlPath(id, base)}index.md`
}

export function indexPath(base = defaultBase) {
  return `${prefix(base)}/llms.txt`
}

/** @param {string} id @param {Deployment} [options] */
export function absoluteHtmlUrl(id, { site = defaultSite, base = defaultBase } = {}) {
  return new URL(htmlPath(id, base), site).href
}

/** @param {string} id @param {Deployment} [options] */
export function absoluteMarkdownUrl(id, { site = defaultSite, base = defaultBase } = {}) {
  return new URL(markdownPath(id, base), site).href
}

function destination(url, id, options, image = false) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return url
  if (url.startsWith('/')) return new URL(url, options.site ?? defaultSite).href
  if (url.startsWith('#') || url.startsWith('?')) return new URL(url, absoluteHtmlUrl(id, options)).href

  const [, pathname, suffix = ''] = url.match(/^([^?#]*)([?#].*)?$/) ?? []
  if (!pathname) return url
  const source = path.posix.normalize(path.posix.join('docs', path.posix.dirname(`${documentId(id)}.md`), pathname))
  // These are the published content families. Repository-only files stay source links.
  if (!image && (source === 'docs/index.md' || /^docs\/(guides|reference)\/[^/]+\.md$/.test(source))) {
    const target = source.slice('docs/'.length, -3)
    return `${absoluteHtmlUrl(target, options)}${suffix}`
  }
  return new URL(source + suffix, image ? imageBase : sourceBase).href
}

/** Export source Markdown without rewriting code examples or surrounding prose. */
export async function normalizeMarkdown(body, id, options = {}) {
  const tree = parser.parse(body)
  const edits = []
  const imageReferences = new Set()
  function findImageReferences(node) {
    if (node.type === 'imageReference') imageReferences.add(node.identifier)
    for (const child of node.children ?? []) findImageReferences(child)
  }
  findImageReferences(tree)
  // Reference definitions are document-scoped, even when several exports are combined.
  const namespace = `dr-${Buffer.from(documentId(id)).toString('hex')}-`
  const editable = new Set(['link', 'image', 'definition', 'linkReference', 'imageReference'])

  function rewrite(node) {
    let changed = false
    if (['link', 'image', 'definition'].includes(node.type)) {
      const url = destination(node.url, id, options, node.type === 'image' || (node.type === 'definition' && imageReferences.has(node.identifier)))
      changed = url !== node.url
      node.url = url
    }
    if (['definition', 'linkReference', 'imageReference'].includes(node.type)) {
      node.identifier = namespace + node.identifier
      node.label = node.identifier
      if (node.referenceType) node.referenceType = 'full'
      changed = true
    }
    for (const child of node.children ?? []) changed = rewrite(child) || changed
    return changed
  }

  function visit(node) {
    if (editable.has(node.type)) {
      const copy = structuredClone(node)
      if (rewrite(copy)) {
        const root = { type: 'root', children: [copy.type === 'definition' ? copy : { type: 'paragraph', children: [copy] }] }
        edits.push({ start: node.position.start.offset, end: node.position.end.offset, text: toMarkdown(root).replace(/\n$/, '') })
      }
      return
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  let output = body
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end)
  }
  return output
}

export async function exportDocument(entry, options = {}) {
  return [
    `# ${entry.data.title}`,
    '',
    ...(entry.data.description ? [entry.data.description, ''] : []),
    `[Canonical documentation](${absoluteHtmlUrl(entry.id, options)})`,
    `[Documentation index](${new URL(indexPath(options.base ?? defaultBase), options.site ?? defaultSite).href})`,
    `[Markdown source](${sourceBase}docs/${documentId(entry.id)}.md)`,
    '',
    await normalizeMarkdown(entry.body ?? '', entry.id, options),
  ].join('\n').replace(/\n*$/, '\n')
}
