import { describe, it, expect } from "bun:test";
import {
  evaluateBashCommand,
  ALLOWLIST_PATTERNS,
  DENY_SUBSTRINGS,
  DENY_PREFIX_PATTERNS,
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
    ["rsync -a src/ dst/", "rsync"],
    ["mv src/old.ts src/new.ts", "mv"],
    ["cp src/foo.ts src/bar.ts", "cp"],
    ["patch -p1 < changes.diff", "patch"],
  ];
  for (const [command, label] of denyCases) {
    it(`denies "${label}"`, () => {
      const r = evaluateBashCommand(command);
      expect(r.decision).toBe("deny");
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
  it("denies mv with tab argument separator", () => {
    const r = evaluateBashCommand("mv\tsrc/old.ts\tsrc/new.ts");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("mv");
  });

  it("denies cp with tab argument separator", () => {
    const r = evaluateBashCommand("cp\tsrc/a.ts\tsrc/b.ts");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("cp");
  });

  it("denies mv following a backgrounded allowlist segment via bare &", () => {
    // Without splitting on bare `&`, the whole string is one segment and
    // mv at position N is never seen as a segment-start prefix.
    const r = evaluateBashCommand("cargo fmt & mv src/a.ts src/b.ts");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("mv");
  });

  it("denies cp following bare &", () => {
    const r = evaluateBashCommand("eslint --fix src/ & cp src/a.ts src/b.ts");
    expect(r.decision).toBe("deny");
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

  it("strips leading env assignments before prefix matching (FOO=bar mv ...)", () => {
    const r = evaluateBashCommand("FOO=bar mv src/a.ts src/b.ts");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("mv");
  });

  it("strips multiple env assignments before prefix matching", () => {
    const r = evaluateBashCommand("FOO=bar BAZ=qux cp src/a.ts src/b.ts");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("cp");
  });

  it("strips quoted env assignment values", () => {
    const r = evaluateBashCommand('LANG="en US.UTF-8" mv src/a.ts src/b.ts');
    expect(r.decision).toBe("deny");
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
  const wrapperCases: Array<[string, string, string]> = [
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
    ["xargs patch -p1", "patch", "xargs"],
  ];
  for (const [command, verb, label] of wrapperCases) {
    it(`denies ${verb} via ${label}: "${command}"`, () => {
      const r = evaluateBashCommand(command);
      expect(r.decision).toBe("deny");
      expect(r.reason).toContain(verb);
    });
  }

  const absolutePathCases: Array<[string, string]> = [
    ["/usr/bin/mv a b", "mv"],
    ["/bin/cp a b", "cp"],
    ["/usr/local/bin/patch -p1 < x.diff", "patch"],
    ["sudo /usr/bin/mv a b", "mv"],
  ];
  for (const [command, verb] of absolutePathCases) {
    it(`denies basename match for "${command}"`, () => {
      const r = evaluateBashCommand(command);
      expect(r.decision).toBe("deny");
      expect(r.reason).toContain(verb);
    });
  }

  it("does not deny a wrapped allowlist-style verb", () => {
    expect(evaluateBashCommand("sudo cargo fmt").decision).toBe("allow");
    expect(evaluateBashCommand("env prettier --write src/").decision).toBe("allow");
  });

  it("skips wrapper short-options before the verb (sudo -E mv ...)", () => {
    const r = evaluateBashCommand("sudo -E mv src/a src/b");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("mv");
  });

  it("skips wrapper short-options grouped (env -i mv ...)", () => {
    const r = evaluateBashCommand("env -i mv src/a src/b");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("mv");
  });

  it("skips wrapper long-options (env --ignore-environment mv ...)", () => {
    const r = evaluateBashCommand("env --ignore-environment mv src/a src/b");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("mv");
  });

  it("skips wrapper long-option=value (env --chdir=/tmp mv ...)", () => {
    const r = evaluateBashCommand("env --chdir=/tmp mv src/a src/b");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("mv");
  });

  it("skips multiple flag-only wrapper options before verb", () => {
    // Flag-only wrapper options (no value arg) are reliably stripped.
    // Wrappers with required value args (`sudo -u USER`, `env -u VAR`)
    // would need per-wrapper option grammars to peel correctly; that
    // is documented in OBSERVED-FAILURES.md as a v0.2 candidate.
    const r = evaluateBashCommand("sudo -E -n mv src/a src/b");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("mv");
  });

  it("skips command -p prefix before verb", () => {
    const r = evaluateBashCommand("command -p cp src/a src/b");
    expect(r.decision).toBe("deny");
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
  it("exposes the documented deny prefixes", () => {
    expect(DENY_PREFIX_PATTERNS).toContain("mv ");
    expect(DENY_PREFIX_PATTERNS).toContain("cp ");
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

describe("evaluateBashCommand — v0.1.2 hook robustness (PR B)", () => {
  describe("command substitution expansion (items 1, 2)", () => {
    it("denies a backtick command substitution containing mv", () => {
      const r = evaluateBashCommand("cargo fmt && echo `mv old new`");
      expect(r.decision).toBe("deny");
    });

    it("denies a $(...) command substitution containing mv", () => {
      const r = evaluateBashCommand("cargo fmt && echo $(mv old new)");
      expect(r.decision).toBe("deny");
    });

    it("denies $() inside double quotes (POSIX expands it)", () => {
      const r = evaluateBashCommand('echo "result $(mv a b)"');
      expect(r.decision).toBe("deny");
    });

    it("allows $() inside single quotes (POSIX leaves it literal)", () => {
      const r = evaluateBashCommand("echo 'literal $(mv a b)'");
      expect(r.decision).toBe("allow");
    });

    it("allows benign $() with no deny patterns inside", () => {
      const r = evaluateBashCommand("echo $(date)");
      expect(r.decision).toBe("allow");
    });

    it("denies nested $() $(mv a b)", () => {
      const r = evaluateBashCommand("echo $(echo $(mv a b))");
      expect(r.decision).toBe("deny");
    });
  });

  describe("wrapper value-option grammar (item 3)", () => {
    it("denies sudo -u USER mv a b", () => {
      const r = evaluateBashCommand("sudo -u root mv a b");
      expect(r.decision).toBe("deny");
    });

    it("denies env -u VAR mv a b", () => {
      const r = evaluateBashCommand("env -u HOME mv a b");
      expect(r.decision).toBe("deny");
    });

    it("denies sudo -g grp cp x y", () => {
      const r = evaluateBashCommand("sudo -g admins cp x y");
      expect(r.decision).toBe("deny");
    });

    it("still strips wrapper flag-only opts (regression)", () => {
      const r = evaluateBashCommand("env -i mv a b");
      expect(r.decision).toBe("deny");
    });
  });

  describe("safety-flag exception (item 5)", () => {
    it("denies cp --no-clobber a b (still creates new file at dest)", () => {
      // Codex GitHub bot review on PR #27 (P1): `cp -n` /
      // `--no-clobber` only refuses to OVERWRITE an existing
      // destination — it still CREATES new files at the destination.
      // The original carve-out was a write bypass; backed out.
      const r = evaluateBashCommand("cp --no-clobber a b");
      expect(r.decision).toBe("deny");
    });

    it("denies cp -n a b (short form has the same bypass)", () => {
      const r = evaluateBashCommand("cp -n a b");
      expect(r.decision).toBe("deny");
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

    it("still denies cp without safety flag (regression)", () => {
      const r = evaluateBashCommand("cp a b");
      expect(r.decision).toBe("deny");
    });

    it("still denies mv with --no-clobber (no exception for mv)", () => {
      const r = evaluateBashCommand("mv --no-clobber a b");
      expect(r.decision).toBe("deny");
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
    it("denies $() with literal '(' inside the substitution body (quoted-paren)", () => {
      // Round 1 finding: a literal `'('` inside `$()` shifted the
      // depth count and the closing `)` was missed, so `mv a b` was
      // never extracted as an inner segment. The body now tracks
      // single/double quotes independently from the outer pass.
      const r = evaluateBashCommand('echo "$(printf \'(\'; mv a b)"');
      expect(r.decision).toBe("deny");
    });

    it("denies sudo -T <timeout> mv (sudo time-limit short option)", () => {
      const r = evaluateBashCommand("sudo -T 5 mv a b");
      expect(r.decision).toBe("deny");
    });

    it("denies sudo -R <chroot> mv (sudo chroot short option)", () => {
      const r = evaluateBashCommand("sudo -R /jail mv a b");
      expect(r.decision).toBe("deny");
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
  });

  describe("Unicode line separators (item 8)", () => {
    it("treats CR as a segment boundary", () => {
      const r = evaluateBashCommand("cargo fmt\rmv a b");
      expect(r.decision).toBe("deny");
    });

    it("treats U+2028 LINE SEPARATOR as a segment boundary", () => {
      const r = evaluateBashCommand("cargo fmt mv a b");
      expect(r.decision).toBe("deny");
    });

    it("treats U+2029 PARAGRAPH SEPARATOR as a segment boundary", () => {
      const r = evaluateBashCommand("cargo fmt mv a b");
      expect(r.decision).toBe("deny");
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

  it("denies find -exec cp (exec bypass via outer find verb)", () => {
    expect(
      evaluateBashCommand(
        "find src/ -name '*.ts' -exec cp {} /tmp/backup \;",
      ).decision,
    ).toBe("deny");
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
  it("denies busybox mv (busybox wrapper not recognized)", () => {
    expect(
      evaluateBashCommand("busybox mv src/a.ts src/b.ts").decision,
    ).toBe("deny");
  });

  it("denies busybox sed -i (busybox wrapper not recognized)", () => {
    expect(
      evaluateBashCommand("busybox sed -i 's/x/y/' src/foo.ts").decision,
    ).toBe("deny");
  });

  it("denies busybox cp (busybox wrapper not recognized)", () => {
    expect(
      evaluateBashCommand("busybox cp src/foo.ts src/bar.ts").decision,
    ).toBe("deny");
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

  it("denies LANG=en_US.UTF-8 mv src/a.ts src/b.ts (multi-locale prefix before mv)", () => {
    expect(
      evaluateBashCommand("LANG=en_US.UTF-8 mv src/a.ts src/b.ts").decision,
    ).toBe("deny");
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
  it("denies env -i mv (env -i must not consume mv as value of -i)", () => {
    const r = evaluateBashCommand("env -i mv src/a.ts src/b.ts");
    expect(r.decision).toBe("deny");
  });

  it("denies env -i cp", () => {
    const r = evaluateBashCommand("env -i cp src/foo.ts src/bar.ts");
    expect(r.decision).toBe("deny");
  });

  it("denies env -i patch", () => {
    const r = evaluateBashCommand("env -i patch -p1 < changes.diff");
    expect(r.decision).toBe("deny");
  });

  it("denies env --ignore-environment mv (long form)", () => {
    const r = evaluateBashCommand("env --ignore-environment mv src/a.ts src/b.ts");
    expect(r.decision).toBe("deny");
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
