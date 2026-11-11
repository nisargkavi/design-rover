import { z } from "zod"
import {
  CONFIDENCE_LEVELS,
  DIAGNOSTIC_SEVERITIES,
  ENTITY_KINDS,
  KNOWLEDGE_STATUSES,
  MODEL_VERSION,
  SOURCE_KINDS,
  SYNC_STATES,
  TOKEN_CATEGORIES,
} from "./constants.ts"

export const KnowledgeStatusSchema = z.enum(KNOWLEDGE_STATUSES)
export const ConfidenceSchema = z.enum(CONFIDENCE_LEVELS)
export const SourceKindSchema = z.enum(SOURCE_KINDS)
export const TokenCategorySchema = z.enum(TOKEN_CATEGORIES)
export const EntityKindSchema = z.enum(ENTITY_KINDS)
export const DiagnosticSeveritySchema = z.enum(DIAGNOSTIC_SEVERITIES)
export const SyncStateSchema = z.enum(SYNC_STATES)

export const SourceLocationSchema = z.object({
  file: z.string(),
  startLine: z.number().int().optional(),
  startColumn: z.number().int().optional(),
  endLine: z.number().int().optional(),
  endColumn: z.number().int().optional(),
})

export const EvidenceSchema = z.object({
  id: z.string(),
  kind: z.string(),
  description: z.string(),
  location: SourceLocationSchema.optional(),
  snippet: z.string().optional(),
  count: z.number().int().optional(),
  weight: z.number().optional(),
})

export const KnowledgeMetaSchema = z.object({
  status: KnowledgeStatusSchema,
  confidence: ConfidenceSchema,
  originKind: SourceKindSchema,
  evidence: z.array(EvidenceSchema).default([]),
  notes: z.string().optional(),
  approvedAt: z.string().optional(),
  approvedBy: z.string().optional(),
})

export const TokenRecordSchema = KnowledgeMetaSchema.extend({
  id: z.string(),
  name: z.string(),
  category: TokenCategorySchema,
  value: z.string(),
  scope: z.string().optional(),
  mode: z.string().optional(),
  important: z.boolean().optional(),
  cssVariable: z.string().optional(),
  origin: z.string(),
  usageCount: z.number().int().default(0),
})

export const ComponentPropSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  required: z.boolean().default(false),
  defaultValue: z.string().optional(),
  values: z.array(z.string()).optional(),
})

export const ComponentUsageSchema = z.object({
  file: z.string(),
  count: z.number().int(),
})

export const ComponentPropsResolutionSchema = z.object({
  status: z.enum(["resolved", "partial", "unresolved", "untyped"]),
  issues: z.array(z.string()).default([]),
})

export const ComponentRecordSchema = KnowledgeMetaSchema.extend({
  id: z.string(),
  name: z.string(),
  source: z.string(),
  importPath: z.string(),
  exportName: z.string(),
  props: z.array(ComponentPropSchema).default([]),
  propsResolution: ComponentPropsResolutionSchema.optional(),
  variants: z.array(z.string()).default([]),
  sizes: z.array(z.string()).default([]),
  composition: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  relatedTokens: z.array(z.string()).default([]),
  usage: z.array(ComponentUsageSchema).default([]),
  examples: z.array(z.string()).default([]),
  architecture: z
    .enum(["shared", "feature-local", "colocated"])
    .default("shared"),
  local: z.boolean().default(false),
})

export const PatternOccurrenceSchema = z.object({
  file: z.string(),
  nameHint: z.string().optional(),
  startLine: z.number().int().optional(),
  fingerprint: z.string(),
})

export const PatternRecordSchema = KnowledgeMetaSchema.extend({
  id: z.string(),
  name: z.string(),
  occurrences: z.array(PatternOccurrenceSchema).default([]),
  implementation: z
    .enum(["colocated", "shared-component", "mixed"])
    .default("colocated"),
  architecture: z
    .enum(["do-not-extract", "already-extracted", "unknown"])
    .default("do-not-extract"),
  similarity: z.number().min(0).max(1).default(0),
  fingerprint: z.string(),
  guidance: z
    .string()
    .default("Describe the pattern. Do not extract it automatically."),
})

export const ConventionRecordSchema = KnowledgeMetaSchema.extend({
  id: z.string(),
  name: z.string(),
  category: z.enum([
    "styling",
    "architecture",
    "imports",
    "assets",
    "organization",
    "enforcement",
  ]),
  observed: z.string(),
  inference: z.string(),
  suggestion: z.string(),
  guidance: z.string(),
  metric: z
    .object({
      numerator: z.number(),
      denominator: z.number(),
      label: z.string(),
    })
    .optional(),
})

