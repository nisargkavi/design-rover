import path from 'node:path'

// Keep source links useful on GitHub, then resolve them to deployed docs routes.
export default function markdownLinks({ base = '' } = {}) {
  return (tree, file) => {
    const source = String(file.path).replaceAll('\\', '/')
    const marker = source.lastIndexOf('/docs/')
    if (marker < 0) return
    const relative = source.slice(marker + '/docs/'.length)
    const prefix = `/${base.split('/').filter(Boolean).join('/')}`.replace(/\/$/, '')
    function visit(node) {
      if ((node.type === 'link' || node.type === 'definition') && typeof node.url === 'string' && !/^(?:[a-z]+:|\/|#)/i.test(node.url)) {
        const match = node.url.match(/^([^?#]+)\.md([?#].*)?$/)
        if (match) {
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), `${match[1]}.md`))
          if (target === 'index.md' || /^(guides|reference)\/[^/]+\.md$/.test(target)) {
            const route = target === 'index.md' ? '' : target.slice(0, -3)
            node.url = `${prefix}/${route}${route ? '/' : ''}${match[2] ?? ''}`
          }
        }
      }
      for (const child of node.children ?? []) visit(child)
    }
    visit(tree)
  }
}
