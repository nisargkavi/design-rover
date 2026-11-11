import ts from "typescript"

export type ConfigColor = { name: string; path: string[]; value?: string; expression: string; line: number }

/** Read only literal configuration and const aliases. Never import or execute it. */
export function tailwindColors(file: string, content: string): { colors: ConfigColor[]; issues: string[] } {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const constants = new Map<string, ts.Expression>()
  const roots: ts.Expression[] = []
  const issues = new Set<string>()
  const colors = new Map<string, ConfigColor>()
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer) constants.set(declaration.name.text, declaration.initializer)
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) roots.push(statement.expression)
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && statement.expression.left.getText(source) === "module.exports") roots.push(statement.expression.right)
  }
  const unwrap = (node: ts.Expression, seen = new Set<ts.Expression>()): ts.Expression | undefined => {
    if (seen.has(node) || seen.size > 32) return undefined
    const next = new Set(seen).add(node)
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return unwrap(node.expression, next)
    if (ts.isIdentifier(node)) {
      const value = constants.get(node.text)
      return value ? unwrap(value, next) : undefined
    }
    return node
  }
  const key = (name: ts.PropertyName) => ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text : ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression) ? name.expression.text : undefined
  const members = (expression: ts.Expression, context: string): [string, ts.Expression][] => {
    const object = unwrap(expression)
    if (!object || !ts.isObjectLiteralExpression(object)) { issues.add(`${context} is not a statically readable object.`); return [] }
    const found = new Map<string, ts.Expression>()
    let uncertain = false
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) { uncertain = true; issues.add(`${context} contains a spread; keys that it could override remain unresolved.`); continue }
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) { uncertain = true; issues.add(`${context} contains an unsupported object member.`); continue }
      const name = key(property.name)
      if (name === undefined) { uncertain = true; issues.add(`${context} contains a computed key that was not evaluated.`); continue }
      found.set(name, ts.isPropertyAssignment(property) ? property.initializer : property.name)
    }
    // A spread/computed assignment may replace literal keys. Decline this
    // object instead of publishing a guessed runtime value.
    return uncertain ? [] : [...found]
  }
  const walk = (expression: ts.Expression, names: string[], sourcePath: string[], depth: number) => {
    if (depth > 16) { issues.add(`${sourcePath.join(".")} exceeds the supported nesting depth.`); return }
    const value = unwrap(expression)
    if (value && ts.isObjectLiteralExpression(value)) {
      for (const [name, child] of members(value, sourcePath.join("."))) walk(child, name === "DEFAULT" ? names : [...names, name], [...sourcePath, name], depth + 1)
      return
    }
    const name = names.join("-")
    if (!name) { issues.add(`${sourcePath.join(".")} has no named utility group.`); return }
    const literal = value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) ? value.text : undefined
    if (literal === undefined) issues.add(`${sourcePath.join(".")} is a dynamic value and was not evaluated.`)
    colors.set(name, { name, path: sourcePath, value: literal, expression: expression.getText(source), line: source.getLineAndCharacterOfPosition(expression.getStart(source)).line + 1 })
  }
  for (const root of roots) {
    const entries = new Map(members(root, "config"))
    const theme = entries.get("theme")
    if (!theme) continue
    const themeEntries = new Map(members(theme, "theme"))
    const direct = themeEntries.get("colors")
    if (direct) for (const [name, value] of members(direct, "theme.colors")) walk(value, [name], ["theme", "colors", name], 0)
    const extend = themeEntries.get("extend")
    if (extend) {
      const extended = new Map(members(extend, "theme.extend")).get("colors")
      if (extended) for (const [name, value] of members(extended, "theme.extend.colors")) walk(value, [name], ["theme", "extend", "colors", name], 0)
    }
  }
  return { colors: [...colors.values()].sort((a, b) => a.name.localeCompare(b.name)), issues: [...issues].sort() }
}
