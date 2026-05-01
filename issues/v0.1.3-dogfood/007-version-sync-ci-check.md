---
id: dogfood-007
category: ci/version-drift
severity: MEDIUM
affected_files: [.github/workflows/, package.json, .claude-plugin/plugin.json]
---

# [CI] Add a check that asserts package.json.version === plugin.json.version

## Summary

PR #38 bumped `package.json` to 0.1.3 but missed `.claude-plugin/plugin.json`, which stayed at 0.1.2. PR #39 caught and fixed the drift, but the next time someone bumps a version they will hit the same trap. CI should catch it.

Claude Code plugin manager reads `plugin.json.version` for the marketplace "latest version" lookup, so out-of-sync values silently break `/plugin install` discovery.

## Suggested fix direction

Add a small CI check (extend the existing `verify-dist` workflow or create `verify-version-sync`):

```yaml
- name: assert version sync
  run: |
    pkg=$(jq -r .version package.json)
    plg=$(jq -r .version .claude-plugin/plugin.json)
    if [ "$pkg" != "$plg" ]; then
      echo "::error::package.json.version ($pkg) != plugin.json.version ($plg)" >&2
      exit 1
    fi
```

Run on `pull_request: main`. Fails the PR if either file is bumped without the other.

## Out of scope notes

Could be extended to assert `src/version.ts` (which imports from package.json) actually resolves to the same value at build time, but that should be a follow-up.
