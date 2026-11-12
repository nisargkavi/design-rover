import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import { unified } from '@astrojs/markdown-remark'
import markdownLinks from './plugins/markdown-links.mjs'

const site = process.env.DOCS_SITE ?? 'https://nisargkavi.github.io'
const base = process.env.DOCS_BASE ?? '/design-rover'

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  markdown: { processor: unified({ remarkPlugins: [[markdownLinks, { base }]] }) },
  integrations: [starlight({
    title: 'Design Rover',
    description: 'Give coding agents context about your existing React components, design tokens and UI conventions.',
    logo: { src: '../../assets/brand/icon.svg', alt: '', replacesTitle: false },
    favicon: '/favicon.svg',
    social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/nisargkavi/design-rover' }],
    customCss: ['./src/styles/custom.css'],
    editLink: { baseUrl: 'https://github.com/nisargkavi/design-rover/edit/main/' },
    routeMiddleware: './src/route-data.ts',
    components: { PageTitle: './src/components/AgentLinks.astro' },
    sidebar: [
      { label: 'Overview', slug: '' },
      { label: 'Quick start', slug: 'guides/quickstart' },
      { label: 'Workflows', items: [
        { label: 'Review and approvals', slug: 'guides/review' },
        { label: 'Context for agents', slug: 'guides/context' },
        { label: 'Live updates', slug: 'guides/watch' },
        { label: 'Connect MCP', slug: 'guides/mcp' },
        { label: 'Checks and CI', slug: 'guides/ci' },
        { label: 'Git tracking', slug: 'guides/git-tracking' },
      ] },
      { label: 'Reference', items: [
        { label: 'CLI commands', slug: 'reference/cli' },
        { label: 'Knowledge model', slug: 'reference/model' },
        { label: 'Support and limits', slug: 'reference/limits' },
      ] },
      { label: 'Project', items: [
        { label: 'Troubleshooting', slug: 'guides/troubleshooting' },
        { label: 'Contributing', slug: 'guides/contributing' },
        { label: 'Releases', link: 'https://github.com/nisargkavi/design-rover/releases' },
      ] },
    ],
  })],
})