export const IntentRecordSchema = KnowledgeMetaSchema.extend({
  id: z.string(),
  subject: z.string(),
  type: z.enum([
    "image",
    "illustration",
    "cta",
    "content",
    "accessibility",
    "interaction",
    "semantic",
    "todo",
    "responsive",
  ]),
  required: z.boolean().default(false),
  optional: z.boolean().default(false),
  placeholderAllowed: z.boolean().default(false),
  productionAssetRequired: z.boolean().default(false),
  intentStatus: z
    .enum(["placeholder", "resolved", "missing", "optional", "unknown"])
    .default("unknown"),
  sourceRefs: z.array(EvidenceSchema).default([]),
})

export const ExceptionRecordSchema = KnowledgeMetaSchema.extend({
  id: z.string(),
  name: z.string(),
  reason: z.string(),
  allows: z.array(z.string()).default([]),
  scope: z.object({
    paths: z.array(z.string()).default([]),
    components: z.array(z.string()).default([]),
  }),
})

export const RejectionRecordSchema = z.object({
  fingerprint: z.string(),
  kind: EntityKindSchema,
  summary: z.string(),
  reason: z.string().optional(),
  rejectedAt: z.string(),
})

export const BaselineFindingSchema = z.object({
  fingerprint: z.string(),
  kind: z.string(),
  summary: z.string(),
  location: SourceLocationSchema.optional(),
})

export const BaselineRecordSchema = z.object({
  capturedAt: z.string(),
  findings: z.array(BaselineFindingSchema).default([]),
})

export const ExternalSourceSchema = z.object({
  id: z.string(),
  kind: z.enum(["figma", "storybook", "docs", "registry", "other"]),
  name: z.string(),
  authority: z.enum(["evidence", "canonical"]).default("evidence"),
  location: z.string().optional(),
  lastImportedAt: z.string().optional(),
})

export const SourceDiscrepancySchema = z.object({
  id: z.string(),
  subject: z.string(),
  property: z.string(),
  codeValue: z.string(),
  designValue: z.string(),
  status: z.enum(["unresolved", "keep-code", "keep-design", "exception"]),
})

export const GeneratedFileSchema = z.object({
  path: z.string(),
  hash: z.string(),
  managed: z.boolean().default(true),
})

export const HistoryEventSchema = z.object({
  ts: z.string(),
  type: z.string(),
  entity: z.string().optional(),
  summary: z.string(),
})

export const FrameworkInfoSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
})

export const StylingInfoSchema = z.object({
  systems: z.array(z.string()).default([]),
})

export const EnforcementInfoSchema = z.object({
  shadcnLint: z
    .object({
      available: z.boolean(),
      configured: z.boolean(),
      mappedRules: z.array(z.string()).default([]),
    })
    .optional(),
})

export const SystemRecordSchema = z.object({
  version: z.literal(MODEL_VERSION).default(MODEL_VERSION),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSyncAt: z.string().optional(),
  lastAnalyzedAt: z.string().optional(),
  repository: z.object({
    name: z.string(),
    root: z.string().optional(),
  }),
  framework: FrameworkInfoSchema,
  styling: StylingInfoSchema,
  componentLibraries: z.array(z.string()).default([]),
  documentation: z.array(z.string()).default([]),
  syncStatus: SyncStateSchema.default("pending-review"),
  enforcement: EnforcementInfoSchema.default({}),
  generated: z.array(GeneratedFileSchema).default([]),
  privacy: z
    .object({
      network: z.enum(["off", "explicit"]).default("off"),
    })
    .default({ network: "off" }),
  generate: z
    .object({
      agentsMd: z.boolean().default(true),
      claudeMd: z.boolean().default(true),
      cursorRules: z.boolean().default(true),
      skill: z.boolean().default(true),
    })
    .default({
      agentsMd: true,
      claudeMd: true,
      cursorRules: true,
      skill: true,
    }),
})

export const CanonicalModelSchema = z.object({
  system: SystemRecordSchema,
  tokens: z.array(TokenRecordSchema).default([]),
  components: z.array(ComponentRecordSchema).default([]),
  patterns: z.array(PatternRecordSchema).default([]),
  conventions: z.array(ConventionRecordSchema).default([]),
  intents: z.array(IntentRecordSchema).default([]),
  exceptions: z.array(ExceptionRecordSchema).default([]),
  rejections: z.array(RejectionRecordSchema).default([]),
  baseline: BaselineRecordSchema.optional(),
  sources: z.array(ExternalSourceSchema).default([]),
  discrepancies: z.array(SourceDiscrepancySchema).default([]),
  history: z.array(HistoryEventSchema).default([]),
})

