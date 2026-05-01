// Single source of truth for the runtime version string. Imports
// directly from package.json so a `npm version` bump (or manual edit)
// propagates to every consumer — the CLI `--version` / `--help`
// banner and the MCP server's advertised `serverInfo.version` —
// without separate edits that drift apart over time.
//
// `resolveJsonModule: true` in tsconfig.json + `bun build`'s ESM
// bundler both honor this import; the runtime sees an inlined
// constant after the build step.
import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;
