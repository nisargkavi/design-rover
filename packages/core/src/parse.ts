import ts from "typescript"
import postcss from "postcss"
import type {
  ClassHit,
  CommentHit,
  ExtractedComponent,
  ExtractedProp,
  FileEvidence,
  FileKind,
  ImageHit,
  ImportHit,
  JsxHit,
  SectionHit,
} from "./evidence.ts"
import { classFamily, splitClasses } from "./classes.ts"

const CVA_NAMES = new Set(["cva", "tv", "variants"])
const CLASS_FNS = new Set(["cn", "clsx", "cx", "twMerge", "twJoin", "classNames"])
const PASCAL = /^[A-Z]/

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}

function isJsx(node: ts.Node): boolean {
  return (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  )
}

function nodeReturnsJsx(node: ts.Node): boolean {
  let found = false
  const visit = (child: ts.Node) => {
    if (found) return
    if (ts.isReturnStatement(child) && child.expression && containsJsx(child.expression)) {
      found = true
      return
    }
    if (ts.isArrowFunction(child) || ts.isFunctionExpression(child) || ts.isFunctionDeclaration(child)) {
      return
    }
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  if (ts.isArrowFunction(node) && node.body && containsJsx(node.body)) return true
  return found
}

function containsJsx(node: ts.Node): boolean {
  if (isJsx(node)) return true
  let found = false
  const visit = (child: ts.Node) => {
    if (found) return
    if (isJsx(child)) {
      found = true
      return
    }
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return found
}

function isComponentName(name: string): boolean {
  return PASCAL.test(name) && name !== "React"
}

function collectClassesFromExpr(
  expr: ts.Expression | undefined,
): { classes: string[]; dynamic: boolean } {
  if (!expr) return { classes: [], dynamic: false }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return { classes: splitClasses(expr.text), dynamic: false }
  }
  if (ts.isTemplateExpression(expr)) {
    const parts = [expr.head.text, ...expr.templateSpans.map((span) => span.literal.text)]
    return { classes: splitClasses(parts.join(" ")), dynamic: true }
  }
  if (ts.isCallExpression(expr)) {
    const name = callName(expr)
    if (name && CLASS_FNS.has(name)) {
      const merged = expr.arguments.map((arg) =>
        ts.isExpression(arg) ? collectClassesFromExpr(arg) : { classes: [], dynamic: false },
      )
      return {
        classes: merged.flatMap((item) => item.classes),
        dynamic: merged.some((item) => item.dynamic),
      }
    }
    return { classes: [], dynamic: true }
  }
  if (ts.isConditionalExpression(expr)) {
    const left = collectClassesFromExpr(expr.whenTrue)
    const right = collectClassesFromExpr(expr.whenFalse)
    return {
      classes: [...left.classes, ...right.classes],
      dynamic: true,
    }
  }
  if (ts.isBinaryExpression(expr)) {
    const left = collectClassesFromExpr(expr.left as ts.Expression)
    const right = collectClassesFromExpr(expr.right)
    return {
      classes: [...left.classes, ...right.classes],
      dynamic: left.dynamic || right.dynamic,
    }
  }
  if (ts.isParenthesizedExpression(expr)) {
    return collectClassesFromExpr(expr.expression)
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const classes: string[] = []
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.initializer)) {
        classes.push(...splitClasses(prop.initializer.text))
      }
    }
    return { classes, dynamic: true }
  }
  return { classes: [], dynamic: true }
}

function callName(expr: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(expr.expression)) return expr.expression.text
  if (ts.isPropertyAccessExpression(expr.expression)) return expr.expression.name.text
  return undefined
}

function unionValues(typeNode: ts.TypeNode | undefined): string[] | undefined {
  if (!typeNode) return undefined
  if (ts.isUnionTypeNode(typeNode)) {
    const values = typeNode.types
      .map((item) => (ts.isLiteralTypeNode(item) && ts.isStringLiteral(item.literal) ? item.literal.text : undefined))
      .filter((item): item is string => Boolean(item))
    return values.length ? values : undefined
  }
  if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
    return [typeNode.literal.text]
  }
  return undefined
}

function propsFromTypeLiteral(literal: ts.TypeLiteralNode): ExtractedProp[] {
  const props: ExtractedProp[] = []
  for (const member of literal.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue
    const name = member.name.getText()
    props.push({
      name,
      type: member.type?.getText(),
      required: !member.questionToken,
      values: unionValues(member.type),
    })
  }
  return props
}

function findInterface(
  source: ts.SourceFile,
  name: string,
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined {
  for (const stmt of source.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === name) return stmt
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) return stmt
  }
  return undefined
}

