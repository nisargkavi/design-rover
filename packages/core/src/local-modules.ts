import path from "node:path"
import ts from "typescript"
import type { RepoEvidence } from "./evidence.ts"

export type LocalTarget = { file: string; name: string; exportName?: string }
export type ExportResolution = { module?: string; targets: LocalTarget[]; issues: string[] }
type Kind = "type" | "value"
type Binding = { source?: string; imported: string; typeOnly: boolean }
type Declaration = { type: boolean; value: boolean }
type Module = {
  source: ts.SourceFile
  locals: Map<string, Declaration[]>
  imports: Map<string, Binding>
  exports: Map<string, Binding[]>
  stars: { source: string; typeOnly: boolean }[]
}

const graphs = new WeakMap<RepoEvidence, LocalModules>()
const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"]
const normalize = (file: string) => path.posix.normalize(file.replaceAll("\\", "/"))

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX
  return /\.(?:js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
}

/** Static local module graph. It never imports source, evaluates configuration or loads packages. */
export class LocalModules {
  readonly files = new Map<string, string>()
  private readonly modules = new Map<string, Module>()
  private readonly resolutions = new Map<string, ExportResolution>()
  private readonly baseUrl: string

  constructor(readonly evidence: RepoEvidence) {
    for (const file of evidence.files) if (file.kind === "script") this.files.set(normalize(file.relative), file.content)
    const config = evidence.files.find((file) => file.relative === "tsconfig.json")
    const options = config ? ts.parseConfigFileTextToJson("tsconfig.json", config.content).config?.compilerOptions : undefined
    this.baseUrl = typeof options?.baseUrl === "string" ? normalize(options.baseUrl) : "."
  }

  source(file: string): ts.SourceFile | undefined {
    return this.module(file)?.source
  }

  /** Candidate imports are accepted only when they resolve back to this source. */
  importPaths(file: string): string[] {
    const source = normalize(file)
    const stem = source.replace(/\.(?:tsx?|jsx?|mts|cts|mjs|cjs)$/, "")
    const forms = [...new Set([source, stem, ...(stem.endsWith("/index") ? [stem.slice(0, -6)] : [])])]
    const imports: string[] = []
    for (const [alias, targets] of Object.entries(this.evidence.tsconfigPaths)) {
      for (const target of targets) {
        const pattern = normalize(path.posix.join(this.baseUrl, target))
        const star = pattern.indexOf("*")
        if (star < 0) { imports.push(alias); continue }
        const prefix = pattern.slice(0, star)
        const suffix = pattern.slice(star + 1)
        for (const form of forms) if (form.startsWith(prefix) && form.endsWith(suffix)) {
          const rest = form.slice(prefix.length, suffix ? -suffix.length : undefined)
          imports.push(alias.replace("*", rest))
        }
      }
    }
    imports.push(`./${stem}`)
    return [...new Set(imports)].filter((specifier) => this.resolveModule("__design_rover_import__.tsx", specifier) === source)
  }

