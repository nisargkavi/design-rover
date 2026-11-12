import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const output = fileURLToPath(new URL('../apps/docs/dist/', import.meta.url))
const base = (process.env.DOCS_BASE ?? '/design-rover').replace(/\/$/, '')
const origin = process.env.DOCS_SITE ?? 'https://nisargkavi.github.io'
const files = await fs.readdir(output, { recursive: true })
const htmlFiles = files.filter((file) => file.endsWith('.html'))
assert(htmlFiles.length >= 14, 'Expected the documentation routes and 404 page')
const failures = []
let checked = 0
for (const file of htmlFiles) {
  const html = await fs.readFile(path.join(output, file), 'utf8')
  const current = new URL(`${base}/${file.replaceAll(path.sep, '/').replace(/index\.html$/, '')}`, origin)
  for (const match of html.matchAll(/\b(?:href|src)="([^"<>]*)"/g)) {
    const attribute = match[1].replaceAll('&amp;', '&')
    if (!attribute || /^(?:data:|javascript:|mailto:|tel:)/i.test(attribute)) continue
    const url = new URL(attribute, current)
    if (url.origin !== new URL(origin).origin) continue
    // GitHub Pages serves 404.html at missing URLs, without a /404/ directory.
    if (file === '404.html' && url.pathname === `${base}/404/`) continue
    checked++
    if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) {
      failures.push(`${file}: link escapes deployment base: ${attribute}`)
      continue
    }
    const relative = decodeURIComponent(url.pathname.slice(base.length)).replace(/^\//, '')
    let target = path.join(output, relative)
    try {
      if ((await fs.stat(target)).isDirectory()) target = path.join(target, 'index.html')
      const text = await fs.readFile(target, 'utf8')
      if (url.hash && target.endsWith('.html')) {
        const id = decodeURIComponent(url.hash.slice(1))
        if (![...text.matchAll(/\bid="([^"<>]*)"/g)].some((item) => item[1] === id)) failures.push(`${file}: missing anchor ${attribute}`)
      }
    } catch { failures.push(`${file}: missing local destination ${attribute}`) }
  }
  const edit = html.match(/https:\/\/github\.com\/nisargkavi\/design-rover\/edit\/main\/([^"<>]+)/)
  if (file !== '404.html' && (!edit || !edit[1].startsWith('docs/'))) failures.push(`${file}: edit link must point to canonical docs/ source`)
  if (edit) {
    try { await fs.access(fileURLToPath(new URL(`../${edit[1]}`, import.meta.url))) }
    catch { failures.push(`${file}: edit link source does not exist: ${edit[1]}`) }
  }
}
for (const file of ['llms.txt', 'llms-full.txt', 'sitemap-index.xml']) assert(files.includes(file), `Missing ${file}`)
const llms = await fs.readFile(path.join(output, 'llms-full.txt'), 'utf8')
assert(llms.includes('bunx design-rover watch') && llms.includes('checkFreshness'), 'Agent documentation must contain current workflows')
assert(files.some((file) => file.includes('pagefind') && file.endsWith('.js')), 'Missing built search index')
assert.equal(failures.length, 0, failures.join('\n'))
console.log(`Verified ${htmlFiles.length} documentation pages, ${checked} internal links/assets, source edit links, search, sitemap and agent text exports.`)