function propsFromType(
  source: ts.SourceFile,
  typeNode: ts.TypeNode | undefined,
): ExtractedProp[] {
  if (!typeNode) return []
  if (ts.isTypeLiteralNode(typeNode)) return propsFromTypeLiteral(typeNode)
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const decl = findInterface(source, typeNode.typeName.text)
    if (!decl) return []
    if (ts.isInterfaceDeclaration(decl)) {
      const fake = ts.factory.createTypeLiteralNode(decl.members)
      return propsFromTypeLiteral(fake)
    }
    if (ts.isTypeAliasDeclaration(decl) && decl.type && ts.isTypeLiteralNode(decl.type)) {
      return propsFromTypeLiteral(decl.type)
    }
  }
  return []
}

function propsFromFunction(
  source: ts.SourceFile,
  fn: ts.FunctionLikeDeclaration,
): ExtractedProp[] {
  const first = fn.parameters[0]
  if (!first) return []
  if (first.type) return propsFromType(source, first.type)
  if (ts.isObjectBindingPattern(first.name)) {
    return first.name.elements.map((el) => ({
      name: el.name.getText(),
      required: !el.dotDotDotToken,
    }))
  }
  return []
}

function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isCallExpression(node)) {
    const name = callName(node)
    if (name === "forwardRef" || name === "memo") {
      const arg = node.arguments[0]
      if (arg && ts.isExpression(arg)) return unwrap(arg)
    }
  }
  if (ts.isParenthesizedExpression(node)) return unwrap(node.expression)
  return node
}

function extractCva(node: ts.CallExpression): { variants: string[]; sizes: string[]; classes: string[] } {
  const variants: string[] = []
  const sizes: string[] = []
  const classes: string[] = []
  const base = node.arguments[0]
  if (base && ts.isExpression(base)) {
    classes.push(...collectClassesFromExpr(base).classes)
  }
  const config = node.arguments[1]
  if (config && ts.isObjectLiteralExpression(config)) {
    for (const prop of config.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue
      if (prop.name.text !== "variants" || !ts.isObjectLiteralExpression(prop.initializer)) continue
      for (const group of prop.initializer.properties) {
        if (!ts.isPropertyAssignment(group) || !ts.isIdentifier(group.name)) continue
        const groupName = group.name.text
        if (!ts.isObjectLiteralExpression(group.initializer)) continue
        const keys = group.initializer.properties
          .map((item) => (ts.isPropertyAssignment(item) ? item.name.getText().replace(/['"]/g, "") : undefined))
          .filter((item): item is string => Boolean(item))
        if (groupName === "size") sizes.push(...keys)
        else if (groupName === "variant") variants.push(...keys)
        else variants.push(...keys.map((key) => `${groupName}:${key}`))
        for (const item of group.initializer.properties) {
          if (ts.isPropertyAssignment(item) && ts.isExpression(item.initializer)) {
            classes.push(...collectClassesFromExpr(item.initializer).classes)
          }
        }
      }
    }
  }
  return { variants, sizes, classes }
}

function tagName(node: ts.JsxTagNameExpression): string {
  return node.getText()
}

function jsxAttributes(node: ts.JsxAttributes): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const attr of node.properties) {
    if (!ts.isJsxAttribute(attr) || !attr.initializer) continue
    const name = attr.name.getText()
    if (ts.isStringLiteral(attr.initializer)) attrs[name] = attr.initializer.text
    else if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      if (ts.isStringLiteral(attr.initializer.expression)) {
        attrs[name] = attr.initializer.expression.text
      }
    }
  }
  return attrs
}

function opening(node: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(node) ? node.openingElement : node
}

function walkJsxTree(
  node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
  tags: string[],
  components: string[],
  families: Set<string>,
  depth: number,
): { childCount: number; depth: number } {
  let childCount = 0
  let maxDepth = depth
  const children = ts.isJsxFragment(node)
    ? node.children
    : ts.isJsxElement(node)
      ? node.children
      : []
  if (!ts.isJsxFragment(node)) {
    const open = opening(node)
    const name = tagName(open.tagName)
    if (isComponentName(name)) components.push(name)
    else tags.push(name)
    const classAttr = open.attributes.properties.find(
      (prop) => ts.isJsxAttribute(prop) && prop.name.getText() === "className",
    )
    if (classAttr && ts.isJsxAttribute(classAttr)) {
      const expr = classAttr.initializer
      const collected = expr && ts.isJsxExpression(expr)
        ? collectClassesFromExpr(expr.expression)
        : expr && ts.isStringLiteral(expr)
          ? { classes: splitClasses(expr.text), dynamic: false }
          : { classes: [], dynamic: false }
      for (const cls of collected.classes) families.add(classFamily(cls))
    }
  }
  for (const child of children) {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      childCount += 1
      const nested = walkJsxTree(child, tags, components, families, depth + 1)
      childCount += nested.childCount
      maxDepth = Math.max(maxDepth, nested.depth)
    }
  }
  return { childCount, depth: maxDepth }
}

