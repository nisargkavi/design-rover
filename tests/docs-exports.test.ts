import { describe, expect, it } from "vitest"
import {
  absoluteHtmlUrl,
  absoluteMarkdownUrl,
  exportDocument,
  htmlPath,
  indexPath,
  markdownPath,
  normalizeMarkdown,
} from "../apps/docs/src/lib/documents.mjs"

const deployment = { site: "https://nisargkavi.github.io", base: "/design-rover" }

describe("documentation export routes", () => {
  it("uses the same overview route for an empty id and index without duplicating the base", () => {
    for (const id of ["", "index"]) {
      expect(htmlPath(id, "/design-rover")).toBe("/design-rover/")
      expect(markdownPath(id, "/design-rover")).toBe("/design-rover/index.md")
      expect(absoluteHtmlUrl(id, deployment)).toBe("https://nisargkavi.github.io/design-rover/")
      expect(absoluteMarkdownUrl(id, deployment)).toBe("https://nisargkavi.github.io/design-rover/index.md")
    }
    expect(indexPath("/design-rover")).toBe("/design-rover/llms.txt")
  })

  it("keeps nested page alternates next to the HTML page on root and subpath deployments", () => {
    for (const base of ["", "/", "/design-rover", "/design-rover/"]) {
      const prefix = base.replace(/\/$/, "")
      expect(htmlPath("guides/watch", base)).toBe(`${prefix}/guides/watch/`)
      expect(markdownPath("guides/watch", base)).toBe(`${prefix}/guides/watch/index.md`)
      expect(indexPath(base)).toBe(`${prefix}/llms.txt`)
    }
    expect(absoluteMarkdownUrl("reference/cli", { site: "https://docs.example.com", base: "" }))
      .toBe("https://docs.example.com/reference/cli/index.md")
  })
})

describe("documentation Markdown links", () => {
  it("resolves source-relative guide, reference and overview destinations to canonical HTML", async () => {
    const body = [
      "[Review](review.md#accept-a-decision)",
      "[CLI](../reference/cli.md?view=compact#watch-for-live-updates)",
      "[Overview](../index.md)",
    ].join("\n\n")
    const output = await normalizeMarkdown(body, "guides/watch", deployment)
    expect(output).toContain("https://nisargkavi.github.io/design-rover/guides/review/#accept-a-decision")
    expect(output).toContain("https://nisargkavi.github.io/design-rover/reference/cli/?view=compact#watch-for-live-updates")
    expect(output).toContain("[Overview](https://nisargkavi.github.io/design-rover/)")
    expect(output).not.toContain("](review.md")
  })

  it("resolves local fragments against the originating document rather than the aggregate export", async () => {
    const output = await normalizeMarkdown("[Details](#configure-polling-and-guidance)", "guides/watch", deployment)
    expect(output).toContain("https://nisargkavi.github.io/design-rover/guides/watch/#configure-polling-and-guidance")
    expect(output).not.toContain("](#")
  })

  it("normalizes reference definitions and keeps reference-linked prose usable", async () => {
    const body = "Read [the review workflow][review].\n\n[review]: review.md#review-one-record \"Review decisions\"\n"
    const output = await normalizeMarkdown(body, "guides/context", deployment)
    const reference = output.match(/\[the review workflow\]\[([^\]]+)\]/)?.[1]
    expect(reference).toBeTruthy()
    expect(output).toContain("[" + reference + "]: https://nisargkavi.github.io/design-rover/guides/review/#review-one-record")
    expect(output).toContain("https://nisargkavi.github.io/design-rover/guides/review/#review-one-record")
    expect(output).toContain('"Review decisions"')
  })

  it("resolves repository-only links against their source instead of inventing published pages", async () => {
    const body = "[Development](../development.md#release-process)\n\n[Contributing](../../CONTRIBUTING.md#open-a-pull-request)\n"
    const output = await normalizeMarkdown(body, "guides/watch", deployment)
    expect(output).toContain("https://github.com/nisargkavi/design-rover/blob/main/docs/development.md#release-process")
    expect(output).toContain("https://github.com/nisargkavi/design-rover/blob/main/CONTRIBUTING.md#open-a-pull-request")
    expect(output).not.toContain("https://nisargkavi.github.io/design-rover/development/")
  })

  it("resolves local images to absolute raw source URLs without rewriting external images", async () => {
    const body = "![Brand](../../assets/brand/logo.svg?raw=1#logo)\n\n![Diagram](images/context.svg)\n\n![Remote](https://example.com/assets/logo.svg)\n"
    const output = await normalizeMarkdown(body, "guides/watch", deployment)
    expect(output).toContain("https://raw.githubusercontent.com/nisargkavi/design-rover/main/assets/brand/logo.svg?raw=1#logo")
    expect(output).toContain("https://raw.githubusercontent.com/nisargkavi/design-rover/main/docs/guides/images/context.svg")
    expect(output).toContain("![Remote](https://example.com/assets/logo.svg)")
  })

  it("resolves referenced images to raw URLs with a matching namespaced definition", async () => {
    const body = '![Brand mark][brand]\n\n[brand]: ../../assets/brand/logo.svg "Design Rover"\n'
    const output = await normalizeMarkdown(body, "guides/watch", deployment)
    const reference = output.match(/!\[Brand mark\]\[([^\]]+)\]/)?.[1]
    expect(reference).toBeTruthy()
    expect(output).toContain("[" + reference + ']: https://raw.githubusercontent.com/nisargkavi/design-rover/main/assets/brand/logo.svg "Design Rover"')
  })

  it("rewrites a linked image and its surrounding link without overlapping edits", async () => {
    const body = "Before.\n\n[![Brand](../../assets/brand/logo.svg)](review.md#review-one-record)\n\nAfter.\n"
    const output = await normalizeMarkdown(body, "guides/watch", deployment)
    expect(output).toBe("Before.\n\n[![Brand](https://raw.githubusercontent.com/nisargkavi/design-rover/main/assets/brand/logo.svg)](https://nisargkavi.github.io/design-rover/guides/review/#review-one-record)\n\nAfter.\n")
  })

  it("expands collapsed and shortcut references so their namespaced definitions still match", async () => {
    const body = "Read [Review][] or [Review].\n\n[Review]: review.md#review-one-record\n"
    const output = await normalizeMarkdown(body, "guides/watch", deployment)
    const references = [...output.matchAll(/\[Review\]\[([^\]]+)\]/g)].map((match) => match[1])
    expect(references).toHaveLength(2)
    expect(references[0]).toBe(references[1])
    expect(output).toContain("[" + references[0] + "]: https://nisargkavi.github.io/design-rover/guides/review/#review-one-record")
  })

  it("preserves external and protocol destinations", async () => {
    const destinations = [
      "https://example.com/docs/review.md?source=docs#notes",
      "//example.com/guide.md#notes",
      "mailto:maintainer@example.com",
      "https://github.com/nisargkavi/design-rover/blob/main/README.md",
    ]
    const output = await normalizeMarkdown(destinations.map((url, index) => `[Link ${index}](${url})`).join("\n\n"), "guides/watch", deployment)
    for (const destination of destinations) expect(output).toContain(destination)
  })

  it("retains encoded fragments and works under a different deployment base", async () => {
    const output = await normalizeMarkdown("[Section](review.md#r%C3%A8gles)\n", "guides/watch", { site: "https://docs.example.com", base: "/manual" })
    expect(output).toContain("https://docs.example.com/manual/guides/review/#r%C3%A8gles")
    expect(output).not.toContain("nisargkavi.github.io")
  })

  it("leaves code examples and inline code unchanged while rewriting actual links", async () => {
    const example = 'const source = "../reference/cli.md#watch";\nconst sample = "[Review](review.md)";'
    const body = `Use \`[Review](review.md)\` as a Markdown example.\n\n\`\`\`ts\n${example}\n\`\`\`\n\n[Real review link](review.md)\n`
    const output = await normalizeMarkdown(body, "guides/watch", deployment)
    expect(output).toContain("`[Review](review.md)`")
    expect(output).toContain(example)
    expect(output).toContain("[Real review link](https://nisargkavi.github.io/design-rover/guides/review/)")
    expect(output).toBe(body.replace("[Real review link](review.md)", "[Real review link](https://nisargkavi.github.io/design-rover/guides/review/)"))
  })
})

