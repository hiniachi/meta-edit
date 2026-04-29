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

  it("allows node -e without write keywords", () => {
    expect(
      evaluateBashCommand("node -e 'console.log(1+1)'").decision,
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
