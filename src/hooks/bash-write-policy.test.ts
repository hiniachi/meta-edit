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
