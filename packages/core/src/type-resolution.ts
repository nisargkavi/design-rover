import path from "node:path"
import ts from "typescript"
import type { ComponentPropsResolution } from "@design-rover/model"
import type { ExtractedComponent, ExtractedProp, RepoEvidence } from "./evidence.ts"
import { localModules, type LocalModules } from "./local-modules.ts"

type Result = { props: ExtractedProp[]; resolution: ComponentPropsResolution }
type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction
type Input = { fn: FunctionNode; type?: ts.TypeNode }
const resolvers = new WeakMap<RepoEvidence, TypeResolver>()
const MAX_PROPS = 256
const normalize = (file: string) => path.resolve(file).replaceAll("\\", "/")
const nameOf = (name: ts.PropertyName) => ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : name.getText()

function unwrap(node: ts.Expression): { fn?: FunctionNode; type?: ts.TypeNode } {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return { fn: node }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return unwrap(node.expression)
  if (ts.isCallExpression(node)) {
    const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ""
    if (name === "memo" || name === "forwardRef") {
      const first = node.arguments[0]
      if (first) return { ...unwrap(first), type: name === "forwardRef" ? node.typeArguments?.[1] : node.typeArguments?.[0] }
    }
  }
  return {}
}

function componentInput(source: ts.SourceFile, component: ExtractedComponent): Input | undefined {
  let input: Input | undefined
  const visit = (node: ts.Node) => {
    if (input) return
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    if (ts.isFunctionDeclaration(node) && node.name?.text === component.name && line === component.startLine) {
      input = { fn: node, type: node.parameters[0]?.type }
      return
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === component.name && line === component.startLine && node.initializer) {
      const unwrapped = unwrap(node.initializer)
      if (!unwrapped.fn) return
      let annotation: ts.TypeNode | undefined
      if (node.type && ts.isTypeReferenceNode(node.type) && /(?:^|\.)(?:FC|FunctionComponent|ComponentType)$/.test(node.type.typeName.getText())) annotation = node.type.typeArguments?.[0]
      if (node.type && ts.isFunctionTypeNode(node.type)) annotation = node.type.parameters[0]?.type
      input = { fn: unwrapped.fn, type: unwrapped.fn.parameters[0]?.type ?? unwrapped.type ?? annotation }
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return input
}

class TypeResolver {
  private program?: ts.Program
  private readonly graph: LocalModules
  private readonly root: string
  private readonly libDirectory: string
  private readonly semantic = new Map<string, readonly ts.Diagnostic[]>()

  constructor(private readonly evidence: RepoEvidence) {
    this.graph = localModules(evidence)
    this.root = path.resolve(evidence.root || ".")
    this.libDirectory = normalize(path.dirname(ts.getDefaultLibFilePath({})))
  }

  private relative(file: string): string { return path.relative(this.root, file).replaceAll("\\", "/") }
  private isLibrary(file: string): boolean { return normalize(file).startsWith(`${this.libDirectory}/`) && /\/lib\.[^/]+\.d\.ts$/.test(normalize(file)) }

  private compiler(): ts.Program {
    if (this.program) return this.program
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve, strict: true, noEmit: true, allowJs: true, checkJs: false,
      skipLibCheck: true, types: [], lib: ["lib.es2022.d.ts"],
    }
    const original = ts.createCompilerHost(options, true)
    const read = (file: string) => this.graph.files.get(this.relative(file)) ?? (this.isLibrary(file) ? ts.sys.readFile(file) : undefined)
    const host: ts.CompilerHost = {
      ...original,
      getCurrentDirectory: () => this.root,
      getCanonicalFileName: normalize,
      useCaseSensitiveFileNames: () => true,
      readFile: read,
      fileExists: (file) => read(file) !== undefined,
      getSourceFile: (file, languageVersion) => {
        const source = this.graph.source(this.relative(file))
        if (source) return source
        const text = this.isLibrary(file) ? ts.sys.readFile(file) : undefined
        return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true)
      },
      writeFile: () => { throw new Error("Design Rover's type resolver never emits application code.") },
      resolveModuleNames: (names, containingFile) => names.map((name) => {
        const target = this.graph.resolveModule(this.relative(containingFile), name)
        if (!target) return undefined
        return { resolvedFileName: path.resolve(this.root, target), isExternalLibraryImport: false }
      }),
      resolveTypeReferenceDirectives: (names) => names.map(() => undefined),
    }
    this.program = ts.createProgram([...this.graph.files.keys()].map((file) => path.resolve(this.root, file)), options, host)
    return this.program
  }

  props(component: ExtractedComponent): Result {
    const source = this.graph.source(component.file)
    const input = source && componentInput(source, component)
    if (!input) return { props: component.props, resolution: { status: "unresolved", issues: ["The component's function declaration could not be matched to its source location."] } }
    const parameter = input.fn.parameters[0]
    if (!parameter && !input.type) return { props: [], resolution: { status: "resolved", issues: [] } }
    const defaults = new Map<string, string>()
    const untyped: ExtractedProp[] = []
    if (parameter && ts.isObjectBindingPattern(parameter.name)) {
      for (const binding of parameter.name.elements) {
        if (binding.dotDotDotToken) continue
        const name = binding.propertyName ? nameOf(binding.propertyName) : binding.name.getText()
        if (binding.initializer) defaults.set(name, binding.initializer.getText())
        untyped.push({ name, required: !binding.initializer, defaultValue: binding.initializer?.getText() })
      }
    }
    if (!input.type) return { props: untyped, resolution: { status: "untyped", issues: ["The props parameter has no explicit supported type annotation. Destructured bindings are not a complete component API."] } }

    const program = this.compiler()
    const checker = program.getTypeChecker()
    const issues = new Set<string>()
    const visited = new Set<ts.Node>()
    let unsafeDependency = false
    const diagnostics = (node: ts.Node) => {
      const source = node.getSourceFile()
      let all = this.semantic.get(source.fileName)
      if (!all) { all = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]; this.semantic.set(source.fileName, all) }
      const start = node.getStart(source)
      const end = node.getEnd()
      for (const diagnostic of all) if (diagnostic.category === ts.DiagnosticCategory.Error && diagnostic.start !== undefined && diagnostic.start >= start && diagnostic.start < end) {
        issues.add(`${this.relative(source.fileName)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`)
      }
    }
    const importType = (node: ts.ImportTypeNode) => {
      const argument = node.argument
      if (!ts.isLiteralTypeNode(argument) || !ts.isStringLiteral(argument.literal) || !node.qualifier || !ts.isIdentifier(node.qualifier)) {
        return { targets: [], issues: ["An import type must identify one explicit local exported member; computed or nested import-type members are unsupported."] }
      }
      return this.graph.resolveExport(this.relative(node.getSourceFile().fileName), argument.literal.text, node.qualifier.text, node.isTypeOf ? "value" : "type")
    }
    const reference = (name: ts.Node) => {
      const current = name.getSourceFile()
      const file = this.relative(current.fileName)
      const parts = name.getText(current).split(".")
      const first = parts[0]
      for (const statement of current.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
        const clause = statement.importClause
        const bindings = clause?.namedBindings
        let imported: string | undefined
        if (parts.length === 1 && clause?.name?.text === first) imported = "default"
        if (parts.length === 1 && bindings && ts.isNamedImports(bindings)) {
          const binding = bindings.elements.find((item) => item.name.text === first)
          if (binding) imported = binding.propertyName?.text ?? binding.name.text
        }
        if (parts.length === 2 && bindings && ts.isNamespaceImport(bindings) && bindings.name.text === first) imported = parts[1]
        if (imported) {
          const resolution = this.graph.resolveExport(file, statement.moduleSpecifier.text, imported, "type")
          for (const issue of resolution.issues) issues.add(issue)
          if (resolution.targets.length !== 1 && !resolution.issues.length) issues.add(`Cannot resolve a unique local type export ${imported} from ${statement.moduleSpecifier.text}.`)
          if (resolution.issues.length || resolution.targets.length !== 1) unsafeDependency = true
        }
      }
      let symbol = checker.getSymbolAtLocation(name)
      if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
      if (!symbol || !symbol.declarations?.length) {
        issues.add(`Cannot resolve type ${name.getText(current)} in ${file}.`)
        unsafeDependency = true
        return
      }
      for (const declaration of symbol.declarations) {
        if (this.isLibrary(declaration.getSourceFile().fileName)) continue
        if (!this.graph.files.has(this.relative(declaration.getSourceFile().fileName))) {
          issues.add(`Type ${name.getText(current)} is declared outside scanned repository files.`)
          continue
        }
        if (ts.isTypeAliasDeclaration(declaration) || ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration)) walk(declaration)
      }
    }
    const walk = (node: ts.Node) => {
      if (visited.has(node)) return
      visited.add(node)
      diagnostics(node)
      if (ts.isClassDeclaration(node)) issues.add("Class-based props contracts are only partially supported; inherited and runtime-initialized members require inspection.")
      if (ts.isTypeReferenceNode(node)) reference(node.typeName)
      if (ts.isExpressionWithTypeArguments(node)) reference(node.expression)
      if (ts.isImportTypeNode(node)) {
        const resolution = importType(node)
        for (const issue of resolution.issues) issues.add(issue)
        if (resolution.issues.length || resolution.targets.length !== 1) {
          unsafeDependency = true
          if (!resolution.issues.length) issues.add("The import type does not identify a unique local exported declaration.")
        } else if (node.qualifier) {
          let symbol = checker.getSymbolAtLocation(node.qualifier)
          if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
          for (const declaration of symbol?.declarations ?? []) if (ts.isTypeAliasDeclaration(declaration) || ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration)) walk(declaration)
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(input.type)
    const type = checker.getTypeFromTypeNode(input.type)
    const primitive = ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void
    const nonObject = Boolean(type.flags & primitive) || (type.isUnion() && type.types.some((member) => Boolean(member.flags & primitive)))
    if (nonObject) issues.add("The props annotation includes a non-object type; primitive members are not a component property API.")
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter | ts.TypeFlags.Conditional | ts.TypeFlags.Never)) issues.add("The props object type could not be resolved to a concrete local contract.")
    if (type.isUnion()) issues.add("Union props expose only common properties; branch-specific contracts remain unresolved.")
    if (checker.getIndexInfosOfType(type).length) issues.add("The props type has an index signature; arbitrary property names are not enumerated.")
    // A checker can choose one declaration after a conflicting star export or
    // collapse an unresolved intersection to any. Retain only independently
    // proven local members in those cases, never that arbitrary chosen branch.
    const proven = (node: ts.Node, seen: Set<ts.Node>): ts.Symbol[] => {
      if (seen.has(node)) return []
      const next = new Set(seen).add(node)
      if (ts.isParenthesizedTypeNode(node)) return proven(node.type, next)
      if (ts.isIntersectionTypeNode(node)) return node.types.flatMap((member) => proven(member, next))
      if (ts.isTypeLiteralNode(node)) return checker.getPropertiesOfType(checker.getTypeFromTypeNode(node))
      if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
        const own = node.members.flatMap((member) => member.name && !(ts.canHaveModifiers(member) && ts.getModifiers(member)?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)) ? [checker.getSymbolAtLocation(member.name)].filter((symbol): symbol is ts.Symbol => Boolean(symbol)) : [])
        return [...own, ...(node.heritageClauses ?? []).flatMap((clause) => clause.types.flatMap((base) => proven(base, next)))]
      }
      if (ts.isTypeAliasDeclaration(node)) return proven(node.type, next)
      if (ts.isImportTypeNode(node)) {
        const resolution = importType(node)
        if (resolution.issues.length || resolution.targets.length !== 1) return []
        let symbol = node.qualifier && checker.getSymbolAtLocation(node.qualifier)
        if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        return (symbol?.declarations ?? []).filter((declaration) => !this.isLibrary(declaration.getSourceFile().fileName)).flatMap((declaration) => proven(declaration, next))
      }
      if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
        const name = ts.isTypeReferenceNode(node) ? node.typeName : node.expression
        const file = this.relative(node.getSourceFile().fileName)
        const parts = name.getText().split(".")
        for (const statement of node.getSourceFile().statements) {
          if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
          const clause = statement.importClause
          const bindings = clause?.namedBindings
          let imported = parts.length === 1 && clause?.name?.text === parts[0] ? "default" : undefined
          if (parts.length === 1 && bindings && ts.isNamedImports(bindings)) {
            const binding = bindings.elements.find((member) => member.name.text === parts[0])
            if (binding) imported = binding.propertyName?.text ?? binding.name.text
          }
          if (parts.length === 2 && bindings && ts.isNamespaceImport(bindings) && bindings.name.text === parts[0]) imported = parts[1]
          if (imported) {
            const resolution = this.graph.resolveExport(file, statement.moduleSpecifier.text, imported, "type")
            if (resolution.issues.length || resolution.targets.length !== 1) return []
          }
        }
        let symbol = checker.getSymbolAtLocation(name)
        if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        return (symbol?.declarations ?? []).filter((declaration) => !this.isLibrary(declaration.getSourceFile().fileName)).flatMap((declaration) => proven(declaration, next))
      }
      return []
    }
    const candidates = nonObject ? [] : unsafeDependency || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) ? proven(input.type, new Set()) : checker.getPropertiesOfType(type)
    const symbols = [...new Map(candidates.map((symbol) => [symbol.name, symbol])).values()]
    if (symbols.length > MAX_PROPS) issues.add(`The props contract exceeds ${MAX_PROPS} properties; only the first ${MAX_PROPS} are included.`)
    const props = symbols.slice(0, MAX_PROPS).map((symbol): ExtractedProp => {
      const propertyType = checker.getTypeOfSymbolAtLocation(symbol, input.type!)
      const required = !(symbol.flags & ts.SymbolFlags.Optional)
      const members = propertyType.isUnion() ? propertyType.types.filter((member) => required || !(member.flags & ts.TypeFlags.Undefined)) : [propertyType]
      if (members.some((member) => member.flags & (ts.TypeFlags.TypeParameter | ts.TypeFlags.Conditional | ts.TypeFlags.IndexedAccess))) issues.add(`Property ${symbol.name} depends on unresolved generic type information.`)
      const values = members.length && members.every((member) => member.isStringLiteral()) ? members.map((member) => (member as ts.StringLiteralType).value).sort() : undefined
      return {
        name: symbol.name,
        type: members.map((member) => checker.typeToString(member, input.type, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias)).join(" | ") || "undefined",
        required,
        values,
        defaultValue: defaults.get(symbol.name),
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
    return { props, resolution: { status: issues.size ? props.length ? "partial" : "unresolved" : "resolved", issues: [...issues].sort() } }
  }
}

export function resolveComponentProps(evidence: RepoEvidence, component: ExtractedComponent): Result {
  let resolver = resolvers.get(evidence)
  if (!resolver) { resolver = new TypeResolver(evidence); resolvers.set(evidence, resolver) }
  return resolver.props(component)
}
