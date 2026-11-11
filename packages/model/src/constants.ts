export const MODEL_VERSION = 1 as const

export const PRODUCT_NAME = "Design Rover"
export const CLI_PACKAGE = "design-rover"
export const CLI_VERSION = "0.3.1"
export const SPEC_DIR = ".design-rover"
export const MANAGED_START = "<!-- design-rover:start -->"
export const MANAGED_END = "<!-- design-rover:end -->"

export const KNOWLEDGE_STATUSES = [
  "observed",
  "inferred",
  "suggested",
  "approved",
  "deprecated",
  "rejected",
] as const

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const

export const SOURCE_KINDS = [
  "implementation",
  "figma",
  "storybook",
  "docs",
  "human",
  "generated",
] as const

export const TOKEN_CATEGORIES = [
  "color",
  "semantic-color",
  "spacing",
  "typography",
  "radius",
  "shadow",
  "breakpoint",
  "motion",
  "z-index",
  "other",
] as const

export const ENTITY_KINDS = [
  "token",
  "component",
  "pattern",
  "convention",
  "intent",
  "exception",
  "projection",
  "source",
] as const

export const DIAGNOSTIC_SEVERITIES = ["error", "warning", "info"] as const

export const SYNC_STATES = [
  "uninitialized",
  "synchronized",
  "drift",
  "pending-review",
] as const
