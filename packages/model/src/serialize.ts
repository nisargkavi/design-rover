function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map(sortValue)
    if (
      mapped.every(
        (item) => isPlainObject(item) && typeof item.id === "string",
      )
    ) {
      return [...mapped].sort((a, b) => {
        const left = String((a as { id: string }).id)
        const right = String((b as { id: string }).id)
        return left.localeCompare(right)
      })
    }
    return mapped
  }
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortValue(value[key])
    }
    return sorted
  }
  return value
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`
}

export function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
