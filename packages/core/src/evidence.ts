export type FileKind = "script" | "style" | "json" | "other"

export type ClassHit = {
  file: string
  classes: string[]
  dynamic: boolean
  exported: boolean
  kind: "jsx" | "cva" | "const" | "css"
  componentName?: string
  startLine?: number
}

export type ImportHit = {
  file: string
  source: string
  names: string[]
  defaultName?: string
  bindings?: { local: string; imported: string; isTypeOnly?: boolean }[]
  isTypeOnly: boolean
}

export type JsxHit = {
  file: string
  tag: string
  isComponent: boolean
  classes: string[]
  attributes: Record<string, string>
  startLine: number
  selfClosing: boolean
  styleProperties?: string[]
}

export type CommentHit = {
  file: string
  text: string
  startLine: number
}

export type ExtractedProp = {
  name: string
  type?: string
  required: boolean
  values?: string[]
  defaultValue?: string
}

export type ExtractedComponent = {
  name: string
  file: string
  exportName: string
  isDefault: boolean
  exported: boolean
  props: ExtractedProp[]
  variants: string[]
  sizes: string[]
  composition: string[]
  classNames: string[]
  startLine: number
}

export type SectionHit = {
  file: string
  nameHint?: string
  startLine: number
  tags: string[]
  components: string[]
  classFamilies: string[]
  childCount: number
  depth: number
  heading?: string
}

export type ImageHit = {
  file: string
  tag: string
  src?: string
  startLine: number
  nextImage: boolean
  placeholder: boolean
}

export type FileEvidence = {
  relative: string
  hash: string
  kind: FileKind
  content: string
  components: ExtractedComponent[]
  classes: ClassHit[]
  imports: ImportHit[]
  jsx: JsxHit[]
  comments: CommentHit[]
  sections: SectionHit[]
  images: ImageHit[]
  cssVariables: { name: string; value: string; line?: number; scope?: string; mode?: string; important?: boolean }[]
  exportedClassConstants: string[]
}

export type RepoEvidence = {
  root: string
  files: FileEvidence[]
  packageJson?: Record<string, unknown>
  componentsJson?: Record<string, unknown>
  tsconfigPaths: Record<string, string[]>
}
