---
id: dogfood-008
category: ux/install-flow
severity: LOW
affected_files: [docs/]
---

# [UX] Marketplace clone does not auto-update on `/plugin install` — manual git pull required

## Summary

After PR #38 merged to main, calling `/plugin install meta-edit@meta-edit` and `/reload-plugins` continued to install v0.1.0 because the marketplace clone at `~/.claude/plugins/marketplaces/meta-edit/` was at the old commit (3e4bdb9). To pick up the new version I had to manually `cd ~/.claude/plugins/marketplaces/meta-edit && git pull origin main` and clear `~/.claude/plugins/cache/meta-edit/`.

There is no documentation in the repo telling users how to refresh the marketplace clone, so a fresh user installing meta-edit gets whatever stale version Claude Code happened to have cloned previously.

## Suggested fix direction

Add a short troubleshooting paragraph to README explaining the refresh procedure, OR investigate whether Claude Code has a `/plugin update` flow that should fetch but currently does not.

## Out of scope notes

This may be a Claude Code-side limitation; if so, the README note is a workaround until upstream supports automatic refresh.