describe("per-page and combined documentation exports", () => {
  it("includes the page content and explicit canonical, source and discovery destinations", async () => {
    const entry = { id: "guides/watch", data: { title: "Live updates with watch", description: "Keep observed inventory current." }, body: "## Start\n\nbunx design-rover watch\n\n[Review](review.md)\n" }
    const output = await exportDocument(entry, deployment)
    expect(output).toMatch(/^# Live updates with watch\n/)
    expect(output).toContain("https://nisargkavi.github.io/design-rover/guides/watch/")
    expect(output).toContain("https://github.com/nisargkavi/design-rover/blob/main/docs/guides/watch.md")
    expect(output).toContain("https://nisargkavi.github.io/design-rover/llms.txt")
    expect(output).toContain("bunx design-rover watch")
    expect(output).toContain("https://nisargkavi.github.io/design-rover/guides/review/")
    expect(output).not.toContain("---\ntitle:")
  })

  it("keeps overview source links valid for both collection representations of the root", async () => {
    for (const id of ["", "index"]) {
      const output = await exportDocument({ id, data: { title: "Design Rover" }, body: "[Start](guides/quickstart.md)\n" }, deployment)
      expect(output).toContain("https://github.com/nisargkavi/design-rover/blob/main/docs/index.md")
      expect(output).not.toContain("/docs/.md")
      expect(output).toContain("https://nisargkavi.github.io/design-rover/guides/quickstart/")
    }
  })

  it("preserves each page's anchor context when exports are concatenated", async () => {
    const pages = ["guides/context", "guides/watch"]
    const output = (await Promise.all(pages.map((id) => exportDocument({ id, data: { title: id }, body: "## Details\n\n[More](#details)\n" }, deployment)))).join("\n---\n")
    for (const id of pages) expect(output).toContain(`https://nisargkavi.github.io/design-rover/${id}/#details`)
    expect(output).not.toContain("](#details)")
  })

  it("keeps same-named reference definitions independent across combined pages", async () => {
    const context = await exportDocument({ id: "guides/context", data: { title: "Context" }, body: "[Context details][details]\n\n[details]: #context-details\n" }, deployment)
    const watch = await exportDocument({ id: "guides/watch", data: { title: "Watch" }, body: "[Watch details][details]\n\n[details]: #watch-details\n" }, deployment)
    const contextReference = context.match(/\[Context details\]\[([^\]]+)\]/)?.[1]
    const watchReference = watch.match(/\[Watch details\]\[([^\]]+)\]/)?.[1]
    expect(contextReference).toBeTruthy()
    expect(watchReference).toBeTruthy()
    expect(contextReference).not.toBe(watchReference)
    const aggregate = context + "\n---\n" + watch
    expect(aggregate).toContain("[" + contextReference + "]: https://nisargkavi.github.io/design-rover/guides/context/#context-details")
    expect(aggregate).toContain("[" + watchReference + "]: https://nisargkavi.github.io/design-rover/guides/watch/#watch-details")
  })
})
