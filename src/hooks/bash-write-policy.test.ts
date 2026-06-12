import { describe, it, expect } from "bun:test";
import {
  evaluateBashCommand,
  ALLOWLIST_PATTERNS,
  DENY_SUBSTRINGS,
  DENY_PREFIX_PATTERNS,
  WARN_PREFIX_PATTERNS,
} from "./bash-write-policy.js";

describe("evaluateBashCommand — deny patterns", () => {
  const denyCases: Array<[string, string]> = [
    ["sed -i 's/foo/bar/' src/foo.ts", "sed -i"],
    ["sed --in-place 's/foo/bar/' src/foo.ts", "sed --in-place"],
    ["perl -pi -e 's/foo/bar/' src/foo.ts", "perl -pi"],
    ["perl -i.bak -pe 's/x/y/' src/foo.ts", "perl -i"],
    ["cat > src/foo.ts <<'EOF'\nhello\nEOF", "cat >"],
    ["cat >> src/log.txt", "cat >>"],
    ["echo hi | tee src/foo.ts", "tee "],
    ["echo hi | tee -a src/log.txt", "tee -a"],
    ["git apply patch.diff", "git apply"],
    ["patch -p1 < changes.diff", "patch"],
  ];
  for (const [command, label] of denyCases) {
    it(`denies "${label}"`, () => {
      const r = evaluateBashCommand(command);
      expect(r.decision).toBe("deny");
      expect(r.reason).toBeDefined();
    });
  }

  // v0.4.3: mv/cp/rsync relaxed from deny to warn (SPEC §5.2). They
  // are no longer denied standalone; the verb-warn fires instead.
  // patch stays on deny (above).
  const warnCases: Array<[string, string]> = [
    ["rsync -a src/ dst/", "rsync"],
    ["mv src/old.ts src/new.ts", "mv"],
    ["cp src/foo.ts src/bar.ts", "cp"],
  ];
  for (const [command, label] of warnCases) {
    it(`warns on "${label}"`, () => {
      const r = evaluateBashCommand(command);
      expect(r.decision).toBe("warn");
      expect(r.reason).toBeDefined();
    });
  }
});

describe("evaluateBashCommand — allowlist", () => {
  const allowCases: Array<[string, string]> = [
    ["prettier --write 'src/**/*.ts'", "prettier"],
    ["eslint --fix src/", "eslint"],
    ["gofmt -w .", "gofmt"],
    ["cargo fmt", "cargo fmt"],
    ["ruff --fix src/", "ruff --fix"],
    ["ruff format src/", "ruff format"],
    ["black src/foo.py", "black"],
    ["prisma generate", "prisma"],
    ["openapi-generator generate -i spec.yaml -g typescript-axios -o ./gen", "openapi-generator"],
    ["swagger-codegen generate -i spec.json -l typescript-axios", "swagger-codegen"],
  ];
  for (const [command, label] of allowCases) {
    it(`allows "${label}"`, () => {
      const r = evaluateBashCommand(command);
      expect(r.decision).toBe("allow");
    });
  }
});