function variantsOwnerName(name: string): string {
  const base = name.replace(/Variants$/, "")
  if (!base) return name
  return `${base[0]!.toUpperCase()}${base.slice(1)}`
}

function findComponent(
  components: ExtractedComponent[],
  name: string,
): ExtractedComponent | undefined {
  const owner = variantsOwnerName(name)
  return components.find(
    (item) => item.name === name || item.name === owner || item.name.toLowerCase() === name.toLowerCase(),
  )
}

function headingFrom(node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment): string | undefined {
  let heading: string | undefined
  const visit = (child: ts.Node) => {
    if (heading) return
    if (ts.isJsxElement(child)) {
      const name = tagName(child.openingElement.tagName)
      if (/^h[1-3]$/.test(name)) {
        heading = child.children
          .map((item) => (ts.isJsxText(item) ? item.getText() : ""))
          .join("")
          .trim()
        return
      }
    }
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return heading || undefined
}

function isPlaceholderSrc(src?: string): boolean {
  if (!src) return true
  return /placeholder|picsum|unsplash|placehold|temp-|dummy|TODO/i.test(src)
}

function cssVariables(content: string, file: string): FileEvidence["cssVariables"] {
  const vars: FileEvidence["cssVariables"] = []
  const root = postcss.parse(content, { from: file })
  root.walkDecls(/^--/, (declaration) => {
    const ancestors: string[] = []
    let parent = declaration.parent
    while (parent && parent.type !== "root") {
      if (parent.type === "rule") ancestors.unshift(parent.selector.trim().replace(/\s+/g, " "))
      if (parent.type === "atrule") ancestors.unshift(`@${parent.name} ${parent.params}`.trim().replace(/\s+/g, " "))
      parent = parent.parent
    }
    const scope = ancestors.join(" > ") || ":root"
    const mode = /(?:\.dark\b|prefers-color-scheme\s*:\s*dark|data-theme\s*=\s*["']?dark\b)/i.test(scope)
      ? "dark"
      : /(?:\.light\b|prefers-color-scheme\s*:\s*light|data-theme\s*=\s*["']?light\b)/i.test(scope)
        ? "light"
        : undefined
    vars.push({ name: declaration.prop, value: declaration.value, line: declaration.source?.start?.line, scope, mode, important: declaration.important || undefined })
  })
  return vars
}

function commentsFromSource(source: ts.SourceFile, relative: string): CommentHit[] {
  const hits: CommentHit[] = []
  const trivia = ts.getLeadingCommentRanges(source.text, 0) ?? []
  const ranges: ts.CommentRange[] = [...trivia]
  const visit = (node: ts.Node) => {
    const leading = ts.getLeadingCommentRanges(source.text, node.pos) ?? []
    ranges.push(...leading)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(source, visit)
  const seen = new Set<number>()
  for (const range of ranges) {
    if (seen.has(range.pos)) continue
    seen.add(range.pos)
    const text = source.text.slice(range.pos, range.end)
    hits.push({
      file: relative,
      text,
      startLine: source.getLineAndCharacterOfPosition(range.pos).line + 1,
    })
  }
  return hits
}

export function extractFileEvidence(input: {
  relative: string
  content: string
  hash: string
  kind: FileKind
}): FileEvidence {
  const empty: FileEvidence = {
    relative: input.relative,
    hash: input.hash,
    kind: input.kind,
    content: input.content,
    components: [],
    classes: [],
    imports: [],
    jsx: [],
    comments: [],
    sections: [],
    images: [],
    cssVariables: input.kind === "style" ? cssVariables(input.content, input.relative) : [],
    exportedClassConstants: [],
  }

  if (input.kind === "style") return empty
  if (input.kind !== "script") {
    empty.comments = input.content
      .split("\n")
      .map((text, index) => ({ file: input.relative, text, startLine: index + 1 }))
      .filter((item) => /TODO|FIXME|placeholder/i.test(item.text))
    return empty
  }

  const source = ts.createSourceFile(
    input.relative,
    input.content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(input.relative),
  )

  const components: ExtractedComponent[] = []
  const classes: ClassHit[] = []
  const imports: ImportHit[] = []
  const jsx: JsxHit[] = []
  const sections: SectionHit[] = []
  const images: ImageHit[] = []
  const exportedClassConstants: string[] = []

  const interfaces = new Map<string, ExtractedProp[]>()
  for (const stmt of source.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      interfaces.set(stmt.name.text, propsFromTypeLiteral(ts.factory.createTypeLiteralNode(stmt.members)))
    }
  }

  function maybeComponent(
    name: string,
    node: ts.FunctionLikeDeclaration | ts.Expression,
    exported: boolean,
    isDefault: boolean,
    start: ts.Node,
  ) {
    if (!isComponentName(name)) return
    const fn = ts.isFunctionLike(node) ? node : undefined
    const expr = !fn && ts.isExpression(node) ? unwrap(node) : node
    const bodyNode = fn ?? expr
    if (!nodeReturnsJsx(bodyNode) && !(ts.isFunctionLike(bodyNode) && bodyNode.body && containsJsx(bodyNode.body))) {
      if (!(ts.isArrowFunction(expr) && expr.body && containsJsx(expr.body))) return
    }
    const props = fn ? propsFromFunction(source, fn) : ts.isFunctionLike(expr) ? propsFromFunction(source, expr) : []
    const composition = new Set<string>()
    const classNames: string[] = []
    const visitComp = (child: ts.Node) => {
      if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
        const tag = tagName(child.tagName)
        if (isComponentName(tag)) composition.add(tag)
      }
      ts.forEachChild(child, visitComp)
    }
    ts.forEachChild(bodyNode, visitComp)
    components.push({
      name,
      file: input.relative,
      exportName: name,
      isDefault,
      exported,
      props: props.length ? props : interfaces.get(`${name}Props`) ?? [],
      variants: [],
      sizes: [],
      composition: [...composition].sort(),
      classNames,
      startLine: lineOf(source, start),
    })
  }

  const cvaPending = new Map<string, { variants: string[]; sizes: string[]; classes: string[] }>()

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const names: string[] = []
      const importedBindings: { local: string; imported: string; isTypeOnly?: boolean }[] = []
      let defaultName: string | undefined
      const clause = node.importClause
      if (clause?.name) {
        defaultName = clause.name.text
        importedBindings.push({ local: defaultName, imported: "default" })
      }
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          names.push(el.name.text)
          importedBindings.push({ local: el.name.text, imported: el.propertyName?.text ?? el.name.text, isTypeOnly: el.isTypeOnly || undefined })
        }
      }
      if (bindings && ts.isNamespaceImport(bindings)) importedBindings.push({ local: bindings.name.text, imported: "*" })
      imports.push({
        file: input.relative,
        source: node.moduleSpecifier.text,
        names,
        defaultName,
        bindings: importedBindings,
        isTypeOnly: Boolean(clause?.isTypeOnly),
      })
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      const exported = Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      maybeComponent(node.name.text, node, exported, Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)), node)
    }

    if (ts.isVariableStatement(node)) {
      const exported = Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        const name = decl.name.text
        if (/class|classes|className/i.test(name) && (ts.isStringLiteral(decl.initializer) || ts.isNoSubstitutionTemplateLiteral(decl.initializer))) {
          exportedClassConstants.push(name)
          classes.push({
            file: input.relative,
            classes: splitClasses(decl.initializer.text),
            dynamic: false,
            exported,
            kind: "const",
            startLine: lineOf(source, decl),
          })
        }
        const init = unwrap(decl.initializer)
        if (ts.isCallExpression(decl.initializer) && callName(decl.initializer) && CVA_NAMES.has(callName(decl.initializer)!)) {
          const extracted = extractCva(decl.initializer)
          const owner = variantsOwnerName(name)
          classes.push({
            file: input.relative,
            classes: extracted.classes,
            dynamic: false,
            exported,
            kind: "cva",
            componentName: owner,
            startLine: lineOf(source, decl),
          })
          const existing = findComponent(components, owner)
          if (existing) {
            existing.variants = extracted.variants
            existing.sizes = extracted.sizes
            existing.classNames.push(...extracted.classes)
          } else {
            cvaPending.set(owner, extracted)
          }
        }
        maybeComponent(name, init, exported, false, decl)
      }
    }

    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
      const target = components.find((item) => item.name === node.expression.getText())
      if (target) {
        target.isDefault = true
        target.exported = true
      }
    }

    if (ts.isCallExpression(node) && callName(node) && CVA_NAMES.has(callName(node)!)) {
      const extracted = extractCva(node)
      classes.push({
        file: input.relative,
        classes: extracted.classes,
        dynamic: false,
        exported: false,
        kind: "cva",
        startLine: lineOf(source, node),
      })
    }

    if (ts.isJsxAttribute(node) && node.name.getText() === "className") {
      const collected =
        node.initializer && ts.isJsxExpression(node.initializer)
          ? collectClassesFromExpr(node.initializer.expression)
          : node.initializer && ts.isStringLiteral(node.initializer)
            ? { classes: splitClasses(node.initializer.text), dynamic: false }
            : { classes: [], dynamic: false }
      if (collected.classes.length) {
        classes.push({
          file: input.relative,
          classes: collected.classes,
          dynamic: collected.dynamic,
          exported: false,
          kind: "jsx",
          startLine: lineOf(source, node),
        })
      }
    }

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const open = opening(node)
      const tag = tagName(open.tagName)
      const attrs = jsxAttributes(open.attributes)
      const classAttr = open.attributes.properties.find(
        (prop) => ts.isJsxAttribute(prop) && prop.name.getText() === "className",
      )
      const collected =
        classAttr && ts.isJsxAttribute(classAttr)
          ? classAttr.initializer && ts.isJsxExpression(classAttr.initializer)
            ? collectClassesFromExpr(classAttr.initializer.expression)
            : classAttr.initializer && ts.isStringLiteral(classAttr.initializer)
              ? { classes: splitClasses(classAttr.initializer.text), dynamic: false }
              : { classes: [], dynamic: false }
          : { classes: [], dynamic: false }
      jsx.push({
        file: input.relative,
        tag,
        isComponent: isComponentName(tag),
        classes: collected.classes,
        attributes: attrs,
        startLine: lineOf(source, node),
        selfClosing: ts.isJsxSelfClosingElement(node),
      })
      if (tag === "img" || tag === "Image") {
        images.push({
          file: input.relative,
          tag,
          src: attrs.src,
          startLine: lineOf(source, node),
          nextImage: tag === "Image",
          placeholder: isPlaceholderSrc(attrs.src) || /placeholder/i.test(tag),
        })
      }
      if (isComponentName(tag) && /placeholder/i.test(tag)) {
        images.push({
          file: input.relative,
          tag,
          src: attrs.src,
          startLine: lineOf(source, node),
          nextImage: false,
          placeholder: true,
        })
      }

      const structural = !isComponentName(tag) && (
        tag === "section" ||
        tag === "article" ||
        tag === "header" ||
        tag === "aside" ||
        tag === "main" ||
        (tag === "div" && collected.classes.some((cls) => /^(flex|grid|space-y|rounded|border)/.test(cls)))
      )
      if (structural && ts.isJsxElement(node)) {
        const tags: string[] = []
        const comps: string[] = []
        const families = new Set<string>()
        const stats = walkJsxTree(node, tags, comps, families, 1)
        if (stats.childCount >= 2) {
          sections.push({
            file: input.relative,
            startLine: lineOf(source, node),
            tags,
            components: [...new Set(comps)],
            classFamilies: [...families].sort(),
            childCount: stats.childCount,
            depth: stats.depth,
            heading: headingFrom(node),
          })
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(source)

  for (const [name, extracted] of cvaPending) {
    const existing = findComponent(components, name)
    if (existing) {
      existing.variants = [...new Set([...existing.variants, ...extracted.variants])]
      existing.sizes = [...new Set([...existing.sizes, ...extracted.sizes])]
      existing.classNames.push(...extracted.classes)
    }
  }

  // Local PascalCase functions in page files as named sections
  for (const stmt of source.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && isComponentName(stmt.name.text) && nodeReturnsJsx(stmt)) {
      const exported = Boolean(stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      if (!exported && /page|layout|route/i.test(input.relative)) {
        const tags: string[] = []
        const comps: string[] = []
        const families = new Set<string>()
        if (stmt.body) walkJsxTreeFromBody(stmt.body, tags, comps, families)
        sections.push({
          file: input.relative,
          nameHint: stmt.name.text,
          startLine: lineOf(source, stmt),
          tags,
          components: [...new Set(comps)],
          classFamilies: [...families].sort(),
          childCount: comps.length + tags.length,
          depth: 2,
        })
      }
    }
  }

  return {
    relative: input.relative,
    hash: input.hash,
    kind: input.kind,
    content: input.content,
    components,
    classes,
    imports,
    jsx,
    comments: commentsFromSource(source, input.relative),
    sections,
    images,
    cssVariables: [],
    exportedClassConstants,
  }
}

function walkJsxTreeFromBody(
  body: ts.ConciseBody,
  tags: string[],
  components: string[],
  families: Set<string>,
) {
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      walkJsxTree(node, tags, components, families, 1)
      return
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(body, visit)
}
