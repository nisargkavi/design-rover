import assert from "node:assert/strict"

assert.match(process.env.PR_TITLE ?? "", /^(feat|fix|docs|chore|refactor|perf|test|build|ci|style|revert)(?:\([^\r\n()]+\))?!?: \S[^\r\n]*$/, "Use a Conventional Commit PR title, e.g. fix: preserve approvals or feat: add token queries. Use ! for a breaking change.")