describe("evaluateBashCommand — protected paths override allowlist", () => {
  it("denies even an allowlisted command if it touches .meta-edit/state/", () => {
    const r = evaluateBashCommand(
      "prettier --write .meta-edit/state/edits.jsonl",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected meta-edit path");
  });

  it("denies even an allowlisted command if it touches .meta-edit/tmp/", () => {
    const r = evaluateBashCommand("eslint --fix .meta-edit/tmp/scratch.txt");
    expect(r.decision).toBe("deny");
  });

  it("denies sed -i targeting .meta-edit/state/ with the protected reason (caught early)", () => {
    const r = evaluateBashCommand("sed -i 's/x/y/' .meta-edit/state/edits.jsonl");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected meta-edit path");
  });
});

describe("evaluateBashCommand — python -c / node -e", () => {
  it("denies python -c with write_text", () => {
    const r = evaluateBashCommand(
      "python -c \"import pathlib; pathlib.Path('src/foo.ts').write_text('x')\"",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("python");
  });

  it("denies python -c with open(...,'w')", () => {
    const r = evaluateBashCommand(
      "python -c \"open('src/foo.ts','w').write('x')\"",
    );
    expect(r.decision).toBe("deny");
  });

  it("allows python -c without write keywords", () => {
    expect(
      evaluateBashCommand("python -c 'print(1+1)'").decision,
    ).toBe("allow");
  });

  it("denies node -e with writeFileSync", () => {
    const r = evaluateBashCommand(
      "node -e \"require('fs').writeFileSync('src/foo.ts','x')\"",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("node");
  });

  it("denies node --eval (long form) with writeFileSync", () => {
    const r = evaluateBashCommand(
      "node --eval \"require('fs').writeFileSync('src/foo.ts','x')\"",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("node");
  });

  it("denies node --eval=EXPR (long form with =) with writeFileSync", () => {
    const r = evaluateBashCommand(
      "node --eval=\"require('fs').writeFileSync('src/foo.ts','x')\"",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("node");
  });

  it("allows node -e without write keywords", () => {
    expect(
      evaluateBashCommand("node -e 'console.log(1+1)'").decision,
    ).toBe("allow");
  });

  it("allows node --eval without write keywords", () => {
    expect(
      evaluateBashCommand("node --eval 'console.log(1+1)'").decision,
    ).toBe("allow");
  });

  it("allows node --eval=EXPR without write keywords", () => {
    expect(
      evaluateBashCommand("node --eval='console.log(1+1)'").decision,
    ).toBe("allow");
  });
});

describe("evaluateBashCommand — happy path", () => {
  it("allows ordinary read commands", () => {
    expect(evaluateBashCommand("ls -la").decision).toBe("allow");
    expect(evaluateBashCommand("git status").decision).toBe("allow");
    expect(evaluateBashCommand("npm test").decision).toBe("allow");
    expect(evaluateBashCommand("bun test").decision).toBe("allow");
  });

  it("allows an empty command (treated as no-op)", () => {
    expect(evaluateBashCommand("").decision).toBe("allow");
  });
});

describe("evaluateBashCommand — chained-segment bypass", () => {
  it("denies when a deny segment follows an allowlist-style segment via ;", () => {
    const r = evaluateBashCommand(
      "prettier --write src/ ; sed -i 's/x/y/' src/foo.ts",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("sed -i");
  });

  it("denies when a deny segment follows an allowlist-style segment via &&", () => {
    const r = evaluateBashCommand(
      "cargo fmt && cat > src/foo.ts <<EOF\nhi\nEOF",
    );
    expect(r.decision).toBe("deny");
  });

  it("denies when a deny segment follows an allowlist-style segment via |", () => {
    const r = evaluateBashCommand(
      "echo hi | tee src/foo.ts && eslint --fix src/",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("tee");
  });

  it("denies when a deny segment follows via bare & (background fork)", () => {
    const r = evaluateBashCommand(
      "prettier --write src/ & sed -i 's/x/y/' src/foo.ts",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("sed -i");
  });

  it("denies a deny pattern hidden inside process substitution", () => {
    const r = evaluateBashCommand(
      "prettier --write src/ <(sed -i 's/x/y/' src/foo.ts)",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("sed -i");
  });

  it("denies a deny pattern hidden inside a here-string", () => {
    const r = evaluateBashCommand(
      "prettier --write src/ <<< $(sed -i 's/x/y/' src/foo.ts)",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("sed -i");
  });

  it("denies a deny pattern hidden inside bash -c quoted compound", () => {
    const r = evaluateBashCommand(
      "bash -c \"prettier --write src/ && sed -i 's/x/y/' src/foo.ts\"",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("sed -i");
  });

  it("allows when every segment is independently a formatter / codegen", () => {
    const r = evaluateBashCommand("prettier --write src/ && cargo fmt && eslint --fix src/");
    expect(r.decision).toBe("allow");
  });
});

describe("evaluateBashCommand — prefix-only deny verbs", () => {
  it("warns on mv with tab argument separator", () => {
    const r = evaluateBashCommand("mv\tsrc/old.ts\tsrc/new.ts");
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("mv");
  });

  it("warns on cp with tab argument separator", () => {
    const r = evaluateBashCommand("cp\tsrc/a.ts\tsrc/b.ts");
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("cp");
  });

  it("warns on mv following a backgrounded allowlist segment via bare &", () => {
    // Without splitting on bare `&`, the whole string is one segment and
    // mv at position N is never seen as a segment-start prefix.
    const r = evaluateBashCommand("cargo fmt & mv src/a.ts src/b.ts");
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("mv");
  });

  it("warns on cp following bare &", () => {
    const r = evaluateBashCommand("eslint --fix src/ & cp src/a.ts src/b.ts");
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("cp");
  });

  it("denies patch following bare &", () => {
    const r = evaluateBashCommand("prettier --write src/ & patch -p1 < x.diff");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("patch");
  });

  it("does not split on `&>` stdout redirect", () => {
    // `echo foo &> /dev/null` is a redirect, not a background fork.
    // We must not split here; the trimmed segment start is `echo`, not
    // a deny verb, so this should allow.
    const r = evaluateBashCommand("echo foo &> /dev/null");
    expect(r.decision).toBe("allow");
  });

  it("does not split on `2>&1` fd duplication", () => {
    const r = evaluateBashCommand("ls 2>&1");
    expect(r.decision).toBe("allow");
  });

  it("does not split on `>&` redirect even when followed by content", () => {
    const r = evaluateBashCommand("exec 2>&1");
    expect(r.decision).toBe("allow");
  });

  it("strips leading env assignments before prefix matching (FOO=bar mv ... → warn)", () => {
    const r = evaluateBashCommand("FOO=bar mv src/a.ts src/b.ts");
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("mv");
  });

  it("strips multiple env assignments before prefix matching (→ warn)", () => {
    const r = evaluateBashCommand("FOO=bar BAZ=qux cp src/a.ts src/b.ts");
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("cp");
  });

  it("strips quoted env assignment values (→ warn)", () => {
    const r = evaluateBashCommand('LANG="en US.UTF-8" mv src/a.ts src/b.ts');
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("mv");
  });

  it("does not strip past a real command (FOO=bar followed by allowed cmd)", () => {
    const r = evaluateBashCommand("FOO=bar cargo fmt");
    expect(r.decision).toBe("allow");
  });
});

describe("evaluateBashCommand — protected paths without trailing slash", () => {
  it("denies a write to .meta-edit/state (no trailing slash)", () => {
    const r = evaluateBashCommand("cat > .meta-edit/state");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies a write to .meta-edit/tmp (no trailing slash)", () => {
    const r = evaluateBashCommand("cat > .meta-edit/tmp");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies path-equivalent spelling .meta-edit//state", () => {
    const r = evaluateBashCommand("cat > .meta-edit//state/edits.jsonl");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies path-equivalent spelling .meta-edit/./state", () => {
    const r = evaluateBashCommand("cat > .meta-edit/./state/edits.jsonl");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies repeated /./ chains", () => {
    const r = evaluateBashCommand("cat > .meta-edit/././state");
    expect(r.decision).toBe("deny");
  });

  it("denies a path that resolves into protected via /../", () => {
    // .meta-edit/logs/../state/x normalizes to .meta-edit/state/x
    const r = evaluateBashCommand("cat > .meta-edit/logs/../state/x");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies a deeper /../ traversal into protected", () => {
    const r = evaluateBashCommand("cat > .meta-edit/a/b/../../state/x");
    expect(r.decision).toBe("deny");
  });

  it("does not falsely match unrelated /../ that escapes the repo", () => {
    // ../../etc/passwd has no preceding segment to collapse with, so
    // the protected-path needles still don't match.
    const r = evaluateBashCommand("cat > ../../etc/passwd");
    // No deny pattern triggers — `cat >` IS a deny substring.
    // We expect deny here (substring), not the protected branch.
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("cat >");
  });

  it("does NOT trip protected for .meta-edit/../state/x (operationally `./state/x`)", () => {
    // Verify the collapse regex's behavior is operationally correct:
    // .meta-edit/../state/x resolves to ./state/x, NOT protected. The
    // command is denied via the `cat >` substring, not the protected
    // branch.
    const r = evaluateBashCommand("cat > .meta-edit/../state/x");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("cat >");
    expect(r.reason).not.toContain("protected");
  });

  it("DOES trip protected for /abs/path/.meta-edit/state/edits.jsonl", () => {
    const r = evaluateBashCommand(
      "cat > /tmp/work/.meta-edit/state/edits.jsonl",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });
});

describe("evaluateBashCommand — wrapper verbs and absolute-path bypass", () => {
  // v0.4.3: mv/cp resolve through the wrapper/abs-path machinery the
  // same way; the verb is still extracted, but the decision is now
  // `warn` (not `deny`). patch stays `deny`. These tables prove the
  // wrapper-peeling still reaches the verb on the relaxed path.
  const wrapperWarnCases: Array<[string, string, string]> = [
    ["sudo mv a b", "mv", "sudo"],
    ["doas mv a b", "mv", "doas"],
    ["env mv a b", "mv", "env"],
    ["nice mv a b", "mv", "nice"],
    ["ionice mv a b", "mv", "ionice"],
    ["nohup mv a b", "mv", "nohup"],
    ["time mv a b", "mv", "time"],
    ["xargs mv -t /tmp", "mv", "xargs"],
    ["env FOO=bar mv a b", "mv", "env+assignment"],
    ["sudo env FOO=bar mv a b", "mv", "sudo+env+assignment"],
    ["sudo cp a b", "cp", "sudo"],
  ];
  for (const [command, verb, label] of wrapperWarnCases) {
    it(`warns on ${verb} via ${label}: "${command}"`, () => {
      const r = evaluateBashCommand(command);
      expect(r.decision).toBe("warn");
      expect(r.reason).toContain(verb);
    });
  }

  const wrapperDenyCases: Array<[string, string, string]> = [
    ["xargs patch -p1", "patch", "xargs"],
  ];
  for (const [command, verb, label] of wrapperDenyCases) {
    it(`denies ${verb} via ${label}: "${command}"`, () => {
      const r = evaluateBashCommand(command);
      expect(r.decision).toBe("deny");
      expect(r.reason).toContain(verb);
    });
  }

  const absolutePathWarnCases: Array<[string, string]> = [
    ["/usr/bin/mv a b", "mv"],
    ["/bin/cp a b", "cp"],
    ["sudo /usr/bin/mv a b", "mv"],
  ];
  for (const [command, verb] of absolutePathWarnCases) {
    it(`warns on basename match for "${command}"`, () => {
      const r = evaluateBashCommand(command);
      expect(r.decision).toBe("warn");
      expect(r.reason).toContain(verb);
    });
  }

  it('denies basename match for "/usr/local/bin/patch -p1 < x.diff"', () => {
    const r = evaluateBashCommand("/usr/local/bin/patch -p1 < x.diff");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("patch");
  });

  it("does not deny a wrapped allowlist-style verb", () => {
    expect(evaluateBashCommand("sudo cargo fmt").decision).toBe("allow");
    expect(evaluateBashCommand("env prettier --write src/").decision).toBe("allow");
  });

  it("skips wrapper short-options before the verb (sudo -E mv ... → warn)", () => {
    const r = evaluateBashCommand("sudo -E mv src/a src/b");
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("mv");
  });

  it("skips wrapper short-options grouped (env -i mv ... → warn)", () => {
    const r = evaluateBashCommand("env -i mv src/a src/b");
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("mv");
  });

  it("skips wrapper long-options (env --ignore-environment mv ... → warn)", () => {
    const r = evaluateBashCommand("env --ignore-environment mv src/a src/b");
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("mv");
  });

  it("skips wrapper long-option=value (env --chdir=/tmp mv ... → warn)", () => {
    const r = evaluateBashCommand("env --chdir=/tmp mv src/a src/b");
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("mv");
  });

  it("skips multiple flag-only wrapper options before verb (→ warn)", () => {
    // Flag-only wrapper options (no value arg) are reliably stripped.
    // Wrappers with required value args (`sudo -u USER`, `env -u VAR`)
    // would need per-wrapper option grammars to peel correctly; that
    // is documented in OBSERVED-FAILURES.md as a v0.2 candidate.
    const r = evaluateBashCommand("sudo -E -n mv src/a src/b");
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("mv");
  });

  it("skips command -p prefix before verb (→ warn)", () => {
    const r = evaluateBashCommand("command -p cp src/a src/b");
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("cp");
  });
});

describe("evaluateBashCommand — backslash-escape bypass", () => {
  it("denies a backslash-escaped sed -i", () => {
    const r = evaluateBashCommand("s\\ed -i 's/x/y/' src/foo.ts");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("sed -i");
  });

  it("denies a backslash-escaped git apply", () => {
    const r = evaluateBashCommand("g\\it apply patch.diff");
    expect(r.decision).toBe("deny");
  });

  it("denies an escaped command nested in bash -c", () => {
    const r = evaluateBashCommand("bash -c 's\\ed -i s/x/y/ src/foo.ts'");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("sed -i");
  });
});

describe("constants", () => {
  it("exposes the documented allowlist set", () => {
    expect(ALLOWLIST_PATTERNS.length).toBeGreaterThan(0);
    expect(ALLOWLIST_PATTERNS).toContain("prettier --write");
    expect(ALLOWLIST_PATTERNS).toContain("cargo fmt");
  });
  it("exposes the documented deny substrings", () => {
    expect(DENY_SUBSTRINGS).toContain("sed -i");
    expect(DENY_SUBSTRINGS).toContain("git apply");
  });
  it("mechanically derives deny/warn prefixes from verb×separator", () => {
    // v0.4.3: prefix arrays are expandVerbPrefixes(names) over
    // [" ", "\t"]. patch stays on deny; mv/cp/rsync moved to warn.
    expect(DENY_PREFIX_PATTERNS).toContain("patch ");
    expect(DENY_PREFIX_PATTERNS).toContain("patch\t");
    expect(DENY_PREFIX_PATTERNS).not.toContain("mv ");
    expect(DENY_PREFIX_PATTERNS).not.toContain("cp ");
    expect(WARN_PREFIX_PATTERNS).toEqual([
      "mv ",
      "mv\t",
      "cp ",
      "cp\t",
      "rsync ",
      "rsync\t",
    ]);
  });
});

describe("evaluateBashCommand — read-only access to protected paths is allowed", () => {
  // Regression for OBSERVED-FAILURES.md "LOW: Read-only commands referencing
  // protected paths are blocked". Before the fix, ANY mention of the
  // protected substring tripped the deny — even read-only inspections
  // necessary for debugging (`tail`, `cat`, `wc`, `head`, `grep`, ...).
  // The fix carves out a small set of common read-only utilities so they
  // can inspect protected paths, while writes via these same verbs (using
  // a `>` / `>>` redirect whose target is protected) remain denied.

  it("allows tail of .meta-edit/state/edits.jsonl", () => {
    expect(evaluateBashCommand("tail -2 .meta-edit/state/edits.jsonl")).toEqual({
      decision: "allow",
    });
  });

  it("allows cat of a protected log", () => {
    expect(
      evaluateBashCommand("cat .meta-edit/state/edits.jsonl").decision,
    ).toBe("allow");
  });

  it("allows wc -l of a protected log", () => {
    expect(
      evaluateBashCommand("wc -l .meta-edit/state/edits.jsonl").decision,
    ).toBe("allow");
  });

  it("allows head of a protected tmp file", () => {
    expect(
      evaluateBashCommand("head .meta-edit/tmp/scratch.txt").decision,
    ).toBe("allow");
  });

  it("allows grep against a protected log", () => {
    expect(
      evaluateBashCommand("grep edit_docs_only .meta-edit/state/edits.jsonl")
        .decision,
    ).toBe("allow");
  });

  it("allows jq against a protected log", () => {
    expect(
      evaluateBashCommand("jq . .meta-edit/state/edits.jsonl").decision,
    ).toBe("allow");
  });

  it("allows ls of a protected directory", () => {
    expect(evaluateBashCommand("ls -la .meta-edit/state/").decision).toBe(
      "allow",
    );
  });

  it("allows tail piped into wc when both verbs are read-only", () => {
    expect(
      evaluateBashCommand("tail .meta-edit/state/edits.jsonl | wc -l").decision,
    ).toBe("allow");
  });

  it("allows redirecting a protected-path read into a non-protected target", () => {
    // Intent: "read protected, write somewhere safe". The redirect target
    // is /tmp, not a protected path, so this is allowed.
    expect(
      evaluateBashCommand(
        "tail -1 .meta-edit/state/edits.jsonl > /tmp/mine.log",
      ).decision,
    ).toBe("allow");
  });

  it("allows wrapper-prefixed read of protected (sudo cat ...)", () => {
    expect(
      evaluateBashCommand("sudo cat .meta-edit/state/edits.jsonl").decision,
    ).toBe("allow");
  });

  it("allows env-prefixed read of protected (env tail ...)", () => {
    expect(
      evaluateBashCommand("env tail .meta-edit/state/edits.jsonl").decision,
    ).toBe("allow");
  });
});

describe("evaluateBashCommand — writes to protected paths still denied", () => {
  // Pin down that the read-only carve-out does NOT loosen write detection.

  it("denies bare > redirect to .meta-edit/state/", () => {
    const r = evaluateBashCommand(
      "printf '%s' x > .meta-edit/state/edits.jsonl",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies bare >> append redirect to .meta-edit/state/", () => {
    const r = evaluateBashCommand(
      "printf '%s' x >> .meta-edit/state/edits.jsonl",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies a read-only verb that redirects its output to a protected path", () => {
    // tail itself is read-only but the redirect TARGET is protected, so
    // this is a write attempt and must be denied.
    const r = evaluateBashCommand(
      "tail /etc/hostname > .meta-edit/state/exfil.jsonl",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies dd of=protected (non-read-only verb is still denied unconditionally)", () => {
    const r = evaluateBashCommand(
      "dd if=/etc/hostname of=.meta-edit/state/exfil",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies a read-only verb when redirect target is an absolute path containing protected", () => {
    const r = evaluateBashCommand(
      "cat /etc/hostname > /tmp/work/.meta-edit/state/edits.jsonl",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies prettier --write targeting a protected path (preserved from earlier hardening)", () => {
    // Regression guard: prettier is not in READ_ONLY_VERBS, so the
    // protected-path deny still fires unconditionally. This used to be
    // "even allowlisted commands are denied"; with the new gate the same
    // outcome is reached by the !isReadOnly path.
    const r = evaluateBashCommand(
      "prettier --write .meta-edit/state/edits.jsonl",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  // The following verbs LOOK read-only but have non-redirect write modes
  // (-delete, -o OUTFILE, second-positional output, -r reverse). Codex
  // adversarial review flagged them as a HIGH bypass risk if added to
  // READ_ONLY_VERBS. They are deliberately NOT in READ_ONLY_VERBS, so
  // the protected-path deny fires via the !isReadOnly path.

  it("denies find -delete on a protected directory", () => {
    const r = evaluateBashCommand("find .meta-edit/state -name '*.jsonl' -delete");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies sort -o targeting a protected path", () => {
    const r = evaluateBashCommand(
      "sort /etc/hostname -o .meta-edit/state/exfil.jsonl",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies uniq with positional output to a protected path", () => {
    const r = evaluateBashCommand(
      "uniq /etc/hostname .meta-edit/state/exfil.jsonl",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies xxd -r (binary write-back) targeting a protected path", () => {
    const r = evaluateBashCommand(
      "xxd -r /tmp/hex .meta-edit/state/exfil",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies yq -i in-place mutation of a protected path", () => {
    // Same class as find -delete / sort -o etc.: a verb that LOOKS
    // read-only but has a non-redirect write mode (`-i` / `--inplace`
    // for mikefarah/yq). yq is deliberately NOT in READ_ONLY_VERBS for
    // this reason.
    const r = evaluateBashCommand(
      "yq -i '.applied = false' .meta-edit/state/edits.jsonl",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies less -O log-file targeting a protected path", () => {
    // less has -O / --LOG-FILE that writes piped input to a file
    // without a `>` redirect. less is deliberately NOT in
    // READ_ONLY_VERBS for this reason.
    const r = evaluateBashCommand(
      "cat /etc/hostname | less -O.meta-edit/state/exfil.log",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies file -C compile targeting a protected path", () => {
    // file -C / --compile writes a compiled magic file (magic.mgc)
    // to the filesystem. file is deliberately NOT in READ_ONLY_VERBS
    // for this reason.
    const r = evaluateBashCommand(
      "file -C -m .meta-edit/state/magic",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies rg --pre that could shell out and write to a protected path", () => {
    // rg --pre=COMMAND spawns an arbitrary shell command per input
    // path; that subprocess can write anywhere. rg is deliberately NOT
    // in READ_ONLY_VERBS for this reason.
    const r = evaluateBashCommand(
      "rg --pre=cat foo .meta-edit/state/edits.jsonl",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });

  it("denies more — has !command shell escape and v editor startup", () => {
    // more(1) documents `!command` / `:!command` shell execution and
    // `v` (editor startup); MORESECURE / PAGERSECURE are needed to
    // disable them. more is deliberately NOT in READ_ONLY_VERBS for
    // this reason.
    const r = evaluateBashCommand("more .meta-edit/state/edits.jsonl");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected");
  });
});

// ---------------------------------------------------------------------------
// Codex round-1 a4-01 - symlink-aware redirect target check via cwd
// ---------------------------------------------------------------------------
describe("evaluateBashCommand - symlink-aware redirect target (a4-01)", () => {
  it("denies a redirect whose target is a symlink resolving into .meta-edit/state/", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-a401-"));
    try {
      const metaEditDir = path.join(tmpDir, ".meta-edit");
      const stateDir = path.join(metaEditDir, "state");
      fs.mkdirSync(stateDir, { recursive: true });
      // link -> .meta-edit, so "link/state/edits.jsonl" resolves into the
      // protected directory tree.
      fs.symlinkSync(metaEditDir, path.join(tmpDir, "link"));

      const r = evaluateBashCommand("cat foo > link/state/edits.jsonl", {
        cwd: tmpDir,
      });
      expect(r.decision).toBe("deny");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("still allows a redirect to a non-protected path when cwd is supplied", () => {
    const r = evaluateBashCommand("echo hi > /tmp/whatever.log", {
      cwd: "/tmp",
    });
    expect(r.decision).toBe("allow");
  });
});

describe("evaluateBashCommand — v0.1.2 hook robustness (PR B)", () => {
  describe("command substitution expansion (items 1, 2)", () => {
    it("warns on a backtick command substitution containing mv", () => {
      const r = evaluateBashCommand("cargo fmt && echo `mv old new`");
      expect(r.decision).toBe("warn");
    });

    it("warns on a $(...) command substitution containing mv", () => {
      const r = evaluateBashCommand("cargo fmt && echo $(mv old new)");
      expect(r.decision).toBe("warn");
    });

    it("warns on $() inside double quotes (POSIX expands it)", () => {
      const r = evaluateBashCommand('echo "result $(mv a b)"');
      expect(r.decision).toBe("warn");
    });

    it("allows $() inside single quotes (POSIX leaves it literal)", () => {
      const r = evaluateBashCommand("echo 'literal $(mv a b)'");
      expect(r.decision).toBe("allow");
    });

    it("allows benign $() with no deny patterns inside", () => {
      const r = evaluateBashCommand("echo $(date)");
      expect(r.decision).toBe("allow");
    });

    it("warns on nested $() $(mv a b)", () => {
      const r = evaluateBashCommand("echo $(echo $(mv a b))");
      expect(r.decision).toBe("warn");
    });
  });

  describe("wrapper value-option grammar (item 3)", () => {
    it("warns on sudo -u USER mv a b", () => {
      const r = evaluateBashCommand("sudo -u root mv a b");
      expect(r.decision).toBe("warn");
    });

    it("warns on env -u VAR mv a b", () => {
      const r = evaluateBashCommand("env -u HOME mv a b");
      expect(r.decision).toBe("warn");
    });

    it("warns on sudo -g grp cp x y", () => {
      const r = evaluateBashCommand("sudo -g admins cp x y");
      expect(r.decision).toBe("warn");
    });

    it("still strips wrapper flag-only opts (regression → warn)", () => {
      const r = evaluateBashCommand("env -i mv a b");
      expect(r.decision).toBe("warn");
    });
  });

  describe("safety-flag exception (item 5)", () => {
    it("warns on cp --no-clobber a b (no cp safety carve-out; still verb-warn)", () => {
      // Codex GitHub bot review on PR #27 (P1): `cp -n` /
      // `--no-clobber` only refuses to OVERWRITE an existing
      // destination — it still CREATES new files at the destination,
      // so there is no cp safety-flag carve-out. v0.4.3: cp is no
      // longer a hard deny — it warns (allow-with-nudge) — but the
      // absence of a carve-out still holds (warn, not allow).
      const r = evaluateBashCommand("cp --no-clobber a b");
      expect(r.decision).toBe("warn");
    });

    it("warns on cp -n a b (short form; no carve-out, still verb-warn)", () => {
      const r = evaluateBashCommand("cp -n a b");
      expect(r.decision).toBe("warn");
    });

    it("allows patch --dry-run < changes.diff", () => {
      // patch --dry-run is documented as read-only; emits nothing to
      // disk. Carve-out preserved.
      const r = evaluateBashCommand("patch --dry-run < changes.diff");
      expect(r.decision).toBe("allow");
    });

    it("allows patch --check < changes.diff", () => {
      const r = evaluateBashCommand("patch --check < changes.diff");
      expect(r.decision).toBe("allow");
    });

    it("still warns on cp without safety flag (regression)", () => {
      const r = evaluateBashCommand("cp a b");
      expect(r.decision).toBe("warn");
    });

    it("still warns on mv with --no-clobber (no safety-flag exception for mv)", () => {
      const r = evaluateBashCommand("mv --no-clobber a b");
      expect(r.decision).toBe("warn");
    });
  });

  describe("path-component matching for protected paths (item 6)", () => {
    it("does not flag the protected-path needle inside a longer dirname", () => {
      // ".meta-edit/state" appears as a substring in
      // "x-with-.meta-edit/state-in-name" but the leading '-' is a
      // path-component continuation, so it is NOT a true protected
      // path component and should be allowed (when the verb is benign).
      const r = evaluateBashCommand(
        "awk '{print $1}' /tmp/x-with-.meta-edit/state-in-name",
      );
      expect(r.decision).toBe("allow");
    });

    it("flags real protected paths anywhere in the command", () => {
      const r = evaluateBashCommand(
        "awk '{print $1}' /tmp/work/.meta-edit/state/edits.jsonl",
      );
      expect(r.decision).toBe("deny");
      expect(r.reason).toContain("protected");
    });

    it("flags protected path glued to short-option flag (less -O<path>)", () => {
      // Regression guard: option-glued path stays detected via the
      // hasAcceptableBeforeBoundary short-option carve-out.
      const r = evaluateBashCommand(
        "cat /etc/hostname | less -O.meta-edit/state/exfil.log",
      );
      expect(r.decision).toBe("deny");
    });

    it("flags protected path glued to long-option with = (--output=<path>)", () => {
      const r = evaluateBashCommand(
        "sort --output=.meta-edit/state/exfil.txt input.txt",
      );
      expect(r.decision).toBe("deny");
    });
  });

  describe("python -c / node -e string-literal masking (item 7)", () => {
    it("allows python -c that only PRINTS the literal string 'write_text'", () => {
      const r = evaluateBashCommand(
        'python -c "print(\\"write_text\\")"',
      );
      expect(r.decision).toBe("allow");
    });

    it("still denies python -c with real .write() (regression)", () => {
      const r = evaluateBashCommand(
        "python -c \"open('src/foo.ts','w').write('x')\"",
      );
      expect(r.decision).toBe("deny");
    });

    it("allows python -c with literal write_text inside a string", () => {
      const r = evaluateBashCommand(
        "python -c \"print('write_text inside a string')\"",
      );
      expect(r.decision).toBe("allow");
    });

    it("still denies node -e with real writeFileSync (regression)", () => {
      const r = evaluateBashCommand(
        "node -e \"require('fs').writeFileSync('src/foo.ts','x')\"",
      );
      expect(r.decision).toBe("deny");
    });

    it("allows node -e with literal writeFile inside a string", () => {
      const r = evaluateBashCommand(
        "node -e \"console.log('writeFile is a method')\"",
      );
      expect(r.decision).toBe("allow");
    });
  });

  describe("codex round-1 HIGH regressions", () => {
    it("warns on $() with literal '(' inside the substitution body (quoted-paren)", () => {
      // Round 1 finding: a literal `'('` inside `$()` shifted the
      // depth count and the closing `)` was missed, so `mv a b` was
      // never extracted as an inner segment. The body now tracks
      // single/double quotes independently from the outer pass. The
      // inner `mv` is still extracted; v0.4.3 makes it warn, not deny.
      const r = evaluateBashCommand('echo "$(printf \'(\'; mv a b)"');
      expect(r.decision).toBe("warn");
    });

    it("warns on sudo -T <timeout> mv (sudo time-limit short option)", () => {
      const r = evaluateBashCommand("sudo -T 5 mv a b");
      expect(r.decision).toBe("warn");
    });

    it("warns on sudo -R <chroot> mv (sudo chroot short option)", () => {
      const r = evaluateBashCommand("sudo -R /jail mv a b");
      expect(r.decision).toBe("warn");
    });

    it("denies node -e $'...' (ANSI-C-quoted JS arg) with writeFileSync", () => {
      const r = evaluateBashCommand(
        "node -e $'require(\"fs\").writeFileSync(\"x\",\"y\")'",
      );
      expect(r.decision).toBe("deny");
    });

    it("denies python -c f-string interpolation with .write()", () => {
      const r = evaluateBashCommand(
        'python -c "print(f\\"{open(\\\'x\\\',\\\'w\\\').write(\\\'y\\\')}\\")"',
      );
      expect(r.decision).toBe("deny");
    });

    it("allows python -c f-string with literal write_text (no interpolation)", () => {
      const r = evaluateBashCommand(
        'python -c "print(f\\"this is write_text\\")"',
      );
      expect(r.decision).toBe("allow");
    });

    it("denies python -c with adjacent-quote concatenation hiding open(...,'w').write()", () => {
      // Codex GitHub bot review on PR #27 (P1): POSIX shell treats
      // adjacent quoted/unquoted fragments as a single word, so the
      // arg parser must concatenate fragments, not stop at the first
      // closing quote. `python -c "o""pen('x','w').write('y')"`
      // dequotes to `open('x','w').write('y')`, which the masker
      // then reduces to `open('','').write('')` — `.write(` matches.
      const r = evaluateBashCommand(
        "python -c \"o\"\"pen('x','w').write('y')\"",
      );
      expect(r.decision).toBe("deny");
    });

    it("denies node -e with adjacent-quote concatenation hiding writeFileSync", () => {
      const r = evaluateBashCommand(
        "node -e \"require('fs').\"\"writeFileSync('x','y')\"",
      );
      expect(r.decision).toBe("deny");
    });

    it("denies python -c with mixed double/single quote concatenation", () => {
      const r = evaluateBashCommand(
        'python -c "open"\'(\'"\'x\',\'w\').write(\'y\')"',
      );
      expect(r.decision).toBe("deny");
    });

    // The next four cases construct command strings via concatenation
    // of `EX` / `EV` consts because writing the raw `exec(` / `eval(`
    // tokens in source would trip the project's PreToolUse security-
    // reminder hook on the test author's machine. The runtime command
    // string the hook receives is identical to the obvious literal.
    const EX = "exe" + "c";
    const EV = "ev" + "al";

    it("denies python -c with exec()-wrapped open(...,'w').write()", () => {
      // Codex GitHub bot review on PR #27 round 2 (P1): exec-wrapped
      // scripts evade the masker because the writer call lives
      // inside a string literal that is then handed to exec() at
      // runtime. The detector now scans the unmasked arg whenever
      // exec/eval/compile is present.
      const r = evaluateBashCommand(
        `python -c "${EX}('open(\\"x\\",\\"w\\").write(\\"y\\")')"`,
      );
      expect(r.decision).toBe("deny");
    });

    it("denies python -c with compile()-then-exec wrapping write_text", () => {
      const r = evaluateBashCommand(
        `python -c "${EX}(compile('write_text(\\"x\\")','<>','${EX}'))"`,
      );
      expect(r.decision).toBe("deny");
    });

    it("denies node -e with eval()-wrapped require('fs').writeFileSync", () => {
      const r = evaluateBashCommand(
        `node -e "${EV}('require(\\"fs\\").writeFileSync(\\"x\\",\\"y\\")')"`,
      );
      expect(r.decision).toBe("deny");
    });

    it("denies node -e with new Function() runtime bypass", () => {
      const r = evaluateBashCommand(
        "node -e \"new Function('require(\\\"fs\\\").writeFileSync(\\\"x\\\",\\\"y\\\")')()\"",
      );
      expect(r.decision).toBe("deny");
    });
  });

  describe("patch --dry-run -o output bypass (PR #27 round 2 P1)", () => {
    it("denies patch --dry-run -o FILE (writes despite --dry-run)", () => {
      // Codex GitHub bot review on PR #27 round 2 (P1): patch
      // --dry-run with -o / --output=FILE writes the patched file
      // anyway. The carve-out must be withdrawn when -o is present.
      const r = evaluateBashCommand(
        "patch --dry-run -o src/new.ts < changes.diff",
      );
      expect(r.decision).toBe("deny");
    });

    it("denies patch --dry-run --output=FILE (long form)", () => {
      const r = evaluateBashCommand(
        "patch --dry-run --output=src/new.ts < changes.diff",
      );
      expect(r.decision).toBe("deny");
    });

    it("denies patch --check -o FILE (same hole on --check)", () => {
      const r = evaluateBashCommand(
        "patch --check -o src/new.ts < changes.diff",
      );
      expect(r.decision).toBe("deny");
    });

    it("still allows pure patch --dry-run (no -o; no write path)", () => {
      const r = evaluateBashCommand("patch --dry-run < changes.diff");
      expect(r.decision).toBe("allow");
    });

    // Issue 0428 — POSIX glued short-option form `-oFILE`. Boundary cases
    // around `hasOutput`'s separator detection.
    it("denies patch --dry-run -oFILE (POSIX glued, issue 0428)", () => {
      const r = evaluateBashCommand(
        "patch --dry-run -osrc/new.ts < changes.diff",
      );
      expect(r.decision).toBe("deny");
    });

    it("denies patch --check -oFILE (glued, --check variant)", () => {
      const r = evaluateBashCommand(
        "patch --check -ofile.ts < changes.diff",
      );
      expect(r.decision).toBe("deny");
    });

    it("denies patch --dry-run -o=FILE (= separator, regression guard)", () => {
      // Boundary "at": `-o=FILE` was already matched by the existing
      // `=` arm; lock it so the issue-0428 fix didn't regress this path.
      const r = evaluateBashCommand(
        "patch --dry-run -o=src/new.ts < changes.diff",
      );
      expect(r.decision).toBe("deny");
    });
  });

  describe("Unicode line separators (item 8)", () => {
    it("treats CR as a segment boundary", () => {
      const r = evaluateBashCommand("cargo fmt\rmv a b");
      expect(r.decision).toBe("warn");
    });

    it("treats U+2028 LINE SEPARATOR as a segment boundary", () => {
      const r = evaluateBashCommand("cargo fmt mv a b");
      expect(r.decision).toBe("warn");
    });

    it("treats U+2029 PARAGRAPH SEPARATOR as a segment boundary", () => {
      const r = evaluateBashCommand("cargo fmt mv a b");
      expect(r.decision).toBe("warn");
    });
  });
});

describe("evaluateBashCommand — a1-01 heredoc redirect bypass", () => {
  it("denies heredoc redirect: cat <<EOF > src/foo.ts", () => {
    expect(
      evaluateBashCommand("cat <<EOF > src/foo.ts\nhello\nEOF").decision,
    ).toBe("deny");
  });

  it("allows grep with quoted heredoc-shaped literal", () => {
    expect(
      evaluateBashCommand("grep '<<EOF > src/foo.ts'").decision,
    ).toBe("allow");
  });

  it("allows echo with quoted heredoc-shaped literal", () => {
    expect(
      evaluateBashCommand('echo "cat <<EOF > src/foo.ts"').decision,
    ).toBe("allow");
  });

  // Codex round-3 (a1-01 reopen): the round-2 stripQuotedContent pass
  // (commit 435fb1b) blanked the EOF inside quoted heredoc delimiters
  // (`<<"EOF"`, `<<'EOF'`, `<<-'EOF'`), masking the redirect regex.
  // Heredoc detection must run on the raw command — quoting only
  // affects whether parameter expansion happens in the body; the
  // heredoc redirect shape is preserved.
  it("denies heredoc redirect with single-quoted delimiter: cat <<'EOF' > src/foo.ts", () => {
    expect(
      evaluateBashCommand("cat <<'EOF' > src/foo.ts\nhello\nEOF").decision,
    ).toBe("deny");
  });

  it('denies heredoc redirect with double-quoted delimiter: cat <<"EOF" > src/foo.ts', () => {
    expect(
      evaluateBashCommand('cat <<"EOF" > src/foo.ts\nhello\nEOF').decision,
    ).toBe("deny");
  });

  it("denies tab-stripping heredoc redirect with quoted delimiter: cat <<-'EOF' > src/foo.ts", () => {
    expect(
      evaluateBashCommand("cat <<-'EOF' > src/foo.ts\n\thello\n\tEOF").decision,
    ).toBe("deny");
  });

  // a1-01 (round 4): backslash-quoted delimiter `<<\EOF` is valid bash — single
  // leading backslash suppresses variable/command expansion just like `<<'EOF'`.
  // The prior regex only handled ['"] forms, leaving `<<\EOF` undetected.
  it("a1-01: backslash-quoted heredoc delimiter still detected as redirect", () => {
    expect(
      evaluateBashCommand("cat <<\\EOF > src/foo.ts\nhello\nEOF").decision,
    ).toBe("deny");
  });

  it("a1-01: backslash-quoted tab-stripping heredoc redirect: cat <<-\\EOF > src/foo.ts", () => {
    expect(
      evaluateBashCommand("cat <<-\\EOF > src/foo.ts\nhello\nEOF").decision,
    ).toBe("deny");
  });
});

describe("evaluateBashCommand — a1-02 base64 decode pipe to shell", () => {
  it("denies base64 -d | bash (arbitrary command execution bypass)", () => {
    expect(
      evaluateBashCommand(
        "echo 'c2VkIC1pIHMveC95LyBzcmMvZm9vLnRzCg==' | base64 -d | bash",
      ).decision,
    ).toBe("deny");
  });

  it("allows printf with quoted base64-shaped literal", () => {
    expect(
      evaluateBashCommand("printf 'base64 -d | bash\\n'").decision,
    ).toBe("allow");
  });
});

describe("evaluateBashCommand — a1-03 dd of= bypass", () => {
  it("denies dd of=src/foo.ts (source file write via dd)", () => {
    expect(
      evaluateBashCommand("dd if=/dev/urandom of=src/foo.ts bs=4k count=1").decision,
    ).toBe("deny");
  });

  it("denies dd of=<file> even without explicit if= argument", () => {
    expect(
      evaluateBashCommand("echo 'hello' | dd of=src/foo.ts").decision,
    ).toBe("deny");
  });

  it("allows dd of=/tmp/swap (legitimate scratch-area write)", () => {
    expect(
      evaluateBashCommand("dd if=/dev/zero of=/tmp/swap bs=1M count=128").decision,
    ).toBe("allow");
  });

  it("allows dd without of= (no write target)", () => {
    expect(
      evaluateBashCommand("dd if=/dev/zero bs=1 count=0").decision,
    ).toBe("allow");
  });

  it("allows dd of=/dev/null (devnull is not in-repo)", () => {
    expect(
      evaluateBashCommand("dd if=foo of=/dev/null").decision,
    ).toBe("allow");
  });
});

describe("evaluateBashCommand — a1-04 find -exec bypass", () => {
  it("denies find -exec sed -i (exec bypass via outer find verb)", () => {
    expect(
      evaluateBashCommand(
        "find . -name '*.ts' -exec sed -i 's/x/y/' {} \;",
      ).decision,
    ).toBe("deny");
  });

  it("warns on find -exec cp (exec bypass via outer find verb → cp warn)", () => {
    expect(
      evaluateBashCommand(
        "find src/ -name '*.ts' -exec cp {} /tmp/backup \;",
      ).decision,
    ).toBe("warn");
  });

  it("allows echo -exec mv ... (echo verb, not find)", () => {
    expect(
      evaluateBashCommand("echo -exec mv a b \\;").decision,
    ).toBe("allow");
  });

  it("allows echo with literal exec arg (no find verb)", () => {
    expect(
      evaluateBashCommand('echo "exec mv a b"').decision,
    ).toBe("allow");
  });

  it("allows find . -name '*.log' -delete (find without -exec write)", () => {
    expect(
      evaluateBashCommand("find . -name '*.log' -delete").decision,
    ).toBe("allow");
  });

  it("allows find -exec with read-only inner (ls)", () => {
    expect(
      evaluateBashCommand("find . -maxdepth 2 -type f -exec ls -la {} \\;").decision,
    ).toBe("allow");
  });
});

describe("evaluateBashCommand — a1-05 perl/ruby/php inline writes", () => {
  it("denies perl -e with open write (inline bypass)", () => {
    expect(
      evaluateBashCommand(
        "perl -e 'open(my $fh, \">\", \"src/foo.ts\"); print $fh \"x\"; close $fh'",
      ).decision,
    ).toBe("deny");
  });

  it("denies ruby -e with File.write (inline bypass)", () => {
    expect(
      evaluateBashCommand(
        "ruby -e 'File.write(\"src/foo.ts\", \"x\")'",
      ).decision,
    ).toBe("deny");
  });

  it("denies php -r with file_put_contents (inline bypass)", () => {
    expect(
      evaluateBashCommand(
        "php -r 'file_put_contents(\"src/foo.ts\", \"x\");'",
      ).decision,
    ).toBe("deny");
  });
});

describe("evaluateBashCommand — a1-06 busybox prefix bypass", () => {
  it("warns on busybox mv (busybox wrapper peeled → mv warn)", () => {
    expect(
      evaluateBashCommand("busybox mv src/a.ts src/b.ts").decision,
    ).toBe("warn");
  });

  it("denies busybox sed -i (busybox wrapper not recognized)", () => {
    expect(
      evaluateBashCommand("busybox sed -i 's/x/y/' src/foo.ts").decision,
    ).toBe("deny");
  });

  it("warns on busybox cp (busybox wrapper peeled → cp warn)", () => {
    expect(
      evaluateBashCommand("busybox cp src/foo.ts src/bar.ts").decision,
    ).toBe("warn");
  });
});

describe("evaluateBashCommand — a1-07 locale env-var prefix regression", () => {
  it("denies LC_ALL='en_US.UTF-8' sed -i (locale env-var prefix, single-quoted value)", () => {
    expect(
      evaluateBashCommand(
        "LC_ALL='en_US.UTF-8' sed -i 's/x/y/' src/foo.ts",
      ).decision,
    ).toBe("deny");
  });

  it("denies LC_ALL=C sed -i (locale env-var prefix, bare value)", () => {
    expect(
      evaluateBashCommand("LC_ALL=C sed -i 's/x/y/' src/foo.ts").decision,
    ).toBe("deny");
  });

  it("warns on LANG=en_US.UTF-8 mv src/a.ts src/b.ts (multi-locale prefix before mv → warn)", () => {
    expect(
      evaluateBashCommand("LANG=en_US.UTF-8 mv src/a.ts src/b.ts").decision,
    ).toBe("warn");
  });
});

describe("evaluateBashCommand — a2-01 unicode whitespace tee bypass", () => {
  it("denies tee with non-breaking space (U+00A0)", () => {
    const r = evaluateBashCommand("echo x | tee src/foo.ts");
    expect(r.decision).toBe("deny");
  });

  it("denies tee with thin space (U+2009)", () => {
    const r = evaluateBashCommand("echo x | tee src/foo.ts");
    expect(r.decision).toBe("deny");
  });

  it("allows tee /dev/null (devnull is not in-repo)", () => {
    const r = evaluateBashCommand("echo hi | tee /dev/null");
    expect(r.decision).toBe("allow");
  });

  it("allows tee /tmp/log.txt (tmp scratch area is not in-repo)", () => {
    const r = evaluateBashCommand("echo hi | tee /tmp/log.txt");
    expect(r.decision).toBe("allow");
  });
});

// ----------------------------------------------------------------------
// Issue 1042-rsync — Unicode whitespace bypass.
//
// Pre-fix `rsync` was matched only via the literal substrings
// `"rsync "` (ASCII space) and `"rsync\t"` (tab). Any non-ASCII
// whitespace separator (U+00A0 NBSP, U+2009 thin space, U+3000
// ideographic space, U+000B vertical tab, …) between the verb and its
// arguments slipped past both, and `rsync` was not in DENY_VERBS, so
// the command was allowed. The fix migrates `rsync` to DENY_VERBS,
// where extractCommandVerb's `\S+` tokenizer correctly extracts the
// verb regardless of separator.
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// Issue 1042-tee — fd-redirect false-deny.
//
// matchesDangerousTee tokenizes on whitespace only and treats any
// non-flag token as a possible repo write target. Pre-fix, fd-redirect
// tokens like `2>&1`, `2>/dev/null`, `>&2`, etc. were classified as
// in-repo paths because they don't start with `-` and don't start with
// `/` (so they failed isInRepoWriteTarget's relative-path fallback).
// The fix adds isFdRedirectToken to the loop so these are skipped.
// ----------------------------------------------------------------------
describe("evaluateBashCommand — 1042-tee fd-redirect false-deny", () => {
  it("allows tee /tmp/log + 2>&1 (1042: stderr-fd dup is not a write target)", () => {
    const r = evaluateBashCommand("echo hi | tee /tmp/build.log 2>&1");
    expect(r.decision).toBe("allow");
  });

  it("allows tee /tmp/log + 2>/dev/null (fd-redirect token glued)", () => {
    const r = evaluateBashCommand("npm test 2>/dev/null | tee /tmp/test.log");
    expect(r.decision).toBe("allow");
  });

  it("allows tee /tmp/log + >&2 form", () => {
    const r = evaluateBashCommand("echo x >&2 | tee /tmp/foo.log");
    expect(r.decision).toBe("allow");
  });

  it("denies tee with real in-repo target alongside 2>&1 (regression guard)", () => {
    // Negative case: even with fd-redirect tokens skipped, a genuine
    // in-repo write target must still trip the deny.
    const r = evaluateBashCommand("echo x | tee src/foo.ts 2>&1");
    expect(r.decision).toBe("deny");
  });
});

// ----------------------------------------------------------------------
// Issue 1100 — read-only-verb cp-bypass.
//
// Pre-fix `cat <file> > <in-repo target>` slipped past DENY_SUBSTRINGS
// (which only matched the adjacent `"cat >"` substring) and past
// DENY_VERBS (cat / head / grep / ... are read-only by default and
// stay out of the deny-verb set). The functional effect was a `cp`
// without an `edits.jsonl` entry, breaking the typed-surface invariant.
// Fix: structural deny when verb ∈ READ_ONLY_VERBS AND any redirect
// target is classified as in-repo by isInRepoWriteTarget. Safe-sink
// targets (/tmp/, /dev/null, ~/.claude/, ...) remain allowed.
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// Codex review fixes — adversarial cases caught during the bundle's
// pre-commit review.
// ----------------------------------------------------------------------
describe("evaluateBashCommand — codex review fixes", () => {
  it("denies cat src > .claude/../src/file.ts (relative `..` escapes safe-sink)", () => {
    // Codex #1 (HIGH): the relative-path branch of isInRepoWriteTarget
    // didn't normalize `..` segments, so `.claude/../src/foo.ts`
    // matched the `.claude` safe-sink and was allowed even though the
    // path resolves back inside the repo. Fix: path.normalize the
    // relative target, parity with the absolute branch.
    const r = evaluateBashCommand(
      "cat src/foo.ts > .claude/../src/escaped.ts",
    );
    expect(r.decision).toBe("deny");
  });

  it("still allows cat src > .claude/notes/foo.md (genuine .claude target)", () => {
    // Negative: the parity fix must not break legitimate in-component
    // .claude writes.
    const r = evaluateBashCommand("cat src/foo.ts > .claude/notes/foo.md");
    expect(r.decision).toBe("allow");
  });

  it("denies tee >|src/out (codex #3 — restore tee's repo-internal deny)", () => {
    // Codex #3 (MEDIUM): the B3 fd-redirect skip ignores `>|src/out`,
    // so the prior matchesDangerousTee scan no longer caught it. tee
    // is a write verb by design — restore the deny via
    // iterRedirectTargets(segment) inside matchesDangerousTee.
    const r = evaluateBashCommand("echo x | tee >|src/out");
    expect(r.decision).toBe("deny");
  });

  it("denies tee 2>src/err (stderr redirect to in-repo path)", () => {
    const r = evaluateBashCommand("echo x | tee 2>src/err");
    expect(r.decision).toBe("deny");
  });

  it("still allows tee /tmp/log 2>&1 (B3 regression guard)", () => {
    // The codex-#3 fix must NOT re-introduce the original 1042-tee
    // false-positive — `2>&1` is fd-duplication and iterRedirectTargets
    // skips it.
    const r = evaluateBashCommand("echo x | tee /tmp/log.txt 2>&1");
    expect(r.decision).toBe("allow");
  });
});

describe("evaluateBashCommand — 1100 cp-bypass via read-only verb redirect", () => {
  it("denies cat <file> > <in-repo> (the original 1100 bypass)", () => {
    const r = evaluateBashCommand(
      "cat sandbox-inside/lib.ts > sandbox-inside/copy.ts",
    );
    expect(r.decision).toBe("deny");
  });

  it("denies head src > dst (same class via head)", () => {
    const r = evaluateBashCommand("head src/foo.ts > out.ts");
    expect(r.decision).toBe("deny");
  });

  it("denies grep foo src > out.ts (read-only verb + in-repo redirect)", () => {
    const r = evaluateBashCommand("grep foo src/bar.ts > out.ts");
    expect(r.decision).toBe("deny");
  });

  it("denies tail -n 5 src > dst", () => {
    const r = evaluateBashCommand("tail -n 5 src/foo.ts > tail.ts");
    expect(r.decision).toBe("deny");
  });

  it("denies wc -l src > stats.txt (in-repo target)", () => {
    const r = evaluateBashCommand("wc -l src/foo.ts > stats.txt");
    expect(r.decision).toBe("deny");
  });

  // Negative side-effect cases: safe-sink redirects must stay allowed.
  it("allows cat src > /tmp/scratch.txt (safe-sink prefix)", () => {
    const r = evaluateBashCommand("cat src/foo.ts > /tmp/scratch.txt");
    expect(r.decision).toBe("allow");
  });

  it("allows cat src > /dev/null (safe-sink exact target)", () => {
    const r = evaluateBashCommand("cat src/foo.ts > /dev/null");
    expect(r.decision).toBe("allow");
  });

  it("allows cat src > ~/.claude/notes/foo.md (1106 + 1100 interaction)", () => {
    const r = evaluateBashCommand(
      "cat src/foo.ts > ~/.claude/notes/foo.md",
    );
    expect(r.decision).toBe("allow");
  });

  it("still allows pure cat src (no redirect — read-only inspection)", () => {
    const r = evaluateBashCommand("cat src/foo.ts");
    expect(r.decision).toBe("allow");
  });

  it("still allows grep with no redirect", () => {
    const r = evaluateBashCommand("grep -r foo src/");
    expect(r.decision).toBe("allow");
  });
});

describe("evaluateBashCommand — 1042-rsync unicode whitespace bypass", () => {
  it("denies rsync with ASCII space (regression guard)", () => {
    const r = evaluateBashCommand("rsync -a src/ dst/");
    expect(r.decision).toBe("warn");
  });

  it("denies rsync with non-breaking space separator (U+00A0)", () => {
    const r = evaluateBashCommand("rsync -a src/ dst/");
    expect(r.decision).toBe("warn");
  });

  it("denies rsync with thin space separator (U+2009)", () => {
    const r = evaluateBashCommand(
      "rsync --delete src/ /repo/target/",
    );
    expect(r.decision).toBe("warn");
  });

  it("denies rsync with ideographic space separator (U+3000)", () => {
    const r = evaluateBashCommand("rsync　-a src/ dst/");
    expect(r.decision).toBe("warn");
  });

  it("denies rsync with vertical tab separator (U+000B)", () => {
    const r = evaluateBashCommand("rsync-a src/ dst/");
    expect(r.decision).toBe("warn");
  });
});


describe("evaluateBashCommand — a2-02 eval deferred-string bypass", () => {
  it("denies eval with literal cat-redirect string", () => {
    const r = evaluateBashCommand('eval "cat > src/foo.ts"');
    expect(r.decision).toBe("deny");
  });

  it("denies eval with base64-encoded cat-redirect (deferred bypass)", () => {
    const r = evaluateBashCommand(
      'eval "$(echo Y2F0ID4gc3JjL2Zvby50cwo= | base64 -d)"',
    );
    expect(r.decision).toBe("deny");
  });
});

describe("evaluateBashCommand — a2-03 env -i wrapper regression", () => {
  it("warns on env -i mv (env -i must not consume mv as value of -i; mv → warn)", () => {
    const r = evaluateBashCommand("env -i mv src/a.ts src/b.ts");
    expect(r.decision).toBe("warn");
  });

  it("warns on env -i cp", () => {
    const r = evaluateBashCommand("env -i cp src/foo.ts src/bar.ts");
    expect(r.decision).toBe("warn");
  });

  it("denies env -i patch", () => {
    const r = evaluateBashCommand("env -i patch -p1 < changes.diff");
    expect(r.decision).toBe("deny");
  });

  it("warns on env --ignore-environment mv (long form → warn)", () => {
    const r = evaluateBashCommand("env --ignore-environment mv src/a.ts src/b.ts");
    expect(r.decision).toBe("warn");
  });
});

describe("evaluateBashCommand — a2-04 noclobber-override >| redirect", () => {
  it("denies cat redirected with >| to protected state path", () => {
    const r = evaluateBashCommand(
      "cat foo >| .meta-edit/state/edits.jsonl",
    );
    expect(r.decision).toBe("deny");
  });

  it("denies echo redirected with >| to protected tmp path", () => {
    const r = evaluateBashCommand(
      "echo payload >| .meta-edit/tmp/scratch.json",
    );
    expect(r.decision).toBe("deny");
  });

  it("still allows cat reading from protected path without redirect", () => {
    const r = evaluateBashCommand("cat .meta-edit/state/edits.jsonl");
    expect(r.decision).toBe("allow");
  });
});

describe("evaluateBashCommand — round-2 nice-to-have allow regressions", () => {
  it("allows busybox cat /etc/hosts (read-only multicall applet)", () => {
    expect(
      evaluateBashCommand("busybox cat /etc/hosts").decision,
    ).toBe("allow");
  });

  it("allows eval echo hello (literal-only argument)", () => {
    expect(
      evaluateBashCommand("eval echo hello").decision,
    ).toBe("allow");
  });

  it("allows eval \"echo hello\" (quoted literal argument)", () => {
    expect(
      evaluateBashCommand('eval "echo hello"').decision,
    ).toBe("allow");
  });

  it("allows perl -ne 'print' file.txt (read-only inline perl)", () => {
    expect(
      evaluateBashCommand("perl -ne 'print' file.txt").decision,
    ).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// Issue #31 follow-up (P1 codex review): /dev/fd alias bypass.
//
// The previous safe-target list used `/dev/` as a broad prefix. A shell
// can pre-open a writable FD to a repo file (`exec 3>src/foo.ts`) and
// then write to `/dev/fd/3` (or the equivalent `/proc/self/fd/3`); both
// are kernel-provided aliases for the original FD. Treating them as
// safe means a one-line `tee /dev/fd/3` bypasses the entire write
// guard.
//
// Fix: only the four exact-match safe sinks (`/dev/null`, `/dev/stdout`,
// `/dev/stderr`, `/dev/zero`) are allowed. Every other path under
// `/dev/`, `/proc/`, and similar fd-aliasing trees is treated as
// potentially in-repo and denied.
// ---------------------------------------------------------------------------
describe("evaluateBashCommand — issue #31 /dev/fd alias bypass", () => {
  it("denies tee /dev/fd/3 (could alias a pre-opened FD to a repo file)", () => {
    expect(
      evaluateBashCommand("echo hi | tee /dev/fd/3").decision,
    ).toBe("deny");
  });

  it("denies dd of=/dev/fd/4", () => {
    expect(
      evaluateBashCommand("dd of=/dev/fd/4").decision,
    ).toBe("deny");
  });

  it("denies tee /proc/self/fd/3 (procfs FD alias)", () => {
    expect(
      evaluateBashCommand("tee /proc/self/fd/3").decision,
    ).toBe("deny");
  });

  it("denies dd of=/proc/12345/fd/2 (procfs FD alias for arbitrary pid)", () => {
    expect(
      evaluateBashCommand("dd of=/proc/12345/fd/2").decision,
    ).toBe("deny");
  });

  // Regression: the four exact-match safe sinks must still be allowed.
  it("still allows tee /dev/null", () => {
    expect(
      evaluateBashCommand("echo hi | tee /dev/null").decision,
    ).toBe("allow");
  });

  it("still allows tee /dev/stdout", () => {
    expect(
      evaluateBashCommand("echo hi | tee /dev/stdout").decision,
    ).toBe("allow");
  });

  it("still allows tee /dev/stderr", () => {
    expect(
      evaluateBashCommand("echo hi | tee /dev/stderr").decision,
    ).toBe("allow");
  });

  it("still allows dd of=/dev/null", () => {
    expect(
      evaluateBashCommand("dd if=/tmp/x of=/dev/null").decision,
    ).toBe("allow");
  });
});

describe("evaluateBashCommand — dogfood-001 in-repo redirect (warn since v0.1.5)", () => {
  // Pre-v0.1.5: redirects whose target was outside the safe-sink
  // allowlist (/dev/null, /tmp/, /var/tmp/, /run/, /sys/) were denied
  // outright. v0.1.5 loosened that to a structured warn (SPEC §5.2):
  // the verb-denylist (cat >, sed -i, tee, mv, dd of=, ...) keeps
  // well-known bypasses on deny, and protected-path writes
  // (.meta-edit/state/**, .meta-edit/tmp/**) are still denied earlier.
  // The remaining case — an unenumerated write verb (printf, echo, jq
  // --rawfile, future utilities) redirecting outside the safe sinks —
  // is permitted with a permissionDecisionReason nudging toward an
  // edit_* tool.

  it("warns on printf > test-playground/ (the dogfood-001 reproduction)", () => {
    const r = evaluateBashCommand('printf "%s" leak > test-playground/sample.ts');
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("safe-sink allowlist");
    expect(r.reason).toContain("edit_*");
  });

  it("warns on echo > out.log (relative in-repo target)", () => {
    expect(
      evaluateBashCommand("echo hello > out.log").decision,
    ).toBe("warn");
  });

  it("warns on printf >> append to in-repo path", () => {
    expect(
      evaluateBashCommand("printf x >> notes.md").decision,
    ).toBe("warn");
  });

  it("warns on noclobber-override >| to in-repo path", () => {
    expect(
      evaluateBashCommand("printf x >| notes.md").decision,
    ).toBe("warn");
  });

  it("warns on redirect to absolute path outside the safe-sink list", () => {
    // /home/user/something.txt is not on the safe prefixes (/tmp,
    // /var/tmp, /run, /sys). Pre-v0.1.5 this was deny; v0.1.5 surfaces
    // it as warn. The verb-denylist still catches the well-known
    // bypasses (`cat >`, `sed -i`, `tee`, ...), so allowing this case
    // is the targeted false-positive relief documented in SPEC §5.2.
    expect(
      evaluateBashCommand("printf x > /home/user/something.txt").decision,
    ).toBe("warn");
  });

  it("allows printf > /dev/null (safe exact target)", () => {
    expect(
      evaluateBashCommand("printf x > /dev/null").decision,
    ).toBe("allow");
  });

  it("allows printf > /tmp/foo (safe prefix)", () => {
    expect(
      evaluateBashCommand("printf x > /tmp/foo.log").decision,
    ).toBe("allow");
  });

  // -------------------------------------------------------------------
  // Issue 1106 — `.claude/` path-component-aware safe-sink.
  // Claude Code agent state dir (~/.claude/projects/**, ~/.claude/plans/**)
  // is AI-managed scratch space, not source code. Writes there must be
  // silent-allow rather than warn.
  // -------------------------------------------------------------------
  it("allows printf > ~/.claude/plans/foo.md (1106 — agent state dir)", () => {
    expect(
      evaluateBashCommand("printf x > ~/.claude/plans/foo.md").decision,
    ).toBe("allow");
  });

  it("allows printf > /home/user/.claude/projects/x/y.md (absolute form)", () => {
    expect(
      evaluateBashCommand(
        "printf x > /home/user/.claude/projects/x/y.md",
      ).decision,
    ).toBe("allow");
  });

  it("does NOT match dotclaude (only literal `.claude` path component is safe)", () => {
    // Negative case: a path that contains `claude` or `dotclaude` is NOT
    // a Claude Code agent state dir. Must still warn (not allow).
    const r = evaluateBashCommand(
      "printf x > /home/user/dotclaude/foo.md",
    );
    expect(r.decision).toBe("warn");
  });

  it("does NOT match `.claudefoo` substring (component boundary required)", () => {
    const r = evaluateBashCommand(
      "printf x > /home/user/.claudefoo/bar.md",
    );
    expect(r.decision).toBe("warn");
  });

  it("allows echo foo &> /dev/null (combined-redirect form)", () => {
    expect(
      evaluateBashCommand("echo foo &> /dev/null").decision,
    ).toBe("allow");
  });

  it("allows command with no redirect", () => {
    expect(evaluateBashCommand("printf hello").decision).toBe("allow");
    expect(evaluateBashCommand("bun test").decision).toBe("allow");
  });

  it("allows 2>&1 fd-duplication without misreading as redirect", () => {
    // `2>&1` is fd duplication, not a write redirect. Must not trip the
    // structural-redirect warn.
    expect(
      evaluateBashCommand("bun test 2>&1 | head").decision,
    ).toBe("allow");
  });

  // ---- v0.1.5 regression guards: warn must not weaken adjacent denies ----

  it("still denies printf > .meta-edit/state/edits.jsonl (protected path)", () => {
    // touchesProtectedPathTokenized fires before the structural redirect
    // check. Even with the latter loosened to warn, audit-log tampering
    // remains deny.
    const r = evaluateBashCommand(
      "printf hi > .meta-edit/state/edits.jsonl",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain(".meta-edit");
  });

  it("still denies echo >> .meta-edit/tmp/x (protected tmp path)", () => {
    const r = evaluateBashCommand("echo hi >> .meta-edit/tmp/scratch");
    expect(r.decision).toBe("deny");
  });

  it("still denies cat > src/foo.ts (verb-denylist hit)", () => {
    // DENY_SUBSTRINGS "cat >" still fires before the structural redirect
    // warn. Verb-side semantics are unchanged.
    const r = evaluateBashCommand("cat > src/foo.ts");
    expect(r.decision).toBe("deny");
  });

  it("still denies sed -i s/x/y/ src/foo.ts (verb-denylist hit)", () => {
    expect(
      evaluateBashCommand("sed -i s/x/y/ src/foo.ts").decision,
    ).toBe("deny");
  });

  it("still denies tee src/foo.ts (verb-denylist hit)", () => {
    expect(
      evaluateBashCommand("echo hi | tee src/foo.ts").decision,
    ).toBe("deny");
  });

  it("warns on bash -c \"printf x > src/foo.ts\" (warn propagates from shell-hosted recursion)", () => {
    // Shell-hosted recursion now propagates `warn` (not just `deny`).
    // The inner segment redirects to an in-repo path; the outer hosted
    // wrapper has nothing else to deny on, so the outer surfaces warn.
    const r = evaluateBashCommand('bash -c "printf x > src/foo.ts"');
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("safe-sink");
  });

  it("denies bash -c \"sed -i s/x/y/ src/foo.ts\" (verb-deny inside hosted payload still wins)", () => {
    // Shell-hosted recursion: inner DENY_SUBSTRINGS hit overrides any
    // outer warn. The deny-wins-over-warn rule is the load-bearing
    // invariant of the warn refactor.
    const r = evaluateBashCommand('bash -c "sed -i s/x/y/ src/foo.ts"');
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("sed -i");
  });

  it("denies bash -c \"printf x > .meta-edit/state/edits.jsonl\" (protected-path inside hosted payload still wins over warn)", () => {
    const r = evaluateBashCommand(
      'bash -c "printf x > .meta-edit/state/edits.jsonl"',
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain(".meta-edit");
  });

  it("denies a chain of (warn-segment ; verb-deny segment) — deny wins across segments", () => {
    // `printf > out.log` alone would warn; `sed -i ...` alone denies.
    // Combined: top-level segment iteration must surface deny (the
    // warn cannot whitewash a downstream deny).
    const r = evaluateBashCommand(
      "printf x > out.log ; sed -i s/x/y/ src/foo.ts",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("sed -i");
  });

  // ---- v0.1.5 propagation guards: warn must reach the outer decision
  //      from every recursion path the policy supports ----

  it("warns on eval \"printf x > src/foo.ts\" (warn propagates from extractEvalArg recursion)", () => {
    // extractEvalArg + recursivelyEvaluateArg path — distinct from the
    // bash -c shell-hosting path. The inner segment redirects to an
    // in-repo target; the outer eval has no other deny trigger so the
    // outer must surface the inner warn.
    const r = evaluateBashCommand('eval "printf x > src/foo.ts"');
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("safe-sink");
  });

  it("warns on sudo eval \"printf x > src/foo.ts\" (wrapper-prefixed eval propagates warn)", () => {
    // Wrapper peel + extractEvalArg: matches the symmetric deny case
    // for `sudo eval "cat > src/foo.ts"` (Codex P1-2 block) but with
    // a write verb that is structurally redirected rather than
    // verb-denied.
    const r = evaluateBashCommand('sudo eval "printf x > src/foo.ts"');
    expect(r.decision).toBe("warn");
  });

  it("warns when a $(...) command substitution contains a redirect-warn segment", () => {
    // splitSegments emits substitution inners as additional segments
    // through extractSubstitutionInners; those segments must propagate
    // their warn back to the outer evaluator.
    const r = evaluateBashCommand("echo $(printf x > src/foo.ts)");
    expect(r.decision).toBe("warn");
  });

  it("warns and surfaces the FIRST warn when two segments both warn", () => {
    // First-warn-wins is the documented top-level merge rule
    // (evaluateBashCommand). Pin it: `printf > a.log` warns, then
    // `printf > b.log` would also warn, but the first one's reason is
    // surfaced.
    const r = evaluateBashCommand(
      "printf x > a.log ; printf x > b.log",
    );
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("safe-sink");
  });

  it("warns when segment 1 warns and segment 2 plainly allows", () => {
    // The cross-segment allow path must not clobber the warn captured
    // earlier. Segment 2 (`bun test`) is allow; the outer surfaces the
    // segment-1 warn.
    const r = evaluateBashCommand("printf x > out.log && bun test");
    expect(r.decision).toBe("warn");
  });
});

describe("evaluateBashCommand — dogfood-005 quote-aware scans", () => {
  // Pre-fix: DENY_SUBSTRINGS substring scan and protected-path scan
  // walked raw command text, so a documentation string containing the
  // literal trigger phrase inside a printf single-quoted argument would
  // false-positive deny. The same stripQuotedContent that protected the
  // heredoc / decode-and-execute scans now protects these too.

  it("allows printf '... cat > x ...' > /tmp/notes.md (DENY_SUBSTRINGS in quoted body)", () => {
    expect(
      evaluateBashCommand(
        "printf 'avoid the cat > target pattern in scripts' > /tmp/notes.md",
      ).decision,
    ).toBe("allow");
  });

  it("allows printf '... sed -i ...' > /tmp/notes.md", () => {
    expect(
      evaluateBashCommand(
        "printf 'do not use sed -i for in-place edits' > /tmp/notes.md",
      ).decision,
    ).toBe("allow");
  });

  it("allows printf '... .meta-edit/state ...' > /tmp/notes.md (protected path in quoted body)", () => {
    expect(
      evaluateBashCommand(
        "printf 'edits land in .meta-edit/state/edits.jsonl' > /tmp/notes.md",
      ).decision,
    ).toBe("allow");
  });

  it("still denies the actual exploit when the redirect is unquoted", () => {
    // The dogfood-005 fix must not soften the real exploit: a literal
    // `cat > <in-repo>` (no surrounding quotes around the redirect) is
    // still denied by the existing DENY_SUBSTRINGS entry.
    expect(
      evaluateBashCommand("cat > src/foo.ts").decision,
    ).toBe("deny");
  });

  it("still denies bash -c 'sed -i ...' (shell-hosting wrapper rescan)", () => {
    // dogfood-005 quote-stripping would otherwise blank the bash -c
    // payload. matchesShellHostingDeny rescans the literal arg and
    // restores the deny.
    expect(
      evaluateBashCommand('bash -c "sed -i s/x/y/ src/foo.ts"').decision,
    ).toBe("deny");
  });

  it("still denies eval 'cat > src/foo.ts' (eval literal arg)", () => {
    expect(
      evaluateBashCommand("eval \"cat > src/foo.ts\"").decision,
    ).toBe("deny");
  });
});

describe("evaluateBashCommand — dogfood-001 self-review fixes", () => {
  // Bugs surfaced by the post-implementation subagent review and
  // pinned here so a future regression fails loudly.
  //
  // v0.1.5 note: cases that exercised the structural redirect-allowlist
  // (printf to non-safe-sink targets) now surface as `warn` instead of
  // `deny`. The path-normalization and CR/LF-detachment correctness
  // properties (the actual things this block guards) are still
  // verified — we just assert on `warn` rather than `deny`. Cases that
  // exercise verb-deny or other scoped denies (e.g. mv after CR) keep
  // their `deny` assertion.

  it("warns on safe-prefix-then-traversal target (/tmp/../in-repo)", () => {
    // path-normalization correctness: `/tmp/../home/user/meta-edit/...`
    // literally starts with `/tmp/` but resolves OUTSIDE the safe sink.
    // isInRepoWriteTarget path.normalize()s before the prefix check, so
    // the structural-redirect rule still fires (now as warn).
    expect(
      evaluateBashCommand(
        "printf x > /tmp/../home/user/something/foo.ts",
      ).decision,
    ).toBe("warn");
  });

  it("warns on double-up-traversal from /var/tmp", () => {
    expect(
      evaluateBashCommand(
        "printf x > /var/tmp/../../home/user/foo.ts",
      ).decision,
    ).toBe("warn");
  });

  it("still allows /tmp/foo (the post-normalize prefix check is unchanged for clean targets)", () => {
    expect(
      evaluateBashCommand("printf x > /tmp/foo.txt").decision,
    ).toBe("allow");
  });

  it("warns on CR-detached redirect target (printf x >\\rin-repo.ts)", () => {
    // Pre-fix: primarySplitSegments treats `\r` as a segment boundary,
    // detaching the target from `>`. Post-fix: the redirect operator
    // pulls following \r/\n/U+2028/U+2029 into a normal space before
    // segment splitting runs, so the structural-redirect rule still
    // fires (now as warn).
    expect(
      evaluateBashCommand("printf x >\rsrc/foo.ts").decision,
    ).toBe("warn");
  });

  it("warns on LF-detached redirect target (printf x >\\nin-repo.ts)", () => {
    expect(
      evaluateBashCommand("printf x >\nsrc/foo.ts").decision,
    ).toBe("warn");
  });

  it("still treats CR as a segment boundary outside the redirect-operator carve-out", () => {
    // `cargo fmt\rmv a b`: \r is NOT after a redirect operator, so the
    // primary-split CR carve-out still applies and the `mv` segment is
    // seen on its own. v0.4.3: `mv` now warns (WARN_VERBS) instead of
    // denying — the CR-boundary behavior under test is unchanged; only
    // the verb decision is. Pinning the carve-out's narrow scope.
    expect(
      evaluateBashCommand("cargo fmt\rmv a b").decision,
    ).toBe("warn");
  });
});

describe("evaluateBashCommand — Codex PR #42 review fixes", () => {
  // Two P1 regressions surfaced by Codex on the dogfood PR. Pinned here
  // so the next refactor of the shell-hosting rescan does not regress.

  describe("P1-1: protected-path writes inside shell-hosted payloads", () => {
    // The dogfood-005 quote-stripping change blanked the payload of
    // bash -c / eval before touchesProtectedPath ran, so writes to
    // .meta-edit/state/** inside the wrapper's quoted argument
    // false-allowed. Fix: recursively evaluate the extracted argument
    // through the full policy.

    it("denies bash -c \"printf x > .meta-edit/state/edits.jsonl\"", () => {
      const r = evaluateBashCommand(
        'bash -c "printf x > .meta-edit/state/edits.jsonl"',
      );
      expect(r.decision).toBe("deny");
    });

    it("denies eval \"printf x > .meta-edit/state/edits.jsonl\"", () => {
      const r = evaluateBashCommand(
        'eval "printf x > .meta-edit/state/edits.jsonl"',
      );
      expect(r.decision).toBe("deny");
    });

    it("denies sh -c with redirect to .meta-edit/tmp", () => {
      const r = evaluateBashCommand(
        'sh -c "echo hi > .meta-edit/tmp/scratch.json"',
      );
      expect(r.decision).toBe("deny");
    });

    it("warns on bash -c with redirect to in-repo path (not protected)", () => {
      // The recursive evaluation propagates the structural in-repo
      // redirect signal inside the wrapper. v0.1.5: this is `warn`
      // rather than `deny` (SPEC §5.2). Protected-path writes inside
      // the wrapper still deny — see the cases above.
      const r = evaluateBashCommand('bash -c "printf x > src/foo.ts"');
      expect(r.decision).toBe("warn");
    });

    it("still allows bash -c with redirect to /tmp", () => {
      // The recursion must not over-deny: a write to a safe sink remains
      // allowed inside the wrapper.
      const r = evaluateBashCommand('bash -c "printf x > /tmp/notes.md"');
      expect(r.decision).toBe("allow");
    });
  });

  describe("P1-2: wrapper-prefixed eval (sudo eval, env eval)", () => {
    // matchesShellHostingDeny only checked `^eval` after env stripping,
    // so `sudo eval "..."` and `env eval "..."` walked through. Fix:
    // peel WRAPPER_VERBS the same way extractCommandVerb does before
    // looking for eval.

    it("denies sudo eval \"cat > src/foo.ts\"", () => {
      const r = evaluateBashCommand('sudo eval "cat > src/foo.ts"');
      expect(r.decision).toBe("deny");
    });

    it("denies env eval \"sed -i s/x/y/ src/foo.ts\"", () => {
      const r = evaluateBashCommand(
        'env eval "sed -i s/x/y/ src/foo.ts"',
      );
      expect(r.decision).toBe("deny");
    });

    it("denies doas eval \"...\"", () => {
      const r = evaluateBashCommand('doas eval "cat > src/foo.ts"');
      expect(r.decision).toBe("deny");
    });

    it("denies sudo -u root eval \"...\" (sudo with value-taking option)", () => {
      // Wrapper option grammar must be peeled too: `-u root` consumes
      // both tokens before reaching `eval`.
      const r = evaluateBashCommand(
        'sudo -u root eval "cat > src/foo.ts"',
      );
      expect(r.decision).toBe("deny");
    });

    it("denies FOO=bar sudo eval \"...\" (env-assignment-prefixed wrapper)", () => {
      const r = evaluateBashCommand(
        'FOO=bar sudo eval "sed -i s/a/b/ src/foo.ts"',
      );
      expect(r.decision).toBe("deny");
    });

    it("denies sudo eval with protected-path write (combined P1-1 + P1-2)", () => {
      // Both regressions stacked — must be caught by both fixes
      // working together.
      const r = evaluateBashCommand(
        'sudo eval "printf x > .meta-edit/state/edits.jsonl"',
      );
      expect(r.decision).toBe("deny");
    });
  });

  describe("P1-3: protected-path bypass via quoted write operand", () => {
    // The dogfood-005 quote-stripping change blanked quoted operands of
    // verbs that take a write target as a flag arg or positional
    // (sort -o, prettier --write, uniq, ...). The tokenize-based check
    // examines single-word tokens post-dequote so the quoted form still
    // trips the deny without re-introducing the dogfood-005 false-
    // positive for multi-word documentation strings.

    it("denies sort -o \"<protected>\" /tmp/in (quoted single-token path operand)", () => {
      const r = evaluateBashCommand(
        'sort -o ".meta-edit/state/edits.jsonl" /tmp/in',
      );
      expect(r.decision).toBe("deny");
      expect(r.reason).toContain("protected");
    });

    it("denies sort -o '<protected>' (single-quoted form)", () => {
      const r = evaluateBashCommand(
        "sort -o '.meta-edit/state/edits.jsonl' /tmp/in",
      );
      expect(r.decision).toBe("deny");
    });

    it("denies sort --output=<protected> (long-form unquoted)", () => {
      const r = evaluateBashCommand(
        "sort --output=.meta-edit/state/edits.jsonl /tmp/in",
      );
      expect(r.decision).toBe("deny");
    });

    it("denies prettier --write \"<protected>\" (quoted formatter target)", () => {
      const r = evaluateBashCommand(
        'prettier --write ".meta-edit/state/edits.jsonl"',
      );
      expect(r.decision).toBe("deny");
    });

    it("still allows multi-word documentation string mentioning protected path (dogfood-005 case b)", () => {
      // Quoted body is a multi-word documentation string, not a path
      // operand. Write redirect target is /tmp (safe sink). Must allow.
      const r = evaluateBashCommand(
        "printf 'edits land in .meta-edit/state/edits.jsonl' > /tmp/notes.md",
      );
      expect(r.decision).toBe("allow");
    });

    it("still allows tail of single-word protected path (read-only carve-out)", () => {
      // Single-word token IS a protected path, but the verb is in the
      // read-only carve-out and there is no redirect to a protected
      // target — debugging workflow remains allowed.
      const r = evaluateBashCommand("tail -2 .meta-edit/state/edits.jsonl");
      expect(r.decision).toBe("allow");
    });

    it("still denies traversal-aliased single-word path operand", () => {
      // Path-doubling collapse re-attaches `src/../.meta-edit/state/...`
      // to the protected component before the check.
      const r = evaluateBashCommand(
        'sort -o "src/../.meta-edit/state/edits.jsonl" /tmp/in',
      );
      expect(r.decision).toBe("deny");
    });
  });

  describe("Bash-policy review: xargs -I {} eval (Bug 1)", () => {
    // The wrapper-peel loop in extractEvalArg consumed `-I` but not its
    // value `{}`, so the next iteration treated `{}` as a verb and
    // failed. xargs's `-I REPLSTR` / `-J REPLSTR` / `--replace[=R]`
    // options take the next token as their value; without that
    // peeling, the wrapper-prefixed eval bypass reopens.

    it("denies xargs -I {} eval \"sed -i ...\"", () => {
      const r = evaluateBashCommand(
        'xargs -I {} eval "sed -i s/x/y/ src/foo.ts"',
      );
      expect(r.decision).toBe("deny");
    });

    it("denies xargs -I{} eval \"sed -i ...\" (glued no-space)", () => {
      const r = evaluateBashCommand(
        'xargs -I{} eval "sed -i s/x/y/ src/foo.ts"',
      );
      expect(r.decision).toBe("deny");
    });

    it("denies xargs --replace={} eval \"...\"", () => {
      const r = evaluateBashCommand(
        'xargs --replace={} eval "cat > src/foo.ts"',
      );
      expect(r.decision).toBe("deny");
    });

    it("denies xargs -J {} eval \"...\" (-J is xargs's alternate replace flag)", () => {
      const r = evaluateBashCommand(
        'xargs -J {} eval "cat > src/foo.ts"',
      );
      expect(r.decision).toBe("deny");
    });
  });

  describe("Bash-policy review: ANSI-C \\$'...' decoding (Bug 2)", () => {
    // stripQuotedContent treated `$'-i'` as `$` + `'-i'`, blanking the
    // contents. Real bash expands `$'-i'` to literal `-i`. The DENY
    // substring `sed -i` therefore did not match. Pre-decoding ANSI-C
    // C-style strings before the substring scans closes the bypass.

    it("denies sed $'-i' s/x/y/ src/foo.ts (ANSI-C wrapping the -i flag)", () => {
      const r = evaluateBashCommand("sed $'-i' s/x/y/ src/foo.ts");
      expect(r.decision).toBe("deny");
    });

    it("denies sed $'\\x2di' s/x/y/ src/foo.ts (hex escape for -)", () => {
      const r = evaluateBashCommand(
        "sed $'\\x2di' s/x/y/ src/foo.ts",
      );
      expect(r.decision).toBe("deny");
    });

    it("denies $'cat' > src/foo.ts (ANSI-C verb)", () => {
      const r = evaluateBashCommand("$'cat' > src/foo.ts");
      expect(r.decision).toBe("deny");
    });
  });
});

// ----------------------------------------------------------------------
// Issue 1107 — position-aware DENY_SUBSTRINGS scan.
//
// Verb-position deny preserved; argument-position demoted to warn.
// Recursion (bash -c "...", eval "...", find -exec ... \;) keeps inner
// segments at verb-position, so the typed-edit invariant holds.
// ----------------------------------------------------------------------
describe("evaluateBashCommand — 1107 position-aware verb-window", () => {
  it("denies sed -i at verb position (regression guard)", () => {
    const r = evaluateBashCommand("sed -i 's/x/y/' src/foo.ts");
    expect(r.decision).toBe("deny");
  });

  it("allows quoted-prose 'sed -i' inside commit message (already stripped by stripQuotedContent)", () => {
    // Quoted-string prose has been correctly blanked by stripQuotedContent
    // for some time; 1107 only changes behavior for prose that SURVIVES
    // stripping (heredoc bodies, unquoted args). Pin the existing
    // good behavior so a future stripQuotedContent regression is visible.
    const r = evaluateBashCommand(
      "git commit -m 'fix: avoid sed -i bypass when redirect is staged'",
    );
    expect(r.decision).toBe("allow");
  });

  it("allows quoted-prose 'cat >' inside commit message", () => {
    const r = evaluateBashCommand(
      "git commit -m 'add deny rule for cat > patterns'",
    );
    expect(r.decision).toBe("allow");
  });

  it("still warns on top-level `>` to non-safe-sink (1701 regression guard)", () => {
    // Negative case: plain top-level redirect (no $(...) wrapper) must
    // still warn. The depth-aware flag only suppresses substitution-
    // internal redirects.
    const r = evaluateBashCommand("printf hi > weird-sibling.txt");
    expect(r.decision).toBe("warn");
  });

  it("still denies substitution-hidden writes to protected paths (asymmetric depth)", () => {
    // The protected-path detector deliberately keeps all-depths walking
    // so substitution-hidden writes to .meta-edit/state/** still deny.
    // This locks the asymmetry between warn (depth-aware) and deny
    // (depth-blind) that 1701's design intentionally preserves.
    const r = evaluateBashCommand(
      "echo \"$(printf x > .meta-edit/state/edits.jsonl)\"",
    );
    expect(r.decision).toBe("deny");
  });

  it("warns when 'sed -i' appears in heredoc body (1700 actual dogfood)", () => {
    // The real PR #60 failure: heredoc bodies survive stripQuotedContent
    // and used to trip the unconditional substring deny. Position-aware
    // 1107 demotes this to warn — the substring is far past the verb
    // (`git`) and the recursion path doesn't reach the heredoc body's
    // free-form prose.
    const r = evaluateBashCommand(
      "git commit -m \"$(cat <<'EOF'\nfix: avoid sed -i bypass\nEOF\n)\"",
    );
    expect(r.decision).toBe("warn");
  });

  it("denies chained second segment with verb-position sed -i", () => {
    // 1107 §頼めないケース: "git commit -m 'x' ; sed -i ..." denies on
    // the second segment's verb-position sed -i. Important regression
    // guard: position-aware scan must apply per-segment.
    const r = evaluateBashCommand(
      "git commit -m 'ok' ; sed -i 's/x/y/' src/foo.ts",
    );
    expect(r.decision).toBe("deny");
  });

  it("denies bash -c \"sed -i ...\" via recursion (inner verb-position)", () => {
    const r = evaluateBashCommand(
      "bash -c \"sed -i 's/x/y/' src/foo.ts\"",
    );
    expect(r.decision).toBe("deny");
  });

  it("denies eval \"cat > src/foo.ts\" via recursion", () => {
    const r = evaluateBashCommand("eval \"cat > src/foo.ts\"");
    expect(r.decision).toBe("deny");
  });

  it("denies find -exec sed -i ... \\; via inner-segment extraction", () => {
    const r = evaluateBashCommand(
      "find . -name '*.ts' -exec sed -i 's/x/y/' {} \\;",
    );
    expect(r.decision).toBe("deny");
  });

  it("allows 'patch' inside quoted PR-body prose (stripped by stripQuotedContent)", () => {
    const r = evaluateBashCommand(
      "gh pr create --body 'extends hasSafetyFlag for the patch -oFILE form'",
    );
    expect(r.decision).toBe("allow");
  });
});

describe("evaluateBashCommand — v0.4.3 mv/cp/rsync verb-warn (relaxed from deny)", () => {
  // Loosened mv/cp/rsync from hard deny to the v0.1.5 structured warn
  // (SPEC §5.2). These guards pin both the relaxation AND the
  // load-bearing invariants that MUST survive it: protected-path writes
  // and patch stay hard-deny, deny still wins over warn, and the
  // hasSafetyFlag semantics are unchanged (warn, not allow).

  it("warns on mv src/a src/b (relaxed from deny in v0.4.3)", () => {
    const r = evaluateBashCommand("mv src/a src/b");
    expect(r.decision).toBe("warn");
    expect(r.reason).toContain("edit_*");
    expect(r.reason).toContain("mv");
  });

  it("warns on cp .env.example .env", () => {
    const r = evaluateBashCommand("cp .env.example .env");
    expect(r.decision).toBe("warn");
  });

  it("warns on rsync -a src/ dst/", () => {
    const r = evaluateBashCommand("rsync -a src/ dst/");
    expect(r.decision).toBe("warn");
  });

  it('warns on bash -c "rsync a b" (warn propagates from shell-hosted recursion)', () => {
    const r = evaluateBashCommand('bash -c "rsync a b"');
    expect(r.decision).toBe("warn");
  });

  // --- Load-bearing invariant: protected-path beats verb-warn ---------

  it("still denies mv payload .meta-edit/state/x (protected path beats verb-warn)", () => {
    const r = evaluateBashCommand("mv payload .meta-edit/state/x");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("protected meta-edit path");
  });

  it("still denies cp x .meta-edit/state/edits.jsonl", () => {
    const r = evaluateBashCommand("cp x .meta-edit/state/edits.jsonl");
    expect(r.decision).toBe("deny");
  });

  it("still denies rsync -a src/ .meta-edit/tmp/", () => {
    const r = evaluateBashCommand("rsync -a src/ .meta-edit/tmp/");
    expect(r.decision).toBe("deny");
  });

  it('still denies bash -c "mv payload .meta-edit/state/x" (protected beats verb-warn inside hosted payload)', () => {
    const r = evaluateBashCommand(
      'bash -c "mv payload .meta-edit/state/x"',
    );
    expect(r.decision).toBe("deny");
  });

  // --- Load-bearing invariant: patch stays deny ----------------------

  it("still denies patch -p1 < changes.diff (patch kept on deny)", () => {
    const r = evaluateBashCommand("patch -p1 < changes.diff");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("patch");
  });

  // --- Load-bearing invariant: deny wins over warn -------------------

  it("denies (mv-warn ; sed -i deny) — deny wins across segments", () => {
    const r = evaluateBashCommand("mv a b ; sed -i s/x/y/ src/foo.ts");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("sed -i");
  });

  it("denies (cargo fmt ; patch -p1 ; mv a b) — patch deny wins over mv warn", () => {
    const r = evaluateBashCommand(
      "cargo fmt ; patch -p1 < x.diff ; mv a b",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("patch");
  });

  it("denies (mv a b ; cat > .meta-edit/state/x) — protected deny wins over mv warn", () => {
    const r = evaluateBashCommand("mv a b ; cat > .meta-edit/state/x");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("meta-edit");
  });

  // --- Load-bearing invariant: hasSafetyFlag semantics unchanged -----

  it("warns (not allows) on mv --no-clobber a b — no safety-flag carve-out for mv", () => {
    const r = evaluateBashCommand("mv --no-clobber a b");
    expect(r.decision).toBe("warn");
  });

  it("warns (not allows) on cp -n a b — no safety-flag carve-out for cp", () => {
    const r = evaluateBashCommand("cp -n a b");
    expect(r.decision).toBe("warn");
  });
});

// Codex PR#76 P1: mv/cp/rsync relaxed to warn must still hard-deny a
// protected destination reached through a symlink alias (the lexical
// touchesProtectedPathTokenized and the `>`-only redirectsToProtected
// did not cover verb operands; the blanket verb deny used to mask it).
describe("evaluateBashCommand — v0.4.3 symlink-aliased protected operand (Codex PR#76 P1)", () => {
  it("denies mv whose destination is a symlink resolving into .meta-edit/state/", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-pr76-"));
    try {
      const metaEditDir = path.join(tmpDir, ".meta-edit");
      fs.mkdirSync(path.join(metaEditDir, "state"), { recursive: true });
      fs.symlinkSync(metaEditDir, path.join(tmpDir, "link"));
      const r = evaluateBashCommand("mv payload link/state/x", {
        cwd: tmpDir,
      });
      expect(r.decision).toBe("deny");
      expect(r.reason).toContain("protected meta-edit path");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("denies cp into a symlinked .meta-edit/tmp alias", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-pr76-"));
    try {
      const metaEditDir = path.join(tmpDir, ".meta-edit");
      fs.mkdirSync(path.join(metaEditDir, "tmp"), { recursive: true });
      fs.symlinkSync(metaEditDir, path.join(tmpDir, "alias"));
      const r = evaluateBashCommand("cp secret alias/tmp/exfil", {
        cwd: tmpDir,
      });
      expect(r.decision).toBe("deny");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("denies rsync into a symlinked protected alias", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-pr76-"));
    try {
      const metaEditDir = path.join(tmpDir, ".meta-edit");
      fs.mkdirSync(path.join(metaEditDir, "state"), { recursive: true });
      fs.symlinkSync(metaEditDir, path.join(tmpDir, "ln"));
      const r = evaluateBashCommand("rsync -a src/ ln/state/", {
        cwd: tmpDir,
      });
      expect(r.decision).toBe("deny");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("still WARNS (no false positive) on a legitimate mv when cwd is supplied and no protected alias is involved", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-pr76-"));
    try {
      const r = evaluateBashCommand("mv src/a.ts src/b.ts", {
        cwd: tmpDir,
      });
      expect(r.decision).toBe("warn");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Codex PR#76 follow-up P1: the path may be carried INSIDE an option
  // token (`--target-directory=alias/tmp`, `-talias/state`), which the
  // first fix's leading-`-` skip missed. Same option-glue surface issue
  // 1106 handles for the lexical check.
  it("denies cp --target-directory=<symlinked .meta-edit/tmp> (long-opt glue)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-pr76-"));
    try {
      const metaEditDir = path.join(tmpDir, ".meta-edit");
      fs.mkdirSync(path.join(metaEditDir, "tmp"), { recursive: true });
      fs.symlinkSync(metaEditDir, path.join(tmpDir, "alias"));
      const r = evaluateBashCommand(
        "cp --target-directory=alias/tmp payload",
        { cwd: tmpDir },
      );
      expect(r.decision).toBe("deny");
      expect(r.reason).toContain("protected meta-edit path");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("denies mv -t<symlinked .meta-edit/state> (short-opt glue)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-pr76-"));
    try {
      const metaEditDir = path.join(tmpDir, ".meta-edit");
      fs.mkdirSync(path.join(metaEditDir, "state"), { recursive: true });
      fs.symlinkSync(metaEditDir, path.join(tmpDir, "alias"));
      const r = evaluateBashCommand("mv -talias/state payload", {
        cwd: tmpDir,
      });
      expect(r.decision).toBe("deny");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("denies mv --target-directory=<symlinked .meta-edit/state> (space-free long opt)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-pr76-"));
    try {
      const metaEditDir = path.join(tmpDir, ".meta-edit");
      fs.mkdirSync(path.join(metaEditDir, "state"), { recursive: true });
      fs.symlinkSync(metaEditDir, path.join(tmpDir, "alias"));
      const r = evaluateBashCommand(
        "mv --target-directory=alias/state payload",
        { cwd: tmpDir },
      );
      expect(r.decision).toBe("deny");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("still WARNS on cp --target-directory=dist payload (option-glued path, no protected alias)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-pr76-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "dist"), { recursive: true });
      const r = evaluateBashCommand(
        "cp --target-directory=dist payload",
        { cwd: tmpDir },
      );
      expect(r.decision).toBe("warn");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// =====================================================================
// docs/plan/reminder-style-hooks/rfc.md §6 — reminder-style applies to
// classification-recovery surfaces only. verb-deny / protected-path /
// adversarial patterns keep imperative wording. These tests assert both
// directions: reminder surfaces include the prefix and semantic phrases;
// imperative surfaces do NOT include the prefix.
// =====================================================================

describe("evaluateBashCommand — reminder-style scoped to soft warns (RFC §6)", () => {
  describe("reminder ON: structural redirect warn (v0.1.5 surface)", () => {
    it("redirect to an in-repo path: reminder prefix + classification language", () => {
      const r = evaluateBashCommand("printf hello > src/foo.ts");
      expect(r.decision).toBe("warn");
      expect(r.reason).toContain("meta-edit reminder:");
      expect(r.reason).toContain("typed edit surface");
    });

    it("mv/cp/rsync verb-warn: reminder prefix + classification language", () => {
      for (const verb of ["mv", "cp", "rsync"]) {
        const r = evaluateBashCommand(`${verb} a b`);
        expect(r.decision).toBe("warn");
        expect(r.reason).toContain("meta-edit reminder:");
        expect(r.reason).toContain("declare the edit kind first");
      }
    });
  });

  describe("reminder OFF: verb-deny surfaces stay imperative", () => {
    it("sed -i: deny, no reminder prefix", () => {
      const r = evaluateBashCommand("sed -i 's/x/y/' src/foo.ts");
      expect(r.decision).toBe("deny");
      expect(r.reason).toContain("sed -i");
      expect(r.reason).not.toContain("meta-edit reminder:");
    });

    it("dd of=<in-repo>: deny, no reminder prefix", () => {
      const r = evaluateBashCommand("dd of=src/foo.ts if=/dev/zero");
      expect(r.decision).toBe("deny");
      expect(r.reason).not.toContain("meta-edit reminder:");
    });

    it("tee <in-repo>: deny, no reminder prefix", () => {
      const r = evaluateBashCommand("echo x | tee src/foo.ts");
      expect(r.decision).toBe("deny");
      expect(r.reason).not.toContain("meta-edit reminder:");
    });

    it("decode-and-execute pipe: deny, no reminder prefix", () => {
      const r = evaluateBashCommand("base64 -d <<< Zm9v | bash");
      expect(r.decision).toBe("deny");
      expect(r.reason).not.toContain("meta-edit reminder:");
    });

    it("heredoc with redirect: deny, no reminder prefix", () => {
      const r = evaluateBashCommand("cat <<EOF > src/foo.ts\nx\nEOF");
      expect(r.decision).toBe("deny");
      expect(r.reason).not.toContain("meta-edit reminder:");
    });

    it("inline interpreter write (python -c): deny, no reminder prefix", () => {
      const r = evaluateBashCommand(
        "python -c 'open(\"src/foo.ts\",\"w\").write(\"x\")'",
      );
      expect(r.decision).toBe("deny");
      expect(r.reason).not.toContain("meta-edit reminder:");
    });

    it("DENY_VERBS (patch): deny, no reminder prefix", () => {
      const r = evaluateBashCommand("patch src/foo.ts < d.patch");
      expect(r.decision).toBe("deny");
      expect(r.reason).not.toContain("meta-edit reminder:");
    });
  });

  describe("reminder OFF: protected-path surfaces stay imperative", () => {
    it("write to .meta-edit/state via redirect: deny, no reminder prefix", () => {
      const r = evaluateBashCommand("echo x > .meta-edit/state/edits.jsonl");
      expect(r.decision).toBe("deny");
      expect(r.reason).toContain("protected");
      expect(r.reason).not.toContain("meta-edit reminder:");
    });

    it("sed -i targeting .meta-edit/state: deny, no reminder prefix", () => {
      const r = evaluateBashCommand("sed -i 's/x/y/' .meta-edit/state/x.json");
      expect(r.decision).toBe("deny");
      expect(r.reason).toContain("protected");
      expect(r.reason).not.toContain("meta-edit reminder:");
    });
  });
});

// ---------------------------------------------------------------------------
// SEC-BASH-1/2/3/4 — interpreter/shell NAME gate is too literal.
//
// deny-bash-write-bypass matches interpreter / shell-host names by exact
// spelling (`bash`, `python`, `python3`, `perl`, `ruby`, `node`, `awk`,
// ...). Real systems expose the same interpreters under version-suffixed
// names (`python3.11`, `perl5.36`, `ruby3.2`), aliases (`rbash`, `mksh`,
// `pypy3`), and absolute paths (`/usr/bin/bash`). Each invokes the SAME
// interpreter with the SAME `-c` / `-e` / inline-write semantics, so each
// is an equivalent bypass that the literal name gate misses.
//
// SPEC §5.2 lists these as "Inline interpreter writes" (denied) and is
// explicit that ALL protected-path writes "remain `deny` regardless of
// verb". The version-suffixed / aliased / abs-path forms that target a
// protected path MUST therefore be denied; the source-file forms SHOULD
// be denied as inline-interpreter writes.
//
// These cases pin the DESIRED contract: they fail today because the gate
// only recognizes the canonical spellings, so the version/alias/abs-path
// forms currently return "allow".
// ---------------------------------------------------------------------------
describe("evaluateBashCommand — SEC-BASH version/alias/abs-path interpreter gate", () => {
  // SEC-BASH-1: shell-host `-c` recursion via aliases / version suffixes /
  // absolute path. Plain `bash -c '...'` is already denied (anchor below);
  // these equivalent shell hosts running the SAME recursive command must
  // be denied too — and because each targets a protected path, SPEC §5.2's
  // "regardless of verb" rule makes the deny mandatory.
  const shellHostDenyCases: Array<[string, string]> = [
    [
      "bash5 -c 'printf x > .meta-edit/state/edits.jsonl'",
      "bash5 (version-suffixed shell host)",
    ],
    [
      "/usr/bin/bash -c 'printf x > .meta-edit/state/edits.jsonl'",
      "/usr/bin/bash (absolute-path shell host)",
    ],
    [
      "rbash -c 'printf x > .meta-edit/state/edits.jsonl'",
      "rbash (restricted-bash alias)",
    ],
    [
      "mksh -c 'printf x > .meta-edit/state/edits.jsonl'",
      "mksh (mirbsd ksh alias)",
    ],
  ];
  for (const [command, label] of shellHostDenyCases) {
    it(`denies ${label}: "${command}"`, () => {
      const r = evaluateBashCommand(command);
      expect(r.decision).toBe("deny");
      expect(r.reason).toBeDefined();
    });
  }

  // SEC-BASH-2: versioned / aliased Python inline writes. `python -c` and
  // `python3 -c` are already denied (anchors below); the version/impl
  // variants run identical inline-write code and must be denied too.
  const pythonInlineDenyCases: Array<[string, string]> = [
    [
      "python3.11 -c 'open(\"src/foo.ts\",\"w\").write(\"x\")'",
      "python3.11 (version-suffixed)",
    ],
    [
      "python2 -c 'open(\"src/foo.ts\",\"w\").write(\"x\")'",
      "python2 (legacy major)",
    ],
    [
      "pypy3 -c 'open(\"src/foo.ts\",\"w\").write(\"x\")'",
      "pypy3 (alternate implementation)",
    ],
  ];
  for (const [command, label] of pythonInlineDenyCases) {
    it(`denies ${label} inline write: "${command}"`, () => {
      const r = evaluateBashCommand(command);
      expect(r.decision).toBe("deny");
      expect(r.reason).toBeDefined();
    });
  }

  // SEC-BASH-3: versioned perl / ruby inline writes. The a1-05 suite
  // already denies plain `perl -e` / `ruby -e`; the version-suffixed
  // binaries run the same code and must be denied too.
  it("denies perl5.36 -pi in-place edit of a source file", () => {
    const r = evaluateBashCommand("perl5.36 -pi -e 's/a/b/' src/foo.ts");
    expect(r.decision).toBe("deny");
    expect(r.reason).toBeDefined();
  });

  it("denies ruby3.2 -e File.write of a source file", () => {
    const r = evaluateBashCommand(
      "ruby3.2 -e 'File.write(\"src/foo.ts\",\"x\")'",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toBeDefined();
  });

  // SEC-BASH-4: awk / gawk in-script redirect. awk redirects to a file
  // from inside its program text (`print ... > "path"`), which is an
  // interpreter write that bypasses the typed surface. The gawk case
  // targets a protected path, so SPEC §5.2's "regardless of verb" rule
  // makes the deny mandatory.
  it("denies awk BEGIN in-script redirect to a source file", () => {
    const r = evaluateBashCommand("awk 'BEGIN{print 1 > \"src/foo.ts\"}'");
    expect(r.decision).toBe("deny");
    expect(r.reason).toBeDefined();
  });

  it("denies gawk BEGIN in-script append redirect to a protected path", () => {
    const r = evaluateBashCommand(
      "gawk 'BEGIN{printf \"y\" >> \".meta-edit/state/edits.jsonl\"}'",
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // CONTROL cases — these MUST ALREADY PASS. They guard the later fix
  // against over-generalization (e.g. denying every command whose first
  // token merely starts with "python" / "bash", or treating any mention of
  // an interpreter name as a write). All controls are equivalent to
  // existing allow-cases elsewhere in this file.
  // -------------------------------------------------------------------------

  // Canonical inline-write spellings are the literal-gate anchors: they are
  // already denied today and must STAY denied after the fix.
  it("control: python3 -c inline write stays denied (literal-gate anchor)", () => {
    const r = evaluateBashCommand(
      "python3 -c 'open(\"src/foo.ts\",\"w\").write(\"x\")'",
    );
    expect(r.decision).toBe("deny");
  });

  it("control: bash -c protected-path write stays denied (literal-gate anchor)", () => {
    const r = evaluateBashCommand(
      "bash -c 'printf x > .meta-edit/state/edits.jsonl'",
    );
    expect(r.decision).toBe("deny");
  });

  // A versioned interpreter running an ordinary SCRIPT (no -c / no inline
  // write) is normal dev work and must stay allowed — the fix must key on
  // the inline-eval flag + write, not on the binary name alone.
  it("control: python3 running a script file stays allow (no -c)", () => {
    expect(evaluateBashCommand("python3 script.py").decision).toBe("allow");
  });

  // An interpreter name appearing only as ARGUMENT TEXT (echo / commit
  // message) is not an invocation and must stay allowed.
  it("control: echo of the literal string 'bash5' stays allow", () => {
    expect(evaluateBashCommand("echo bash5").decision).toBe("allow");
  });

  it("control: commit message merely mentioning 'python3.11 -c' stays allow", () => {
    const r = evaluateBashCommand(
      "git commit -m 'fix: block python3.11 -c inline-write bypass'",
    );
    expect(r.decision).toBe("allow");
  });

  // A plain read with no redirect stays allowed (parity with the existing
  // "still allows grep with no redirect" case).
  it("control: grep -r foo src/ stays allow", () => {
    expect(evaluateBashCommand("grep -r foo src/").decision).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// Review hardening (codex + claude review of the SEC-BASH generalization).
// The generalized gates introduced three precision issues, each pinned below:
//  - F1: the perl in-place gate fired on a lowercase `i` inside an option
//    ARGUMENT (`-Ilib`, `-Mstrict`) — those are read-only invocations.
//  - F2: the awk redirect gate fired on a string COMPARISON (`$1 > "m"`),
//    not only on a `print`/`printf` redirect.
//  - F3: awk options before the program (`gawk -F, '...'` / `awk -v x=1 ...`)
//    let an in-script protected/in-repo redirect slip through unscanned.
// ---------------------------------------------------------------------------
describe("evaluateBashCommand — SEC-BASH review hardening", () => {
  // F1: `-I<path>` / `-M<module>` carry a lowercase `i` inside the option
  // argument, not an in-place `-i` flag. Ordinary read-only perl runs.
  it("control: perl -Ilib -e (include path, not in-place) stays allow", () => {
    expect(evaluateBashCommand("perl -Ilib -e 'print 1'").decision).toBe(
      "allow",
    );
  });
  it("control: perl -Mstrict -e (module, not in-place) stays allow", () => {
    expect(evaluateBashCommand("perl -Mstrict -e 'print 1'").decision).toBe(
      "allow",
    );
  });
  // The real in-place form must still deny (versioned binary) after the fix.
  it("perl5.36 -pi in-place still denies after the -Ilib/-Mstrict fix", () => {
    expect(
      evaluateBashCommand("perl5.36 -pi -e 's/a/b/' src/foo.ts").decision,
    ).toBe("deny");
  });

  // F2: `$1 > "m"` is an awk string comparison, not a redirect — stays allow.
  it('control: awk string comparison ($1 > "m") is not a redirect, stays allow', () => {
    expect(
      evaluateBashCommand("awk '$1 > \"m\" {print}' data.txt").decision,
    ).toBe("allow");
  });

  // F3: awk options before the program must not hide an in-script redirect.
  it("denies gawk -F, with an in-script protected-path redirect (option before program)", () => {
    expect(
      evaluateBashCommand(
        "gawk -F, 'BEGIN{print 1 > \".meta-edit/state/edits.jsonl\"}'",
      ).decision,
    ).toBe("deny");
  });
  it("denies awk -v with an in-script in-repo redirect (option before program)", () => {
    expect(
      evaluateBashCommand("awk -v x=1 'BEGIN{print 1 > \"src/foo.ts\"}'")
        .decision,
    ).toBe("deny");
  });
});

// ---------------------------------------------------------------------------
// Review hardening round 2 (Codex review of PR #106, three P2 findings —
// r3397371538 / r3397371545 / r3397371553):
//  - F1: perl flag bundles carrying DIGITS (`-0pi`) were outside the
//    `[a-z]*i` in-place cluster, so `perl5.36 -0pi -e ...` was allowed
//    even though perl still edits the file in place.
//  - F2: a parenthesized string comparison INSIDE print
//    (`print ($1 > "m")`) was mistaken for an in-script redirect and
//    denied, blocking read-only awk analysis one-liners.
//  - F3: python options before the inline flag (`python3.11 -B -c ...`)
//    fell outside the `\s+-c` gate, so the inline writer was allowed.
// ---------------------------------------------------------------------------
describe("evaluateBashCommand — SEC-BASH review hardening round 2", () => {
  // F1: digit-bearing flag bundles still perform the in-place write.
  it("denies perl5.36 -0pi (digit option bundled with -i) in-place edit", () => {
    expect(
      evaluateBashCommand("perl5.36 -0pi -e 's/a/b/' src/foo.ts").decision,
    ).toBe("deny");
  });
  it("denies perl -0777 -pi (separate digit flag before -pi) in-place edit", () => {
    expect(
      evaluateBashCommand("perl -0777 -pi -e 's/a/b/' src/foo.ts").decision,
    ).toBe("deny");
  });
  // The round-1 controls must survive: lowercase `i` inside an option
  // ARGUMENT is still not an in-place flag.
  it("control: perl -Ilib -e stays allow after the digit-bundle fix", () => {
    expect(evaluateBashCommand("perl -Ilib -e 'print 1'").decision).toBe(
      "allow",
    );
  });

  // F2: a comparison inside print's parens is not a redirect.
  it('control: awk print with parenthesized comparison (print ($1 > "m")) stays allow', () => {
    expect(
      evaluateBashCommand("awk '{print ($1 > \"m\")}' data.txt").decision,
    ).toBe("allow");
  });
  // A real redirect AFTER a parenthesized comparison must still deny —
  // the depth-0 `>` is the write.
  it("denies awk redirect following a parenthesized comparison", () => {
    expect(
      evaluateBashCommand(
        "awk '{print ($1 > \"m\") > \"src/foo.ts\"}' data.txt",
      ).decision,
    ).toBe("deny");
  });
  // A quoted `(` before the redirect must not inflate the paren depth
  // and hide the write.
  it("denies awk redirect whose printed string contains an open paren", () => {
    expect(
      evaluateBashCommand("awk 'BEGIN{print \"(\" > \"src/foo.ts\"}'").decision,
    ).toBe("deny");
  });
  // Round-1 deny cases must survive the depth-based rewrite.
  it("awk BEGIN in-script redirect to a source file still denies", () => {
    expect(
      evaluateBashCommand("awk 'BEGIN{print 1 > \"src/foo.ts\"}'").decision,
    ).toBe("deny");
  });

  // F3: interpreter options before `-c` still run the inline writer.
  it("denies python3.11 -B -c with an inline write", () => {
    expect(
      evaluateBashCommand(
        "python3.11 -B -c 'open(\"src/foo.ts\",\"w\").write(\"x\")'",
      ).decision,
    ).toBe("deny");
  });
  it("denies /usr/bin/python3 -I -B -c with an inline write", () => {
    expect(
      evaluateBashCommand(
        '/usr/bin/python3 -I -B -c \'open("src/foo.ts","w").write("x")\'',
      ).decision,
    ).toBe("deny");
  });
  // `python -m pytest -c <cfg>` is pytest's config flag, not python's
  // inline-code flag: the bare module name between `-m` and `-c` must
  // keep the gate closed.
  it("control: python -m pytest -c cfg.ini stays allow", () => {
    expect(
      evaluateBashCommand("python -m pytest -c cfg.ini").decision,
    ).toBe("allow");
  });
  it("control: python3 script.py stays allow", () => {
    expect(evaluateBashCommand("python3 script.py").decision).toBe("allow");
  });
});

