// Public URLs for spec sections referenced in user-facing messages
// (CLI help, hook deny reasons, tool descriptions consumed by other
// repositories' agents). meta-edit ships as a Claude Code plugin to
// downstream projects, so any reference to a path inside this repo
// (`docs/SPEC.md`, `CLAUDE.md`, `OBSERVED-FAILURES.md`) is dead in the
// consumer's checkout. Resolve those references to their published URL
// instead, version-pinned to the running build.
//
// See dogfood-009 (issues/v0.1.3-dogfood/009).

import { VERSION } from "./version.js";

const BASE = `https://github.com/hiniachi/meta-edit/blob/v${VERSION}`;

// Top-level spec entry point. Used by `meta-edit --help`.
export const SPEC_URL = `${BASE}/docs/SPEC.md`;

// Section 4: the seventeen tool descriptions. Used by deny-raw-edit so
// the agent knows where to look up which edit_* tool fits its change.
export const SPEC_TOOLS_URL = `${BASE}/docs/SPEC.md#4-the-seventeen-tool-descriptions`;

// Section 5.2: bash-write-bypass hook contract, including the formatter
// / codegen allowlist. Used by deny-bash-write-bypass so the agent
// knows where to consult the allowlist and propose extensions.
export const SPEC_BASH_HOOK_URL = `${BASE}/docs/SPEC.md#52-deny-bash-write-bypass`;