export const ObservedSnapshotSchema = z.object({
  analyzedAt: z.string(),
  filesAnalyzed: z.number().int(),
  incremental: z.boolean().default(false),
  changedFiles: z.array(z.string()).default([]),
  tokens: z.array(TokenRecordSchema).default([]),
  components: z.array(ComponentRecordSchema).default([]),
  patterns: z.array(PatternRecordSchema).default([]),
  conventions: z.array(ConventionRecordSchema).default([]),
  intents: z.array(IntentRecordSchema).default([]),
  exceptions: z.array(ExceptionRecordSchema).default([]),
  framework: FrameworkInfoSchema,
  styling: StylingInfoSchema,
  componentLibraries: z.array(z.string()).default([]),
  documentation: z.array(z.string()).default([]),
})

export const ChangeKindSchema = z.enum(["add", "update", "remove", "stale"])

export const ModelChangeSchema = z.object({
  id: z.string(),
  kind: ChangeKindSchema,
  entity: EntityKindSchema,
  name: z.string(),
  summary: z.string(),
  details: z.array(z.string()).default([]),
  fingerprint: z.string(),
  confidence: ConfidenceSchema,
  status: KnowledgeStatusSchema,
  certain: z.boolean().default(true),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
})

export const SystemDiffSchema = z.object({
  syncStatus: SyncStateSchema,
  changes: z.array(ModelChangeSchema),
  counts: z.object({
    components: z.number().int(),
    tokens: z.number().int(),
    patterns: z.number().int(),
    conventions: z.number().int(),
    intents: z.number().int(),
    exceptions: z.number().int(),
  }),
  generated: z.object({
    stale: z.array(z.string()).default([]),
    changed: z.array(z.string()).default([]),
  }),
})

export const DiagnosticSchema = z.object({
  id: z.string(),
  severity: DiagnosticSeveritySchema,
  title: z.string(),
  why: z.string(),
  related: z.string().optional(),
  action: z.string(),
  certainty: z.enum(["certain", "inferred"]),
  fingerprint: z.string(),
  location: SourceLocationSchema.optional(),
  baseline: z.boolean().default(false),
  introducedByChange: z.boolean().optional(),
})

export const CheckReportSchema = z.object({
  syncStatus: SyncStateSchema,
  diagnostics: z.array(DiagnosticSchema),
  preservedArchitecture: z.boolean().default(true),
})

export const StatusReportSchema = z.object({
  syncStatus: SyncStateSchema,
  initialized: z.boolean(),
  lastSyncAt: z.string().optional(),
  lastAnalyzedAt: z.string().optional(),
  counts: z.object({
    components: z.number().int(),
    tokens: z.number().int(),
    patterns: z.number().int(),
    conventions: z.number().int(),
    intents: z.number().int(),
    exceptions: z.number().int(),
  }),
  pendingChanges: z.number().int(),
  staleGenerated: z.array(z.string()).default([]),
  enforcement: EnforcementInfoSchema,
  repository: z.string(),
  baselineCaptured: z.boolean(),
})

export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>
export type Confidence = z.infer<typeof ConfidenceSchema>
export type SourceKind = z.infer<typeof SourceKindSchema>
export type TokenCategory = z.infer<typeof TokenCategorySchema>
export type EntityKind = z.infer<typeof EntityKindSchema>
export type Evidence = z.infer<typeof EvidenceSchema>
export type TokenRecord = z.infer<typeof TokenRecordSchema>
export type ComponentRecord = z.infer<typeof ComponentRecordSchema>
export type PatternRecord = z.infer<typeof PatternRecordSchema>
export type ConventionRecord = z.infer<typeof ConventionRecordSchema>
export type IntentRecord = z.infer<typeof IntentRecordSchema>
export type ExceptionRecord = z.infer<typeof ExceptionRecordSchema>
export type RejectionRecord = z.infer<typeof RejectionRecordSchema>
export type BaselineRecord = z.infer<typeof BaselineRecordSchema>
export type ExternalSource = z.infer<typeof ExternalSourceSchema>
export type SourceDiscrepancy = z.infer<typeof SourceDiscrepancySchema>
export type HistoryEvent = z.infer<typeof HistoryEventSchema>
export type SystemRecord = z.infer<typeof SystemRecordSchema>
export type CanonicalModel = z.infer<typeof CanonicalModelSchema>
export type ObservedSnapshot = z.infer<typeof ObservedSnapshotSchema>
export type ModelChange = z.infer<typeof ModelChangeSchema>
export type SystemDiff = z.infer<typeof SystemDiffSchema>
export type Diagnostic = z.infer<typeof DiagnosticSchema>
export type CheckReport = z.infer<typeof CheckReportSchema>
export type StatusReport = z.infer<typeof StatusReportSchema>
export type GeneratedFile = z.infer<typeof GeneratedFileSchema>
export type ComponentProp = z.infer<typeof ComponentPropSchema>
export type ComponentPropsResolution = z.infer<typeof ComponentPropsResolutionSchema>
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeveritySchema>
export type SyncState = z.infer<typeof SyncStateSchema>
export type ChangeKind = z.infer<typeof ChangeKindSchema>
