export function slugify(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
}

export function entityId(kind: string, name: string): string {
  return `${kind}.${slugify(name)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}
