export default {
  branches: ["main"],
  repositoryUrl: "https://github.com/nisargkavi/design-rover.git",
  tagFormat: "v${version}",
  plugins: [
    ["@semantic-release/commit-analyzer", { preset: "conventionalcommits" }],
    ["@semantic-release/release-notes-generator", { preset: "conventionalcommits" }],
    "./scripts/release-plugin.mjs",
    ["@semantic-release/git", {
      assets: ["packages/cli/package.json", "packages/model/src/constants.ts", "bun.lock", "README.md", "packages/cli/README.md", "docs/usage.md", "docs/development.md", "docs/releases/*.md"],
      message: "chore(release): ${nextRelease.version} [skip ci]",
    }],
  ],
}
