import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const output = fileURLToPath(new URL('../apps/docs/dist/', import.meta.url))
const repository = fileURLToPath(new URL('../', import.meta.url))
const base = (process.env.DOCS_BASE ?? '/design-rover').replace(/\/+$/, '')
const site = new URL(process.env.DOCS_SITE ?? 'https://nisargkavi.github.io')
const docsRequire = createRequire(new URL('../apps/docs/package.json', import.meta.url))
const { unified } = await import(pathToFileURL(docsRequire.resolve('unified')).href)
const { default: remarkParse } = await import(pathToFileURL(docsRequire.resolve('remark-parse')).href)
const parser = unified().use(remarkParse)
const files = (await fs.readdir(output, { recursive: true })).map((file) => file.replaceAll(path.sep, '/'))
const htmlFiles = files.filter((file) => file.endsWith('.html'))
const pages = htmlFiles.filter((file) => file !== '404.html')
assert(pages.length > 0 && files.includes('404.html'), 'Expected documentation routes and a 404 page')
const failures = []
const contentCache = new Map()
const expectedExports = new Set()
const documentBodies = []
let checked = 0
let markdownLinks = 0

function decodeHtml(value) {
  return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>')
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [match[1], decodeHtml(match[2] ?? match[3])]))
}

function walk(node, visit) {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

function linksIn(tree) {
  const links = []
  walk(tree, (node) => {
    if (['link', 'image', 'definition'].includes(node.type)) links.push(node.url)
  })
  return links
}

// Compare words, headings and exact examples, independent of Markdown formatting
// chosen by the serializer. URL correctness is checked separately below.
function semantics(tree) {
  const tokens = []
  walk(tree, (node) => {
    if (node.type === 'heading') tokens.push(['heading', node.depth])
    if (node.type === 'text') tokens.push(['text', node.value.replace(/\s+/g, ' ')])
    if (node.type === 'inlineCode') tokens.push(['inlineCode', node.value])
    if (node.type === 'code') tokens.push(['code', node.lang ?? null, node.meta ?? null, node.value])
    if (node.type === 'image') tokens.push(['image', node.alt ?? ''])
    if (node.type === 'html') tokens.push(['html', node.value])
  })
  return tokens.map((token) => JSON.stringify(token))
}

async function read(file) {
  if (!contentCache.has(file)) contentCache.set(file, await fs.readFile(path.join(output, file), 'utf8'))
  return contentCache.get(file)
}

async function checkDestination(attribute, current, file, { markdown = false } = {}) {
  if (!attribute || /^(?:data:|javascript:|mailto:|tel:)/i.test(attribute)) return
  let url
  try { url = new URL(attribute, current) }
  catch {
    failures.push(`${file}: invalid URL ${attribute}`)
    return
  }
  if (url.origin !== site.origin) return
  // GitHub Pages serves 404.html at missing URLs, without a /404/ directory.
  if (file === '404.html' && url.pathname === `${base}/404/`) return
  checked++
  if (markdown) {
    markdownLinks++
    if (!/^https?:\/\//i.test(attribute)) failures.push(`${file}: exported local link must be absolute: ${attribute}`)
  }
  if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) {
    failures.push(`${file}: link escapes deployment base: ${attribute}`)
    return
  }
  let relative
  try { relative = decodeURIComponent(url.pathname.slice(base.length)).replace(/^\//, '') }
  catch {
    failures.push(`${file}: invalid URL encoding ${attribute}`)
    return
  }
  try {
    let target = relative
    if ((await fs.stat(path.join(output, target))).isDirectory()) target = path.posix.join(target, 'index.html')
    const text = await read(target)
    if (url.hash && target.endsWith('.html')) {
      const id = decodeURIComponent(url.hash.slice(1))
      if (![...text.matchAll(/\bid="([^"<>]*)"/g)].some((item) => decodeHtml(item[1]) === id)) failures.push(`${file}: missing anchor ${attribute}`)
    }
  } catch { failures.push(`${file}: missing local destination ${attribute}`) }
}

for (const file of htmlFiles) {
  const html = await read(file)
  const route = file.replace(/index\.html$/, '')
  const current = new URL(`${base}/${route}`, site)
  for (const match of html.matchAll(/\b(?:href|src)="([^"<>]*)"/g)) {
    await checkDestination(decodeHtml(match[1]), current, file)
  }
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? ''
  const headLinks = [...head.matchAll(/<link\b[^>]*>/g)].map((match) => attributes(match[0]))
  const describedby = headLinks.filter((link) => link.rel?.split(/\s+/).includes('describedby'))
  const alternates = headLinks.filter((link) => link.rel?.split(/\s+/).includes('alternate') && link.type === 'text/markdown')
  const visibleLinks = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    href: attributes(match[1]).href,
    label: decodeHtml(match[2].replace(/<[^>]*>/g, '')).trim(),
  }))
  if (file === '404.html') {
    if (describedby.length || alternates.length) failures.push(`${file}: error page must not advertise document exports`)
    if (visibleLinks.some((link) => ['Markdown', 'For agents'].includes(link.label))) failures.push(`${file}: error page must not display document format actions`)
    continue
  }

  const exportFile = file.replace(/index\.html$/, 'index.md')
  expectedExports.add(exportFile)
  if (!files.includes(exportFile)) failures.push(`${file}: missing page Markdown export ${exportFile}`)
  const expectedMarkdown = new URL(`${base}/${exportFile}`, site).href
  const expectedIndex = new URL(`${base}/llms.txt`, site).href
  if (describedby.length !== 1 || new URL(describedby[0]?.href ?? '', current).href !== expectedIndex) failures.push(`${file}: missing or incorrect llms.txt discovery link`)
  if (alternates.length !== 1 || new URL(alternates[0]?.href ?? '', current).href !== expectedMarkdown) failures.push(`${file}: missing or incorrect Markdown alternate`)
  for (const [label, target] of [['Markdown', expectedMarkdown], ['For agents', expectedIndex]]) {
    if (!visibleLinks.some((link) => link.href && new URL(link.href, current).href === target && link.label === label)) failures.push(`${file}: missing visible ${label} page action`)
  }

  const canonical = headLinks.filter((link) => link.rel === 'canonical')
  if (canonical.length !== 1 || canonical[0].href !== current.href) failures.push(`${file}: incorrect canonical HTML URL`)
  const edit = html.match(/https:\/\/github\.com\/nisargkavi\/design-rover\/edit\/main\/([^"<>]+)/)
  if (!edit || !edit[1].startsWith('docs/')) {
    failures.push(`${file}: edit link must point to canonical docs/ source`)
    continue
  }
  let source
  try { source = await fs.readFile(path.join(repository, decodeHtml(edit[1])), 'utf8') }
  catch {
    failures.push(`${file}: edit link source does not exist: ${edit[1]}`)
    continue
  }
  if (!files.includes(exportFile)) continue
  const exported = await read(exportFile)
  if (/^---(?:\r?\n|$)/.test(exported) || /<!doctype\s+html|<html\b/i.test(exported)) failures.push(`${exportFile}: expected Markdown without frontmatter or an HTML wrapper`)
  const exportedTree = parser.parse(exported)
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  const sourceTree = parser.parse(body)
  const sourceSemantics = semantics(sourceTree)
  const exportedSemantics = semantics(exportedTree)
  const exportedBody = sourceSemantics.length ? exportedSemantics.slice(-sourceSemantics.length) : []
  if (JSON.stringify(exportedBody) !== JSON.stringify(sourceSemantics)) failures.push(`${exportFile}: canonical source content or code examples changed in the export`)
  const title = source.match(/^title:\s*(.+)$/m)?.[1]?.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2')
  const heading = exportedTree.children[0]
  if (heading?.type !== 'heading' || heading.depth !== 1 || heading.children.map((node) => node.value ?? '').join('') !== title) failures.push(`${exportFile}: missing source title as the first H1`)
  const sourceUrl = `https://github.com/nisargkavi/design-rover/blob/main/${decodeHtml(edit[1])}`
  const exportLinks = linksIn(exportedTree)
  for (const [name, expected] of [['canonical HTML', current.href], ['canonical source', sourceUrl], ['documentation index', expectedIndex]]) {
    if (!exportLinks.includes(expected)) failures.push(`${exportFile}: missing ${name} provenance link ${expected}`)
  }
  documentBodies.push({ file: exportFile, source: decodeHtml(edit[1]), sourceLinks: linksIn(sourceTree), exportLinks, tokens: sourceSemantics, canonical: current.href })
}

// Assert link meaning as well as reachability: another valid page must not be
// substituted for the page linked by the canonical source.
const canonicalSources = new Map(documentBodies.map((document) => [document.source, document.canonical]))
for (const document of documentBodies) {
  const bodyLinks = document.exportLinks.slice(-document.sourceLinks.length)
  if (document.sourceLinks.length === 0) continue
  for (let index = 0; index < document.sourceLinks.length; index++) {
    const original = document.sourceLinks[index]
    let expected = original
    if (original.startsWith('#')) expected = new URL(original, document.canonical).href
    else if (!/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(original)) {
      const sourceTarget = new URL(original, `https://source.invalid/${document.source}`)
      const canonicalTarget = canonicalSources.get(decodeURIComponent(sourceTarget.pathname.slice(1)))
      if (canonicalTarget) {
        const target = new URL(canonicalTarget)
        target.search = sourceTarget.search
        target.hash = sourceTarget.hash
        expected = target.href
      } else continue // Repo assets and unsupported source routes are covered by helper tests.
    } else if (original.startsWith('/')) expected = new URL(original, site).href
    if (bodyLinks[index] !== expected) failures.push(`${document.file}: source link ${original} changed meaning: ${bodyLinks[index]}`)
  }
}

for (const file of ['llms.txt', 'llms-full.txt', 'sitemap-index.xml']) assert(files.includes(file), `Missing ${file}`)
const markdownFiles = files.filter((file) => file.endsWith('.md'))
for (const file of markdownFiles) {
  if (!expectedExports.has(file)) failures.push(`${file}: unexpected Markdown export without a canonical documentation page`)
}
assert(!files.includes('404.md') && !files.includes('404/index.md'), '404 pages must not have Markdown exports')
const index = await read('llms.txt')
const indexTree = parser.parse(index)
const indexLinks = linksIn(indexTree)
for (const section of ['Start here', 'Workflows', 'Reference', 'Optional']) {
  if (!indexTree.children.some((node) => node.type === 'heading' && node.depth === 2 && node.children.map((child) => child.value ?? '').join('') === section)) failures.push(`llms.txt: missing curated ${section} section`)
}
for (const file of expectedExports) {
  if (!indexLinks.includes(new URL(`${base}/${file}`, site).href)) failures.push(`llms.txt: missing page export ${file}`)
}
for (const url of [new URL(`${base}/llms-full.txt`, site).href, 'https://github.com/nisargkavi/design-rover', 'https://www.npmjs.com/package/design-rover']) {
  if (!indexLinks.includes(url)) failures.push(`llms.txt: missing ${url}`)
}
const llms = await read('llms-full.txt')
const fullTree = parser.parse(llms)
const fullSemantics = semantics(fullTree).join('\n')
const fullLinks = linksIn(fullTree)
for (const document of documentBodies) {
  if (!fullSemantics.includes(document.tokens.join('\n'))) failures.push(`llms-full.txt: missing or changed canonical content for ${document.file}`)
  if (!fullLinks.includes(document.canonical)) failures.push(`llms-full.txt: missing canonical URL for ${document.file}`)
}
assert(llms.includes('bunx design-rover watch') && llms.includes('checkFreshness'), 'Agent documentation must contain current workflows')
for (const file of [...markdownFiles, 'llms.txt', 'llms-full.txt']) {
  const text = await read(file)
  for (const url of linksIn(parser.parse(text))) await checkDestination(url, new URL(`${base}/${file}`, site), file, { markdown: true })
}
assert(files.some((file) => file.includes('pagefind') && file.endsWith('.js')), 'Missing built search index')
assert.equal(failures.length, 0, failures.join('\n'))
console.log(`Verified ${pages.length} documentation pages and Markdown exports, 404, ${checked} internal links/assets (${markdownLinks} in Markdown), source parity and provenance, discovery links, search and sitemap.`)