  resolveModule(from: string, specifier: string): string | undefined {
    const candidates: string[] = []
    if (specifier.startsWith(".")) candidates.push(path.posix.join(path.posix.dirname(from), specifier))
    else {
      const aliases = Object.entries(this.evidence.tsconfigPaths).sort(([a], [b]) =>
        Number(a.includes("*")) - Number(b.includes("*")) || b.indexOf("*") - a.indexOf("*") || a.localeCompare(b))
      for (const [alias, values] of aliases) {
        const star = alias.indexOf("*")
        if (star < 0) {
          if (alias === specifier) { candidates.push(...values.map((value) => path.posix.join(this.baseUrl, value))); break }
        } else {
          const prefix = alias.slice(0, star)
          const suffix = alias.slice(star + 1)
          if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
            const rest = specifier.slice(prefix.length, suffix ? -suffix.length : undefined)
            candidates.push(...values.map((value) => path.posix.join(this.baseUrl, value.replace("*", rest))))
            break
          }
        }
      }
      // A configured baseUrl permits repository-local bare imports. Package
      // imports without a local target remain unresolved.
      if (this.baseUrl !== ".") candidates.push(path.posix.join(this.baseUrl, specifier))
    }
    for (const candidate of candidates) {
      const normalized = normalize(candidate)
      if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) continue
      const direct: string[] = []
      if (/\.jsx?$/.test(normalized)) direct.push(normalized.replace(/\.jsx?$/, ".ts"), normalized.replace(/\.jsx?$/, ".tsx"))
      if (normalized.endsWith(".mjs")) direct.push(normalized.replace(/\.mjs$/, ".mts"))
      if (normalized.endsWith(".cjs")) direct.push(normalized.replace(/\.cjs$/, ".cts"))
      direct.push(normalized)
      direct.push(...extensions.map((extension) => `${normalized}${extension}`), ...extensions.map((extension) => `${normalized}/index${extension}`))
      const found = direct.find((file) => this.files.has(file))
      if (found) return found
    }
    return undefined
  }

  resolveExport(from: string, specifier: string, name: string, kind: Kind): ExportResolution {
    const module = this.resolveModule(from, specifier)
    if (!module) return { targets: [], issues: [`Cannot resolve local ${kind} import ${JSON.stringify(specifier)} from ${from}. External package declarations are not loaded.`] }
    const key = JSON.stringify([module, name, kind])
    const cached = this.resolutions.get(key)
    if (cached) return cached
    const result = this.exported(module, name, kind, new Set())
    const distinct = [...new Map(result.targets.map((target) => [JSON.stringify([target.file, target.name]), target])).values()]
    const issues = [...new Set(result.issues)]
    if (distinct.length > 1) issues.push(`Ambiguous ${kind} export ${name} in ${module}; multiple declarations match.`)
    const resolution = { module, targets: distinct, issues }
    this.resolutions.set(key, resolution)
    return resolution
  }

  private module(file: string): Module | undefined {
    file = normalize(file)
    const cached = this.modules.get(file)
    if (cached) return cached
    const content = this.files.get(file)
    if (content === undefined) return undefined
    const source = ts.createSourceFile(path.resolve(this.evidence.root || ".", file), content, ts.ScriptTarget.Latest, true, scriptKind(file))
    const module: Module = { source, locals: new Map(), imports: new Map(), exports: new Map(), stars: [] }
    this.modules.set(file, module)
    const addExport = (name: string, binding: Binding) => module.exports.set(name, [...(module.exports.get(name) ?? []), binding])
    const addLocal = (name: string, declaration: Declaration) => module.locals.set(name, [...(module.locals.get(name) ?? []), declaration])
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const clause = statement.importClause
        const specifier = statement.moduleSpecifier.text
        if (clause?.name) module.imports.set(clause.name.text, { source: specifier, imported: "default", typeOnly: clause.isTypeOnly })
        const bindings = clause?.namedBindings
        if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
          module.imports.set(binding.name.text, { source: specifier, imported: binding.propertyName?.text ?? binding.name.text, typeOnly: Boolean(clause?.isTypeOnly || binding.isTypeOnly) })
        }
        if (bindings && ts.isNamespaceImport(bindings)) module.imports.set(bindings.name.text, { source: specifier, imported: "*", typeOnly: Boolean(clause?.isTypeOnly) })
        continue
      }
      if (ts.isExportDeclaration(statement)) {
        const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const binding of statement.exportClause.elements) addExport(binding.name.text, { source: specifier, imported: binding.propertyName?.text ?? binding.name.text, typeOnly: statement.isTypeOnly || binding.isTypeOnly })
        } else if (!statement.exportClause && specifier) module.stars.push({ source: specifier, typeOnly: statement.isTypeOnly })
        continue
      }
      if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) {
        addExport("default", { imported: statement.expression.text, typeOnly: false })
        continue
      }
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
      const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      const isDefault = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) {
          addLocal(declaration.name.text, { type: false, value: true })
          if (exported) addExport(declaration.name.text, { imported: declaration.name.text, typeOnly: false })
        }
      } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
        const name = statement.name.text
        const type = !ts.isFunctionDeclaration(statement)
        const value = !ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)
        addLocal(name, { type, value })
        if (exported) addExport(isDefault ? "default" : name, { imported: name, typeOnly: !value })
      }
    }
    return module
  }

  private local(file: string, name: string, kind: Kind, seen: Set<string>): ExportResolution {
    const module = this.module(file)
    if (!module) return { targets: [], issues: [] }
    if (module.locals.get(name)?.some((declaration) => declaration[kind])) return { targets: [{ file, name }], issues: [] }
    const binding = module.imports.get(name)
    if (binding?.source && !(kind === "value" && binding.typeOnly)) return this.binding(file, binding, kind, seen)
    return { targets: [], issues: [] }
  }

  private binding(file: string, binding: Binding, kind: Kind, seen: Set<string>): ExportResolution {
    if (kind === "value" && binding.typeOnly) return { targets: [], issues: [] }
    if (!binding.source) return this.local(file, binding.imported, kind, seen)
    const target = this.resolveModule(file, binding.source)
    if (!target) return { targets: [], issues: [`Cannot resolve local ${kind} re-export ${JSON.stringify(binding.source)} from ${file}.`] }
    if (binding.imported === "*") return { targets: [], issues: [`Namespace re-export in ${file} requires an explicit exported member.`] }
    return this.exported(target, binding.imported, kind, seen)
  }

  private exported(file: string, name: string, kind: Kind, seen: Set<string>): ExportResolution {
    const key = JSON.stringify([file, name, kind])
    if (seen.has(key)) return { targets: [], issues: [] }
    const next = new Set(seen).add(key)
    const module = this.module(file)
    if (!module) return { targets: [], issues: [] }
    const explicit = module.exports.get(name)?.filter((binding) => !(kind === "value" && binding.typeOnly))
    if (explicit?.length) {
      const results = explicit.map((binding) => this.binding(file, binding, kind, next))
      return { targets: results.flatMap((result) => result.targets.map((target) => target.file === file ? { ...target, exportName: name } : target)), issues: results.flatMap((result) => result.issues) }
    }
    if (name === "default") return { targets: [], issues: [] }
    const results = module.stars.filter((star) => !(kind === "value" && star.typeOnly)).map((star) => this.binding(file, { source: star.source, imported: name, typeOnly: star.typeOnly }, kind, next))
    return { targets: results.flatMap((result) => result.targets), issues: results.flatMap((result) => result.issues) }
  }
}

export function localModules(evidence: RepoEvidence): LocalModules {
  let graph = graphs.get(evidence)
  if (!graph) { graph = new LocalModules(evidence); graphs.set(evidence, graph) }
  return graph
}
