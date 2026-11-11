import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "typescript"

const repoRoot = fileURLToPath(new URL("../", import.meta.url))
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const currentDocs = ["README.md", "docs/usage.md", "docs/development.md", "packages/cli/README.md"]

function requireVersion(version) {
  if (typeof version !== "string" || version.trim() !== version || !versionPattern.test(version) || version.split(".").some((part) => !Number.isSafeInteger(Number(part)))) {
    throw new Error("Release version must be a stable major.minor.patch version without a v prefix or leading zeroes.")
  }
}

function jsonObject(file, text) {
  const source = ts.parseJsonText(file, text)
  if (source.parseDiagnostics.length) throw new Error(`Cannot parse ${file}: ${ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, " ")}`)
  const expression = source.statements[0]?.expression
  if (!expression || !ts.isObjectLiteralExpression(expression)) throw new Error(`Expected a JSON object in ${file}.`)
  return { source, object: expression }
}

function property(object, name, file) {
  const found = object.properties.filter((entry) => ts.isPropertyAssignment(entry)
    && (ts.isStringLiteral(entry.name) || ts.isIdentifier(entry.name)) && entry.name.text === name)
  if (found.length !== 1) throw new Error(`Expected exactly one ${name} property in ${file}.`)
  return found[0].initializer
}

function stringProperty(object, name, file) {
  const value = property(object, name, file)
  if (!ts.isStringLiteral(value)) throw new Error(`Expected ${name} to be a string in ${file}.`)
  return value
}

function replaceString(text, source, node, value) {
  return text.slice(0, node.getStart(source)) + JSON.stringify(value) + text.slice(node.getEnd())
}

function replacePinnedVersion(text, previousVersion, version) {
  const escaped = previousVersion.split(".").join("\\.")
  // Match complete stable-version references, including v-prefixed note paths,
  // without rewriting a different patch, prerelease or build-metadata version.
  const reference = new RegExp("(?<![\\w.])(v?)" + escaped + "(?![\\w]|\\.\\d|[-+][\\w])", "g")
  return text.replace(reference, (_, prefix) => `${prefix}${version}`)
}

/** Prepare source release identity without installing dependencies or publishing. */
export async function setReleaseVersion(version, root = repoRoot) {
  requireVersion(version)
  const files = ["packages/cli/package.json", "packages/model/src/constants.ts", "bun.lock", ...currentDocs]
  const originals = new Map(await Promise.all(files.map(async (file) => [file, await fs.readFile(path.join(root, file), "utf8")])))
  const updates = new Map()

  const manifestFile = "packages/cli/package.json"
  const manifest = jsonObject(manifestFile, originals.get(manifestFile))
  if (stringProperty(manifest.object, "name", manifestFile).text !== "design-rover") throw new Error("The release package must be design-rover.")
  const packageVersion = stringProperty(manifest.object, "version", manifestFile)
  const previousVersion = packageVersion.text
  requireVersion(previousVersion)
  updates.set(manifestFile, replaceString(originals.get(manifestFile), manifest.source, packageVersion, version))

  const constantsFile = "packages/model/src/constants.ts"
  const constantsText = originals.get(constantsFile)
  const constantsSource = ts.createSourceFile(constantsFile, constantsText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (constantsSource.parseDiagnostics.length) throw new Error(`Cannot parse ${constantsFile}.`)
  const declarations = constantsSource.statements.filter((statement) => ts.isVariableStatement(statement)
    && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
    .flatMap((statement) => [...statement.declarationList.declarations])
    .filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "CLI_VERSION")
  if (declarations.length !== 1 || !declarations[0].initializer || !ts.isStringLiteral(declarations[0].initializer)) {
    throw new Error(`Expected one exported CLI_VERSION string constant in ${constantsFile}.`)
  }
  const constantVersion = declarations[0].initializer
  if (constantVersion.text !== previousVersion) throw new Error("CLI_VERSION and the public package version disagree; repair the release identity before preparing it.")
  updates.set(constantsFile, replaceString(constantsText, constantsSource, constantVersion, version))

  const lockFile = "bun.lock"
  const lock = jsonObject(lockFile, originals.get(lockFile))
  const workspaces = property(lock.object, "workspaces", lockFile)
  if (!ts.isObjectLiteralExpression(workspaces)) throw new Error("bun.lock workspaces must be an object.")
  const cliWorkspace = property(workspaces, "packages/cli", lockFile)
  if (!ts.isObjectLiteralExpression(cliWorkspace)) throw new Error("bun.lock packages/cli workspace must be an object.")
  if (stringProperty(cliWorkspace, "name", lockFile).text !== "design-rover") throw new Error("bun.lock packages/cli is not the public design-rover workspace.")
  const lockVersion = stringProperty(cliWorkspace, "version", lockFile)
  requireVersion(lockVersion.text)
  updates.set(lockFile, replaceString(originals.get(lockFile), lock.source, lockVersion, version))

  const localNotes = `docs/releases/v${version}.md`
  const hasLocalNotes = await fs.stat(path.join(root, localNotes)).then((stat) => stat.isFile(), (error) => {
    if (error.code === "ENOENT") return false
    throw error
  })
  for (const file of currentDocs) {
    let text = replacePinnedVersion(originals.get(file), previousVersion, version)
    if (!hasLocalNotes) {
      const releaseUrl = `https://github.com/nisargkavi/design-rover/releases/tag/v${version}`
      text = text.replaceAll(`](${localNotes})`, `](${releaseUrl})`)
        .replaceAll(`](releases/v${version}.md)`, `](${releaseUrl})`)
    }
    updates.set(file, text)
  }

  // Read and validate every required edit before the first mutation. All other
  // package versions, dependency ranges, JSONC comments and old release notes stay intact.
  const changed = [...updates].filter(([file, text]) => text !== originals.get(file))
  for (const [file, text] of changed) await fs.writeFile(path.join(root, file), text, "utf8")
  return { previousVersion, version, files: changed.map(([file]) => file) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await setReleaseVersion(process.argv[2])
    console.log(`Prepared design-rover ${result.version}: ${result.files.length} files updated.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
