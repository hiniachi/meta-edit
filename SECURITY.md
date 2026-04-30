# Security policy

## Supported versions

Only the latest released version of `@hiniachi/meta-edit` receives
security fixes. Pre-1.0 releases (`0.x`) carry no formal support
guarantee but security issues will be addressed promptly.

## Threat model

`meta-edit` is a single-user development tool. It runs in the user's
shell with the user's filesystem permissions. The threat model is:

- An AI coding agent **inside the same user account** that may
  attempt to write to files outside the kind-specific `edit_*` tool
  surface.
- A patch payload **supplied to the MCP server** that may try to
  modify protected paths, escape the repository root, or trigger
  a denial-of-service in the diff parser.

Out of scope:

- Multi-user / privilege-boundary attacks (root-vs-user, container
  escape).
- A determined human attacker with shell access (they have full
  filesystem access by definition; meta-edit only raises the cost of
  obvious shell-level bypasses).

See [`OBSERVED-FAILURES.md`](./OBSERVED-FAILURES.md) for accepted
limitations of the bash hook and the patch applier.

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Email the maintainer directly:

> nia@yukinofurumachi.com

Please include:

- The affected component (`edit_*` tool name, hook name, or CLI
  subcommand).
- A minimal reproducer: the exact MCP request, hook event JSON, or
  CLI invocation that triggers the vulnerability.
- Why you believe it crosses a security boundary (path traversal,
  protected-path bypass, log tampering, denial-of-service, etc.).
- Your assessment of severity and any suggested mitigation.

You will receive an acknowledgement within 7 days. If the issue is
confirmed, a fix is targeted within 30 days for HIGH/CRITICAL
findings, sooner for actively-exploited issues.

## Disclosure

After a fix is released, the vulnerability and reporter (with
permission) will be credited in the release notes and in
`OBSERVED-FAILURES.md` if a partial mitigation remains.
