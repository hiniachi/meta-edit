#!/usr/bin/env node
import { handleCodexHookPayload } from "./hook-entrypoint.js";
import {
  readCodexHookStdin,
  renderCodexHookResponse,
} from "./hook-runtime.js";

async function main(): Promise<number> {
  const payload = await readCodexHookStdin();
  const response = await handleCodexHookPayload(payload);
  if (Object.keys(response).length > 0) {
    process.stdout.write(JSON.stringify(response));
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stdout.write(
      JSON.stringify(
        renderCodexHookResponse({
          decision: "deny",
          reason: `meta-edit Codex session-onboarding hook crashed: ${(err as Error).message}`,
        }),
      ),
    );
    process.exit(0);
  },
);
