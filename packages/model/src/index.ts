import {
  MANAGED_END,
  MANAGED_START,
  MODEL_VERSION,
  SPEC_DIR,
} from "./constants.ts"
export * from "./constants.ts"
export * from "./ids.ts"
export * from "./schema.ts"
export * from "./serialize.ts"

export const markers = {
  start: MANAGED_START,
  end: MANAGED_END,
  dir: SPEC_DIR,
  version: MODEL_VERSION,
}
