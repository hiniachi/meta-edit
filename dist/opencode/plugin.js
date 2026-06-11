var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/opencode/plugin.ts
import * as fs9 from "node:fs";
import * as path10 from "node:path";
import { fileURLToPath } from "node:url";

// src/hooks/raw-edit-policy.ts
import * as crypto3 from "node:crypto";
import * as fs7 from "node:fs/promises";
import * as path7 from "node:path";

// src/reminders/context.ts
function buildReminderContext(input) {
  const isWriteAllowed = input.phase === "write_allowed";
  const lines = [
    phaseLine(input),
    scopeReviewLine(input.phase),
    ...isWriteAllowed ? [] : [kindCueLine(input.kind), kindObligationsLine(input)],
    provenanceLine(input.provenance, input.phase),
    executionStateLine(input),
    ...isWriteAllowed ? [] : [targetFollowupLine(input)],
    auditWarningsLine(input.auditWarnings, input.phase)
  ];
  const kept = lines.filter((line) => line !== undefined && line.length > 0);
  return `meta-edit reminder:

${kept.join(`

`)}`;
}
var KIND_TARGET_OBLIGATIONS = {
  edit_boundary_condition: {
    test: "This test pins the defined limits of the boundary — both sides of the threshold and the case just beyond it where the spec says an error is the correct answer. The impl-mirror smell is a single off-by-one fixed-point lifted from the production code; real boundary tests push the system right to the edge of its defined limits. Cite an accepted_artifact that names the limit; if the only provenance is direct_observation against prod, the boundary the test pins is whatever the implementation happens to do, not what was promised.",
    prod: "You forward-declared boundary-value tests; this production edit must keep the defined limits stable on both sides. Movement of the threshold itself is a different kind — re-classify, do not absorb."
  },
  edit_boolean_condition: {
    test: 'This test pins the decision — every atomic condition independently flips the outcome, not merely drives the predicate to true once and false once. The impl-mirror smell is one happy-path case and one failure case, which achieves statement coverage but cannot show that each sub-condition matters. Cite an accepted_artifact stating the rule the predicate encodes; direct_observation provenance usually means "I read && and || and wrote a case per branch", which mirrors the implementation.',
    prod: "You committed to predicate-level tests; this production edit must keep each clause's independent effect on the outcome observable. Collapsing two conditions or short-circuiting one away breaks the matrix — re-derive it from the spec, do not let the new code shape it."
  },
  edit_state_transition: {
    test: "This test pins the legal transition graph — which states reach which, which transitions are forbidden, and what invariant holds across each edge. The impl-mirror smell is a test that walks the exact sequence the code happens to implement and only asserts the final state. Cite an accepted_artifact drawing the state diagram; cover at least one forbidden transition explicitly.",
    prod: "You forward-declared state-transition tests; this production edit must preserve which legal transitions reach which states, which transitions are forbidden, and the across-edge invariants. Adding or removing a state, or changing reachability, is a spec-level change — surface it."
  },
  edit_db_schema: {
    test: "This test pins the schema invariants — uniqueness, foreign-key closure, nullability, index reachability. Inspecting the produced schema shape is fine; sourcing the expected shape from the current CREATE TABLE is the impl-mirror smell. Cite an accepted_artifact (ERD, data dictionary, ADR) naming each invariant; direct_observation against the migration is a happy-path round-trip, not an invariant test.",
    prod: "You committed to schema-invariant tests; this production edit must keep the invariants enforceable by the DB itself (constraints, indexes, FKs). Moving a constraint from the DB to application code is a separate decision — surface it, do not weaken the schema and lean on tests to catch it."
  },
  edit_data_migration: {
    test: `This test pins the anomaly behavior of the migration — what holds if the process dies mid-way, what holds on re-run, what holds under compound failure. Inspecting produced data is fine; the expected before/after invariants come from the migration's stated invariants, not from sampling current prod rows. The impl-mirror smell is a "ran in a clean DB, counted rows, looks fine" test, which is the happy path. The idempotency test runs first.`,
    prod: "You forward-declared anomaly-style migration tests; this production migration must remain safe under interruption and re-run. A new atomic step the old migration did not require changes the anomaly surface — re-derive the test list, do not reuse the old one."
  },
  edit_api_contract: {
    test: "This test pins the published interface — request shape, response shape, status codes, error semantics — using only what callers can observe. The impl-mirror smell is a test asserting on internal serialization order, internal field names not in the contract, or response timing the spec does not promise. Cite an accepted_artifact (OpenAPI / IDL / RFC / contract doc); direct_observation lets the test accidentally pin implementation leaks.",
    prod: "You committed to contract-level tests; this production edit must keep the published interface stable. Adding a field, narrowing input, or widening output is a contract change — re-classify, do not absorb."
  },
  edit_serialization: {
    test: "This test pins two things: round-trip equivalence (serialize → deserialize → same value) and malformed-input robustness (parser must reject bytes changed by some means other than the canonical serializer, without unwholesome actions). The impl-mirror smell is a test that round-trips through the same library version's own encoder and decoder — that proves a fixed point of the current implementation, not format compatibility. Include at least one cross-version or hand-crafted byte fixture.",
    prod: "You forward-declared round-trip and malformed-input tests; this production edit must keep the serialized form readable by older consumers (or explicitly bump a version) and keep the parser robust against bytes it did not produce. Regenerating fixtures from the new encoder destroys the equivalence signal — re-derive fixtures from the spec."
  },
  edit_error_handling: {
    test: "This test pins behavior under injected failure, not behavior on the happy path — rig a dependency to fail after a certain number of operations and assert both that the error is reported correctly and no invariant is violated. The impl-mirror smell is a test asserting try/catch fires on a real (uninjected) error during setup: that mirrors the catch block the code happens to have, not the spec's promise about errors. Cite an accepted_artifact listing which failure modes the contract acknowledges; run both single-failure and continuous-failure modes where the surface allows.",
    prod: "You committed to fault-injection tests; this production edit must keep every error path observable from the outside (correct code returned, no resource leaked, no invariant violated). A catch that drops the error silently is the failure case those tests exist to detect."
  },
  edit_retry_timeout: {
    test: 'This test pins the exhaustion semantics — how many retries, what backoff, what the caller sees after the final attempt — and the compound case where the retry itself encounters a new failure. The impl-mirror smell is asserting "after retry succeeds, value matches": that proves the retry loop exits, not that the policy is correct. Cover the "Nth attempt succeeds" case (recovery point advances) and the "every attempt fails" case (continuous-failure mode) plus the compound case "retry path itself hits a different failure". Cite an accepted_artifact naming the retry budget.',
    prod: "You forward-declared retry/timeout exhaustion tests; this production edit must keep the budget, backoff schedule, and giveup signal compatible with what those tests assert. Silent budget extension masks an underlying error — surface it."
  },
  edit_concurrency: {
    test: "This test pins the across-interleaving invariant — what must always hold regardless of which thread interleaves where — not a particular observed interleaving. Assert mutexes are held at all the right moments; assert that nothing is written to X which has not first been written and synced to Y. The impl-mirror smell is running two threads, hitting a race a few times by luck, and asserting no exception fires — that pins the OS schedule, not the invariant. Cite an accepted_artifact naming the invariant (lock order, happens-before relation, atomicity boundary); prefer a precondition/postcondition assertion to a probabilistic schedule.",
    prod: "You committed to interleaving-invariant tests; this production edit must keep the lock order / happens-before / atomicity boundary intact. Widening or narrowing a critical section is a relevant change — re-derive the invariant list, do not lean on existing tests to catch a regression they were not designed for."
  },
  edit_external_side_effect: {
    test: "This test pins what is sent to the outside world — count, ordering, idempotency under replay — track outbound effects (emails, webhooks, payments, log lines) and report leaks on every test run. The impl-mirror smell is asserting the side-effect function was called once on the happy path, with no retry-replay assertion, no partial-failure assertion, no ordering assertion: that pins the call site, not the contract. Cite an accepted_artifact describing the at-least-once / at-most-once / exactly-once contract; direct_observation gives you the production frequency, which is a fact about traffic, not about the contract.",
    prod: "You forward-declared side-effect accounting tests; this production edit must keep the at-least-once / at-most-once / exactly-once posture stated in the test, and keep emissions idempotent under retry. Adding a side effect to a previously side-effect-free path is a re-classification. If your test makes a real external call, your test is wrong — that prohibition stays in force."
  },
  edit_cache_invalidation: {
    test: "This test pins the freshness invariant: cached answer must equal authoritative answer for every input. The impl-mirror smell is a write-through read-back test (the easiest case, read-your-own-writes) that entirely skips the cross-actor invalidation case where someone else changed the underlying data. Run the scenario with the cache enabled and again with it busted, assert identical results. Cite an accepted_artifact naming the staleness budget; direct_observation gives you the TTL window, not the contract.",
    prod: "You committed to freshness-invariant tests; this production edit must keep the equivalence cached answer == authoritative answer intact for every documented invalidation trigger. A new write path that does not invalidate the cache silently widens the staleness window — the canonical failure this kind exists to catch."
  },
  edit_permission_logic: {
    test: "This test pins the authorization matrix — every (principal, resource, action) cell exercised in both allow and deny direction, where each axis independently flips the decision. The impl-mirror smell is a test that walks the if/else ladder in the authz function and writes one case per leaf: that proves the code is consistent with itself, not that the matrix matches the policy. Cite an accepted_artifact (RBAC table, policy doc, ADR); direct_observation is a strong smell because in prod you only see allowed requests at scale — denied requests are the negative space and must be tested explicitly.",
    prod: "You forward-declared an authz matrix; this production edit must keep every cell's allow/deny decision matching the cited policy. Loosening a deny or tightening an allow is edit_policy_change, not this kind — re-classify, do not let the matrix drift."
  },
  edit_dependency_config: {
    test: "This test pins behavior across the dependency / build matrix — the same answer must come out regardless of optimization level, signed-char default, endianness, or word size. The impl-mirror smell is a test that succeeds on the developer's exact toolchain version and silently depends on it: that pins the dev environment, not the supported environment. Cite an accepted_artifact (supported-versions table, MSRV / engines policy, build-matrix CI config); for a pinned dependency version, include at least the boundary versions of the supported range.",
    prod: 'You committed to build-matrix tests; this production edit must keep the equivalence "same answer across all supported build variants" intact. Tightening a version range is edit_policy_change; widening it requires fresh evidence from each new supported point — do not extrapolate.'
  }
};
function kindObligationsLine(input) {
  const { kind, target } = input;
  if (kind === undefined || target === undefined)
    return;
  if (kind === "edit_cosmetic")
    return;
  const entry = KIND_TARGET_OBLIGATIONS[kind];
  if (entry === undefined)
    return;
  return target === "prod" ? entry.prod : entry.test;
}
function phaseLine(input) {
  const kind = input.kind ?? "a typed meta-edit declaration";
  const target = targetPhrase(input.target, input.phase);
  const file = input.targetFile ? ` for ${sanitize(input.targetFile)}` : "";
  if (input.phase === "write_allowed") {
    return `This native write matched my ${kind}${target} declaration${file}.`;
  }
  return `I declared this as ${kind}${target}${file}. The next native Edit / Write / MultiEdit should stay inside that declaration.`;
}
function targetPhrase(target, phase) {
  if (target === "prod") {
    return phase === "write_allowed" ? " production-code" : " for production code";
  }
  if (target === "test")
    return ' target="test"';
  return "";
}
function scopeReviewLine(phase) {
  if (phase !== "write_allowed")
    return;
  return "Before moving on, I should check whether the chosen kind and file scope still match the actual edit. " + "If the write crossed another kind or file, the next move is a fresh typed declaration for that scope.";
}
function kindCueLine(kind) {
  switch (kind) {
    case "edit_boundary_condition":
      return "The next test should pin just below, at, and just above the boundary.";
    case "edit_boolean_condition":
      return "The next test should make the important true/false condition combinations visible.";
    case "edit_state_transition":
      return "The next test should show the allowed transition and the forbidden transition.";
    case "edit_db_schema":
      return "The next check should cover the schema shape and the migration impact.";
    case "edit_data_migration":
      return "The next test should compare existing data before and after, and check idempotency.";
    case "edit_api_contract":
      return "The next test should expose the compatibility, status-code, or missing/extra-field contract.";
    case "edit_serialization":
      return "The next test should cover round-trip behavior and any legacy format still accepted.";
    case "edit_error_handling":
      return "The next test should drive the intended failure path and check the surfaced context.";
    case "edit_retry_timeout":
      return "The next test should cover retry count, timeout, and exhaustion behavior.";
    case "edit_concurrency":
      return "The next test should exercise the interleaving or duplicate action this change is meant to handle.";
    case "edit_external_side_effect":
      return "The next check should protect against duplicate or unintended external action.";
    case "edit_cache_invalidation":
      return "The next test should distinguish stale reads from refreshed reads.";
    case "edit_permission_logic":
      return "The next test should distinguish allowed and denied actors or states.";
    case "edit_dependency_config":
      return "The next check should make the runtime or environment impact explicit.";
    case "edit_policy_change":
      return "The next move should confirm the user-facing scope before treating this as settled policy.";
    case "edit_cosmetic":
      return "This should remain a semantic no-op: whitespace, comments, or formatter output only.";
    case "edit_decision":
      return "An edit_decision will be read as accepted project intent. If that is not true, edit_decision is the wrong tool.";
    case "edit_explanation":
      return "An edit_explanation will be read as shipped behavior for future readers. It should stay consistent with the code or observation source.";
    case "edit_progress":
      return "This should record session progress, not create new project policy.";
    case "edit_observation":
      return "This should keep the observed fact and evidence visible.";
    case "edit_proposal":
      return "This should stay proposal-shaped until accepted.";
    default:
      return kind === undefined ? undefined : "I should follow the obligations in the selected tool description before moving on.";
  }
}
var WORKFLOW_KINDS = new Set([
  "edit_progress",
  "edit_observation",
  "edit_proposal",
  "edit_decision",
  "edit_explanation",
  "edit_policy_change"
]);
var ESCAPE_KINDS = new Set([
  "edit_observation",
  "edit_proposal"
]);
function executionStateLine(input) {
  const state = input.executionState;
  if (state === undefined || state === "normal")
    return;
  if (state === "recovery") {
    return "I am in recovery — a deliberate diagnosis mode entered after " + "recognizing a failure. Verify assumptions against primary sources " + "(official documentation, etc.), confirm a single hypothesis, and " + "make the next fix only then. Keep steps small and reversible. " + "Return to normal once the failure is resolved.";
  }
  if (state !== "repeating_failure")
    return;
  const kind = input.kind;
  if (kind === undefined)
    return;
  if (ESCAPE_KINDS.has(kind)) {
    return "I have acknowledged repeating_failure and I am recording it — this " + "is the right move. Write reproduction conditions, recent changes, " + "and competing hypotheses as three separate items. Ground each " + "hypothesis by checking my assumptions against primary sources " + "before forming it, and do not return to implementation fixes until " + "a single hypothesis is isolated.";
  }
  if (WORKFLOW_KINDS.has(kind)) {
    return;
  }
  if (input.phase === "write_allowed") {
    return "This fix landed while I had declared repeating_failure. If I have " + "not yet run the escape procedure — record the failure with " + "edit_observation, check my assumptions against primary sources, " + "isolate one hypothesis — I should do that before the next edit " + "instead of stacking another fix.";
  }
  return "I was about to keep implementing while repeating the same kind of " + "failure. Before stacking another fix I should run the escape " + "procedure — (1) record it with edit_observation: write reproduction " + "conditions, recent changes, and competing hypotheses as separate " + "items; (2) re-read the error message literally and check my " + "assumptions against primary sources (official documentation, the " + "actual source, execution logs); (3) narrow to a single hypothesis " + "and verify it with a minimal reproduction; (4) only then decide the " + "next move.";
}
function provenanceLine(provenance, phase) {
  switch (provenance) {
    case "user_confirmed":
      if (phase === "write_allowed")
        return;
      return "Because the provenance is user-confirmed, the prose should stay inside the confirmed user intent.";
    case "accepted_artifact":
      if (phase === "write_allowed")
        return;
      return "Because the provenance is accepted artifact, the prose should keep the accepted artifact or citation visible.";
    case "direct_observation":
      if (phase === "write_allowed")
        return;
      return "Because the provenance is direct observation, the prose should keep the observation source visible.";
    case "inference":
      if (phase === "write_allowed") {
        return "Because the provenance is inference, if the landed prose sounds confirmed, I should revise it with a fresh typed declaration so the uncertainty is visible.";
      }
      return "Because the provenance is inference, I should land only if the prose carries that uncertainty instead of sounding confirmed.";
    case "speculation":
      if (phase === "write_allowed") {
        return "Because the provenance is speculation, if the landed prose reads as established fact, I should revise it with a fresh typed declaration so it stays marked as an unverified hypothesis.";
      }
      return "Because the provenance is speculation, I should land only if the prose is strongly hedged as an unverified hypothesis.";
    default:
      return;
  }
}
function targetFollowupLine(input) {
  if (input.target === "prod" && input.declaredTestFiles && input.declaredTestFiles.length > 0) {
    return `If the matching test was written first, the next move is to run that red test and confirm this production edit is what makes it pass. ` + `If no matching test exists yet, the next move is a target="test" declaration for ` + `${input.declaredTestFiles.map(sanitize).join(", ")}.`;
  }
  if (input.target === "test") {
    return `This test edit should exercise this same kind of change, not drift into unrelated cleanup. ` + `If this is the TDD red step, it should fail against the current production code for the intended reason. ` + `If it already passes, it may not be proving the intended change.`;
  }
  return;
}
function auditWarningsLine(auditWarnings, phase) {
  if (auditWarnings === undefined || auditWarnings.length === 0) {
    return;
  }
  const summary = auditWarnings.map((w) => `[${w.code}] ${w.message}`).join(`
  - `);
  if (phase === "write_allowed") {
    return `audit warnings were recorded for this declaration:
  - ${summary}
` + `If the landed edit did not account for them, I should revise with a fresh typed declaration and keep the chosen kind honest.`;
  }
  return `audit warnings recorded for this declaration:
  - ${summary}
` + `I should land only if the prose carries that uncertainty and the chosen kind is still the right tool.`;
}
var CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g;
function sanitize(value) {
  return value.replace(CONTROL_CHARS_RE, "?");
}

// src/state/edit-log.ts
import * as crypto2 from "node:crypto";
import * as fs6 from "node:fs";
import * as path6 from "node:path";

// node_modules/zod/v3/external.js
var exports_external = {};
__export(exports_external, {
  void: () => voidType,
  util: () => util,
  unknown: () => unknownType,
  union: () => unionType,
  undefined: () => undefinedType,
  tuple: () => tupleType,
  transformer: () => effectsType,
  symbol: () => symbolType,
  string: () => stringType,
  strictObject: () => strictObjectType,
  setErrorMap: () => setErrorMap,
  set: () => setType,
  record: () => recordType,
  quotelessJson: () => quotelessJson,
  promise: () => promiseType,
  preprocess: () => preprocessType,
  pipeline: () => pipelineType,
  ostring: () => ostring,
  optional: () => optionalType,
  onumber: () => onumber,
  oboolean: () => oboolean,
  objectUtil: () => objectUtil,
  object: () => objectType,
  number: () => numberType,
  nullable: () => nullableType,
  null: () => nullType,
  never: () => neverType,
  nativeEnum: () => nativeEnumType,
  nan: () => nanType,
  map: () => mapType,
  makeIssue: () => makeIssue,
  literal: () => literalType,
  lazy: () => lazyType,
  late: () => late,
  isValid: () => isValid,
  isDirty: () => isDirty,
  isAsync: () => isAsync,
  isAborted: () => isAborted,
  intersection: () => intersectionType,
  instanceof: () => instanceOfType,
  getParsedType: () => getParsedType,
  getErrorMap: () => getErrorMap,
  function: () => functionType,
  enum: () => enumType,
  effect: () => effectsType,
  discriminatedUnion: () => discriminatedUnionType,
  defaultErrorMap: () => en_default,
  datetimeRegex: () => datetimeRegex,
  date: () => dateType,
  custom: () => custom,
  coerce: () => coerce,
  boolean: () => booleanType,
  bigint: () => bigIntType,
  array: () => arrayType,
  any: () => anyType,
  addIssueToContext: () => addIssueToContext,
  ZodVoid: () => ZodVoid,
  ZodUnknown: () => ZodUnknown,
  ZodUnion: () => ZodUnion,
  ZodUndefined: () => ZodUndefined,
  ZodType: () => ZodType,
  ZodTuple: () => ZodTuple,
  ZodTransformer: () => ZodEffects,
  ZodSymbol: () => ZodSymbol,
  ZodString: () => ZodString,
  ZodSet: () => ZodSet,
  ZodSchema: () => ZodType,
  ZodRecord: () => ZodRecord,
  ZodReadonly: () => ZodReadonly,
  ZodPromise: () => ZodPromise,
  ZodPipeline: () => ZodPipeline,
  ZodParsedType: () => ZodParsedType,
  ZodOptional: () => ZodOptional,
  ZodObject: () => ZodObject,
  ZodNumber: () => ZodNumber,
  ZodNullable: () => ZodNullable,
  ZodNull: () => ZodNull,
  ZodNever: () => ZodNever,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNaN: () => ZodNaN,
  ZodMap: () => ZodMap,
  ZodLiteral: () => ZodLiteral,
  ZodLazy: () => ZodLazy,
  ZodIssueCode: () => ZodIssueCode,
  ZodIntersection: () => ZodIntersection,
  ZodFunction: () => ZodFunction,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodError: () => ZodError,
  ZodEnum: () => ZodEnum,
  ZodEffects: () => ZodEffects,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodDefault: () => ZodDefault,
  ZodDate: () => ZodDate,
  ZodCatch: () => ZodCatch,
  ZodBranded: () => ZodBranded,
  ZodBoolean: () => ZodBoolean,
  ZodBigInt: () => ZodBigInt,
  ZodArray: () => ZodArray,
  ZodAny: () => ZodAny,
  Schema: () => ZodType,
  ParseStatus: () => ParseStatus,
  OK: () => OK,
  NEVER: () => NEVER,
  INVALID: () => INVALID,
  EMPTY_PATH: () => EMPTY_PATH,
  DIRTY: () => DIRTY,
  BRAND: () => BRAND
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {};
  function assertIs(_arg) {}
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error;
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};

class ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
}
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== undefined) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      ctx.schemaErrorMap,
      overrideMap,
      overrideMap === en_default ? undefined : en_default
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}

class ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
}
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
class ParseInputLazyPath {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
}
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}

class ZodType {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus,
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(undefined).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
}
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}

class ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}

class ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
}
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};

class ZodBoolean extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
}
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};

class ZodSymbol extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};

class ZodUndefined extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};

class ZodNull extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};

class ZodAny extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};

class ZodUnknown extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};

class ZodNever extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
}
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};

class ZodVoid extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};

class ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : undefined,
          maximum: tooBig ? def.exactLength.value : undefined,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}

class ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {} else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== undefined ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  extend(augmentation) {
    return new ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  merge(merging) {
    const merged = new ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  catchall(index) {
    return new ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
}
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};

class ZodUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = undefined;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
}
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [undefined];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [undefined, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};

class ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  static create(discriminator, options, params) {
    const optionsMap = new Map;
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
}
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}

class ZodIntersection extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
}
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};

class ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new ZodTuple({
      ...this._def,
      rest
    });
  }
}
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};

class ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
}

class ZodMap extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = new Map;
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = new Map;
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
}
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};

class ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = new Set;
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};

class ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
}

class ZodLazy extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
}
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};

class ZodLiteral extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
}
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}

class ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
}
ZodEnum.create = createZodEnum;

class ZodNativeEnum extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
}
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};

class ZodPromise extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
}
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};

class ZodEffects extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
}
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
class ZodOptional extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(undefined);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};

class ZodNullable extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};

class ZodDefault extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
}
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};

class ZodCatch extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
}
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};

class ZodNaN extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
}
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");

class ZodBranded extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
}

class ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
}

class ZodReadonly extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER = INVALID;
// src/tools/common.ts
import * as crypto from "node:crypto";
import * as fs5 from "node:fs";
import * as path5 from "node:path";

// src/tools/descriptions.ts
var TOOL_NAMES = [
  "edit_cosmetic",
  "edit_boundary_condition",
  "edit_boolean_condition",
  "edit_state_transition",
  "edit_db_schema",
  "edit_data_migration",
  "edit_api_contract",
  "edit_serialization",
  "edit_error_handling",
  "edit_retry_timeout",
  "edit_concurrency",
  "edit_external_side_effect",
  "edit_cache_invalidation",
  "edit_permission_logic",
  "edit_dependency_config",
  "edit_progress",
  "edit_observation",
  "edit_proposal",
  "edit_decision",
  "edit_explanation",
  "edit_policy_change"
];
var TOOL_TITLES = Object.freeze(Object.fromEntries(TOOL_NAMES.map((name) => [
  name,
  `${name}: ${name.replace(/^edit_/, "").replace(/_/g, " ")} declaration`
])));
var WORKFLOW_TOOLS = [
  "edit_progress",
  "edit_observation",
  "edit_proposal",
  "edit_decision",
  "edit_explanation",
  "edit_policy_change"
];
var TOOLS_REQUIRING_TEST_FILES = TOOL_NAMES.filter((name) => name !== "edit_cosmetic" && !WORKFLOW_TOOLS.includes(name));
var TOOLS_REQUIRING_TARGET = TOOL_NAMES.filter((name) => !WORKFLOW_TOOLS.includes(name));
var PROVENANCE_FOOTER = `Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- \`user_confirmed\` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- \`accepted_artifact\` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (\`§...\`, \`ADR-...\`, \`issues/...\`, \`RFC-...\`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- \`direct_observation\` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- \`inference\` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- \`speculation\` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.`;
var EXECUTION_STATE_FOOTER = `Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- \`normal\` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- \`repeating_failure\` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- \`recovery\` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.`;
var TOOL_DESCRIPTIONS = {
  edit_cosmetic: `Surface-level edit with no semantic effect and no information change:
whitespace, formatter output, or comment edits that do not change the
information content of the comment.

Cosmetic edits are exempt from spec-derivation discipline —
whitespace, formatter output, and information-invariant comment
edits do not pin behavior.

Use this tool when, and ONLY when, the patch is one of the following:
- Whitespace adjustment (indentation, blank lines, trailing whitespace,
  line breaks)
- Comment edits that change NO information content (typo fix,
  line-break reflow within a comment block, formatter-driven comment
  reformatting). Comments that add or change information go through the
  workflow kind that matches the comment's intent — \`edit_explanation\`
  for reader-facing clarification, \`edit_observation\` for
  observed-fact notes (\`// XXX ...\`, stale-comment deletions),
  \`edit_proposal\` for open questions (\`// TODO ...\`,
  \`// FIXME ...\`).
- Output of a configured formatter run (gofmt, prettier, black, rustfmt,
  etc.) — the bytes produced by running the project's formatter, with
  no manual edits layered on top

This tool MUST NOT be used for:
- Variable, function, type, parameter, or file renames — there is no
  generic "rename" tool by design. If the rename crosses an exported
  boundary, use edit_api_contract. If the rename is internal only, stop
  and ask the user (the typed surface does not yet have a tool for that
  shape; observe how often this comes up before adding one)
- Function or module extraction, inlining, or restructuring — stop and
  ask
- Dead code removal — stop and ask, then use the impl tool matching the
  code's original kind (the removal may have observable consequences
  that the original kind's tests already cover)
- Reordering of declarations whose order carries meaning (CSS
  specificity, dependency injection priority, init order, decorator
  stack order)
- Import / export / visibility modifier changes — these are
  edit_api_contract (if exported) or stop-and-ask
- Any change that touches comparison, boolean, guard, return shape,
  error handling, serialization, permission, cache, concurrency,
  retry/timeout, side effects, or persistence — use the kind-specific
  impl tool

Required tests: NONE. Existing tests must continue to pass. test_files
may be empty.

Target (required):
Declare \`target: "prod"\` for cosmetic edits to production files, or
\`target: "test"\` for cosmetic edits to test files. Cosmetic changes
do not require behavioral tests in either case; \`test_files\` may be
empty.

Fallback obligation:
If, after applying this tool, you discover that your patch did anything
beyond whitespace / comment / formatter output (a rename slipped in, a
guard clause moved, an import was reorganized in a way that affects
linting or shadowing), you owe the user a follow-up explanation in your
next message: name what slipped in, and say why the narrow definition
did not catch it before you applied. This is a personal debt that posts
to the user, not a detection bypass — acknowledging the slip is what
keeps the typed surface honest.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (cosmetic-specific):
This tool accepts only \`user_confirmed\`, \`accepted_artifact\`, and
\`direct_observation\`. Declaring \`inference\` or \`speculation\` here
is rejected. cosmetic has zero semantic effect, so epistemic uncertainty
is a structural signal that the kind selection is wrong: the patch
likely adds or changes information (in which case use the matching
workflow kind) or changes behavior (in which case use the kind-specific
impl tool). Re-classify before retrying.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_boundary_condition: `Modify a comparison, threshold, limit, or boundary in production code.

The boundary value being changed is defined by the spec / accepted
artifact / user statement, not by what the implementation currently
happens to compute.

Use this tool when:
- Changing comparison operators (<, <=, >, >=, ==, !=)
- Changing numeric limits or thresholds (max, min, cap, floor, ceiling)
- Changing range bounds (loop bounds, array sizes, page sizes)
- Changing pagination, rate limit, timeout duration, retry count
- Changing buffer or window sizes

Per-target obligations (what \`target: "prod"\` commits to, what
\`target: "test"\` must contain) are delivered in the declaration
result. If you cannot enumerate all three boundary values
(just-below, at, just-above) for this change at declaration time,
the boundary semantics are unclear; stop and ask the user to clarify
which value should be inclusive and which should be exclusive before
declaring.

When \`target: "prod"\`, \`test_files\` must list at least one file
where the boundary tests will be added. Existing test files are
acceptable.

Target (required):
Declare \`target: "prod"\` for the production-side edit and
\`target: "test"\` for the test-side edit. The two declarations may
land in either order — red-first (\`target: "test"\` first, then
\`target: "prod"\`) or green-first (\`target: "prod"\` first, then
\`target: "test"\`) — and both may land in the same commit. When
\`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_boolean_condition: `Modify a boolean expression, conditional logic, or guard clause in
production code.

The boolean rule being changed is defined by the spec / accepted
artifact / user statement (the business rule, policy, or invariant),
not by what the implementation currently happens to evaluate.

Use this tool when:
- Changing boolean operators (&&, ||, !)
- Adding or removing conditions in an if / else / switch
- Adding or removing guard clauses or early returns
- Changing the structure of conditional branching
- Changing null / nil / undefined checks

Per-target obligations (path coverage, independent influence of each
atomic condition, and a test that distinguishes the new logic from
the old) are delivered in the declaration result.

If the boolean change is purely a transformation that preserves truth
values (e.g., De Morgan's law applied), it still goes through this tool —
the rewritten bytes affect future readers and modifiers, so the kind-
specific risk surface still applies. edit_cosmetic is reserved for
whitespace / comments / formatter output only and does NOT cover boolean
restructuring.

Target (required):
Declare \`target: "prod"\` for the production-side edit and
\`target: "test"\` for the test-side edit. The two declarations may
land in either order — red-first (\`target: "test"\` first, then
\`target: "prod"\`) or green-first (\`target: "prod"\` first, then
\`target: "test"\`) — and both may land in the same commit. When
\`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_state_transition: `Modify a state machine, workflow, or status transition in production code.

The state machine being changed (which transitions are legal, which
are forbidden, what invariant holds across each edge) is defined by
the state diagram / transition table / accepted artifact, not by
what the current code happens to allow.

Use this tool when:
- Adding, removing, or modifying allowed transitions between states
- Changing what triggers a state transition
- Adding or removing valid states
- Changing the side effects that occur on transition

Per-target obligations (allowed-transition coverage, forbidden-
transition rejection with no partial state change, invalid-input
no-op) are delivered in the declaration result.

If your change adds new states, you must also test transitions from
existing states into the new states, and from the new states to existing
states (where allowed).

Target (required):
Declare \`target: "prod"\` for the production-side edit (state
machine) and \`target: "test"\` for its transition tests. The two
declarations may land in either order — red-first (\`target: "test"\`
first, then \`target: "prod"\`) or green-first (\`target: "prod"\`
first, then \`target: "test"\`) — and both may land in the same
commit. When \`target: "test"\`, \`target_file\` IS the test file
and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_db_schema: `Modify database schema: tables, columns, indexes, constraints, migrations.

The schema invariants being changed (uniqueness, foreign-key closure,
nullability, index reachability) are defined by the data model / ERD /
accepted ADR, not by what the current CREATE TABLE statement happens
to produce.

Use this tool when:
- Adding, removing, or modifying columns, tables, indexes
- Changing constraints (NOT NULL, UNIQUE, FOREIGN KEY, CHECK)
- Creating or modifying migration files (DDL)
- Changing collation, charset, or storage parameters

Per-target obligations (migration applies cleanly, existing data
compatibility, rollback OR forward-only justification, index /
constraint behavior) are delivered in the declaration result.

If your change modifies existing data (UPDATE statements, data
backfills), you MUST also use edit_data_migration alongside this tool.

Target (required):
Declare \`target: "prod"\` for the production-side edit (migration /
DDL) and \`target: "test"\` for the migration tests. The two
declarations may land in either order — red-first (\`target: "test"\`
first, then \`target: "prod"\`) or green-first (\`target: "prod"\`
first, then \`target: "test"\`) — and both may land in the same
commit. When \`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_data_migration: `Modify production data through migration scripts, backfills, or
data-transformation code.

The before/after invariants being established are defined by the
migration spec / accepted artifact, not by what the current data
happens to look like in production.

Use this tool when:
- Backfilling data into new columns
- Transforming or normalizing existing data
- Correcting bad data through scripted updates
- Splitting or merging records

Per-target obligations (idempotency, partial-failure recovery, fixture
transformation, edge cases) are delivered in the declaration result.
**The idempotency test is the single most important one — write it
first.** That ordering is load-bearing.

Target (required):
Declare \`target: "prod"\` for the production-side edit (migration /
backfill script) and \`target: "test"\` for the migration tests. The
two declarations may land in either order — red-first
(\`target: "test"\` first, then \`target: "prod"\`) or green-first
(\`target: "prod"\` first, then \`target: "test"\`) — and both may
land in the same commit. When \`target: "test"\`, \`target_file\`
IS the test file and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_api_contract: `Modify the request or response shape of an API: endpoints, fields, status
codes, schemas.

The contract being changed is defined by the spec / accepted
artifact (OpenAPI, IDL, RFC, ADR), not by what the current handler
implementation happens to return.

Use this tool when:
- Adding, removing, or renaming fields in API request or response
- Changing field types or formats
- Changing status codes returned for given conditions
- Adding or removing endpoints
- Modifying OpenAPI / GraphQL / gRPC schema files

Per-target obligations (what \`target: "prod"\` commits to —
backward compatibility, missing/extra field handling, status-code
coverage — and what the matching \`target: "test"\` file must
contain) are delivered in the declaration result.

If the change is a breaking change, the rationale field must say so
explicitly, e.g., "Breaking change: removing the deprecated \`legacyId\`
field. Migration plan: ..."

Target (required):
Declare \`target: "prod"\` for the production-side edit (handlers,
schemas, OpenAPI / GraphQL / gRPC definitions) and \`target: "test"\`
for the contract tests. The two declarations may land in either order
— red-first (\`target: "test"\` first, then \`target: "prod"\`) or
green-first (\`target: "prod"\` first, then \`target: "test"\`) — and
both may land in the same commit. When \`target: "test"\`,
\`target_file\` IS the test file and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_serialization: `Modify a serializer, parser, codec, or data format handler.

The format contract being changed (byte-level layout, supported
versions, what counts as malformed) is defined by the format spec /
RFC / data dictionary, not by what the current encoder happens to
emit.

Use this tool when:
- Changing JSON / YAML / XML / Protobuf / MessagePack handling
- Modifying custom binary or text formats
- Changing how data is encoded for storage or transport
- Modifying compatibility layers between format versions

Per-target obligations (round-trip equivalence, read-old-format,
write-new-format, malformed-input rejection) are delivered in the
declaration result.

If the format change is intentionally non-backward-compatible, the
rationale must say so and describe the migration path for existing data.

Target (required):
Declare \`target: "prod"\` for the production-side edit (serializer /
parser / codec) and \`target: "test"\` for its round-trip / old-format
/ invalid-input tests. The two declarations may land in either order
— red-first (\`target: "test"\` first, then \`target: "prod"\`) or
green-first (\`target: "prod"\` first, then \`target: "test"\`) — and
both may land in the same commit. When \`target: "test"\`,
\`target_file\` IS the test file and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_error_handling: `Modify how errors, exceptions, or failure paths are handled.

The failure surface being changed (which errors propagate, in what
form, with what observable signal) is defined by the contract /
accepted artifact, not by whatever the current code happens to throw.

Use this tool when:
- Adding, removing, or modifying try / catch blocks
- Changing what exceptions are thrown or how they propagate
- Modifying fallback or retry logic on failure
- Changing rollback behavior on partial success
- Changing what is logged or reported on error

Per-target obligations (failure-path execution, observable error,
post-failure state, error type / code) are delivered in the
declaration result.

Swallowing exceptions is forbidden unless the rationale explicitly states
why and what the recovery path is.

Target (required):
Declare \`target: "prod"\` for the production-side edit (error-handling
code) and \`target: "test"\` for the tests that exercise failure paths
and observable-error contracts. The two declarations may land in
either order — red-first (\`target: "test"\` first, then
\`target: "prod"\`) or green-first (\`target: "prod"\` first, then
\`target: "test"\`) — and both may land in the same commit. When
\`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_retry_timeout: `Modify retry, timeout, or backoff behavior.

The retry budget being changed (retry count, backoff schedule,
timeout, giveup signal) is defined by the SLA / accepted artifact,
not by whatever value is currently configured in production.

Use this tool when:
- Changing retry counts, retry intervals, or backoff strategies
- Modifying timeout durations
- Adding or removing retry logic
- Changing idempotency keys or duplicate-detection logic

Per-target obligations (timeout exhaustion, retry exhaustion, no
duplicate side effects under retry, success-on-retry) are delivered
in the declaration result.

Target (required):
Declare \`target: "prod"\` for the production-side edit (retry /
timeout / backoff logic) and \`target: "test"\` for its exhaustion /
duplicate-side-effect / success-on-retry tests. The two declarations
may land in either order — red-first (\`target: "test"\` first, then
\`target: "prod"\`) or green-first (\`target: "prod"\` first, then
\`target: "test"\`) — and both may land in the same commit. When
\`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_concurrency: `Modify concurrency primitives: locks, transactions, mutexes, parallelism,
race conditions.

The concurrency invariant being changed (atomicity boundary, lock
order, happens-before relation) is defined by the spec / accepted
artifact / concurrency model, not by what the current code happens
to interleave.

Use this tool when:
- Adding, removing, or modifying locks (mutex, RWLock, semaphore)
- Changing transaction boundaries or isolation levels
- Modifying parallel execution (async, threads, goroutines)
- Changing lock ordering or scope
- Adding or removing critical sections

Per-target obligations (consistent-final-state under concurrent
execution, race-prevention coverage, atomic-scope assertions) are
delivered in the declaration result.

If you cannot reproduce the race or contention this change addresses,
the change is speculative. Prefer to demonstrate the bug with a failing
test before applying the fix.

Target (required):
Declare \`target: "prod"\` for the production-side edit (concurrency
primitives) and \`target: "test"\` for the concurrency tests. The
two declarations may land in either order — red-first
(\`target: "test"\` first, then \`target: "prod"\`) or green-first
(\`target: "prod"\` first, then \`target: "test"\`) — and both may
land in the same commit. When \`target: "test"\`, \`target_file\`
IS the test file and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_external_side_effect: `Modify code that produces external side effects: emails, events, queue
messages, webhooks, billing operations, audit logs.

The side-effect contract being changed (when it fires, against whom,
with what payload, at-least-once / at-most-once / exactly-once
posture) is defined by the integration spec / accepted artifact, not
by the production frequency the current code happens to produce.

Use this tool when:
- Adding, removing, or modifying calls that affect external systems
- Changing what events are emitted or to whom
- Modifying billing or payment-affecting logic
- Changing notification logic
- Adding or removing audit or compliance logging

Per-target obligations (fires-on-success, no-fire-on-failure,
idempotency under retry, correct recipient / payload) are delivered
in the declaration result.

For test environments, side effects MUST be mocked or routed to a test
sink. Verify that the test does not actually charge a card or send a
real email. **If your test makes a real external call, your test is
wrong.** This prohibition is load-bearing.

Target (required):
Declare \`target: "prod"\` for the production-side edit (side-effect-
producing code) and \`target: "test"\` for its tests. The two
declarations may land in either order — red-first (\`target: "test"\`
first, then \`target: "prod"\`) or green-first (\`target: "prod"\`
first, then \`target: "test"\`) — and both may land in the same
commit. When \`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_cache_invalidation: `Modify cache keys, TTLs, invalidation logic, or staleness handling.

The freshness contract being changed (staleness budget, invalidation
events, TTL) is defined by the spec / accepted artifact, not by what
the current cache code happens to return.

Use this tool when:
- Changing cache key generation
- Modifying TTL or expiration logic
- Adding or removing invalidation triggers
- Changing what is cached or where

Per-target obligations (stale-data prevention, invalidation-trigger
coverage, TTL boundary, key collision) are delivered in the
declaration result.

Target (required):
Declare \`target: "prod"\` for the production-side edit (cache key /
TTL / invalidation logic) and \`target: "test"\` for its tests. The
two declarations may land in either order — red-first
(\`target: "test"\` first, then \`target: "prod"\`) or green-first
(\`target: "prod"\` first, then \`target: "test"\`) — and both may
land in the same commit. When \`target: "test"\`, \`target_file\`
IS the test file and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_permission_logic: `Modify authorization, access control, role checks, ownership checks,
tenancy, or feature flag gating.

The authorization matrix being changed (which subjects may take which
actions on which resources) is defined by the policy / RBAC table /
ADR, not by what the current authz code happens to allow.

Use this tool when:
- Changing role / permission / owner / tenant / feature flag checks
- Modifying access control predicates
- Changing the subject-action-resource matrix
- Modifying authentication state checks
- Changing API key, token, or session validation

Per-target obligations (allow matrix coverage, deny matrix coverage,
negative-side-effect-on-deny, edge cases: suspended user / expired
token / missing role / deleted resource) are delivered in the
declaration result.

If you cannot enumerate the allow matrix and the deny matrix for this
change, the change is too risky to apply without further specification.
Stop and ask for the matrix to be confirmed before proceeding.

Target (required):
Declare \`target: "prod"\` for the production-side edit (permission /
authz code) and \`target: "test"\` for the allow / deny matrix tests
and negative-side-effect tests. The two declarations may land in
either order — red-first (\`target: "test"\` first, then
\`target: "prod"\`) or green-first (\`target: "prod"\` first, then
\`target: "test"\`) — and both may land in the same commit. When
\`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_dependency_config: `Modify package dependencies, runtime configuration, or feature
configuration files.

The dependency / config contract being changed (supported versions,
runtime defaults, environment expectations) is defined by the
supported-versions table / MSRV / build-matrix CI config / accepted
artifact, not by what is on the developer's machine right now.

Use this tool when:
- Adding, removing, or upgrading package dependencies
- Modifying runtime config (env vars, config files)
- Changing feature flag default values
- Modifying build or deploy configuration that affects runtime behavior

Per-target obligations (build / install reproducibility, behavior
under new config, default-value backward compatibility) are
delivered in the declaration result.

For security-related dependency upgrades, the rationale must say so
explicitly.

Boundary with edit_policy_change (Cargo.toml / pyproject.toml / package.json
overlap). Manifests with mixed personalities — package metadata + build
profile + per-target optimization flags — sometimes straddle the line.
Use edit_dependency_config when the change is about WHICH packages are
present at WHICH versions (the dep graph or runtime config). Use
edit_policy_change when the change is about HOW the build / release
runs (release profile flags, codegen options, CI behavior, lint rules).
A Cargo.toml \`[dependencies]\` entry update is dependency_config; a
\`[profile.release]\` flag flip (e.g. \`opt-level\`, \`lto\`,
\`wasm-opt = false\`) is policy_change. When a single PR touches both
sections, split into two declarations.

Fallback obligation:
Before applying this tool, summarize the change in user-facing
terms: which package, what version delta, runtime vs dev, expected
impact on the build or development loop. Surprise dependency
updates are how contributors lose a day to a broken local
environment; the user has standing to intercept before it lands.

Target (required):
Declare \`target: "prod"\` for the production-side edit (manifest /
config) and \`target: "test"\` for tests that exercise the new
configuration. The two declarations may land in either order —
red-first (\`target: "test"\` first, then \`target: "prod"\`) or
green-first (\`target: "prod"\` first, then \`target: "test"\`) — and
both may land in the same commit. When \`target: "test"\`,
\`target_file\` IS the test file and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_policy_change: `Modify the policy itself — the bytes that DEFINE how this project
expects code and configuration to be written: hooks' policy text,
Claude permissions, CI configuration affecting meta-edit, this
server's tool descriptions, the SPEC sections that the server
enforces, or the AI-instruction documents (CLAUDE.md, AGENTS.md,
\`.cursor/rules\`, etc.) that future sessions read first.

This tool addresses the *declaration* of a policy change — the prose
/ configuration text that future sessions will read as authoritative.
The code that *implements* the new policy (e.g. hook logic for a new
deny rule, schema additions for a new field, CI scripts that
materialize the new gate) routes through the matching impl kind —
typically \`edit_permission_logic\` for hook behavior,
\`edit_api_contract\` for argument schemas, \`edit_dependency_config\`
for build-tooling pieces — because the spec / policy comes first and
the implementation follows.

The policy line being moved is defined by the policy text / ADR /
compliance requirement, not by what the current configuration
happens to allow.

Use this tool when, and ONLY when, the patch is one of the following:
- Modifying \`.claude/\` configuration (the policy text itself)
- Modifying \`.github/workflows/\` files that affect meta-edit
- Modifying AI-instruction files (CLAUDE.md, AGENTS.md,
  \`.cursor/rules\`, etc.)
- Modifying tool descriptions of \`edit_*\` tools themselves
- Modifying SPEC.md / ADR / RFC sections that define behavior the
  server enforces
- Modifying build / release profile flags in package manifests
  (\`[profile.release]\` in Cargo.toml, \`[tool.poetry.build]\` in
  pyproject.toml, \`scripts\` / \`engines\` mutations in package.json
  that change how the project builds or releases) — see the boundary
  note in edit_dependency_config

This tool MUST NOT be used for:
- Code that *implements* a policy (hook handler logic, schema
  validators, CI scripts) — those go through the matching impl kind.
  The policy *text* changes here; the policy *implementation*
  changes elsewhere
- Recording that a policy change was decided in this session — that
  is \`edit_decision\`, written before the policy bytes change
- Editing executable production code or test code — use the
  kind-specific impl tool

Policy changes that LOOSEN restrictions (allowing previously-denied
operations, reducing test obligations, removing obligations from
\`edit_*\` tool descriptions, removing or weakening hook deny rules)
require an explicit justification in rationale that explains why the
loosening is safe. "Convenience" is not an acceptable rationale.

If your change loosens a restriction without a strong justification,
do not use this tool. Reconsider whether the restriction was correct
in the first place.

Fallback obligation:
Before applying this tool, ask the user a clarifying question about
the intended scope of the policy change, even when the change feels
obvious. A single confirmation message is the cost of the safer path.
Loosening restrictions, modifying hook behavior, and editing tool
descriptions all carry implications the user has the standing to
weigh; do not assume.

Required tests: NONE. Policy bytes are prose / configuration — not
executable; \`test_files\` must be empty. Tests for the *code that
implements* a policy are forward-declared by that impl kind's own
paired declaration (e.g. the paired \`edit_permission_logic\` /
\`target: "prod"\` call that adds the hook handler).

This tool does NOT carry a \`target\` field: policy / configuration
content does not belong to the prod/test axis. The prod/test target
flag is required only on the 15 impl tools (14 SQLite-derived +
\`edit_cosmetic\`).

\`additional_files\` cardinality:
This tool accepts \`additional_files\` for \`user_confirmed\` and
\`accepted_artifact\` (the common pattern: a single policy line is
mirrored across CLAUDE.md, SPEC.md, and \`descriptions.ts\` in one
declaration — CLAUDE.md §4's verbatim-mirror rule makes this a
natural batch) and warns for \`direct_observation\` (which usually
means you are recording what was already there, not asserting a new
policy line). The \`inference\` and \`speculation\` cells are
unreachable because the declaration itself is rejected at the (kind,
provenance) level — policy bytes cannot be moved on the basis of
inference or speculation.

Rationale: policy bytes are what future sessions read as "this is how
we work." Conflating policy with inference or speculation lets
unverified opinion become operating procedure for the next session.
The workflow is: decisions are made first (\`edit_decision\`); the
policy bytes are then changed here (\`edit_policy_change\`); code that
implements the new policy follows in its matching impl kind.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (edit_policy_change-specific):
This tool rejects \`inference\` and \`speculation\` — policy bytes
must trace back to a confirmed source. The typical provenance is
\`user_confirmed\` (a policy change confirmed by the user in the
current session; quote or summarize the confirming statement in the
rationale) or \`accepted_artifact\` (codifying a previously-accepted
ADR / RFC / spec section into the policy artifact). \`direct_observation\`
is accepted when the edit is mechanical mirroring of an
already-existing policy line between artifacts (e.g. propagating a
CLAUDE.md change into \`descriptions.ts\` per the verbatim-mirror
rule), and lands with an audit_warnings note because "observing" a
policy usually means recording an existing one rather than asserting
a new one.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_progress: `Record what was actually done, tried, or observed in the current
session — a session work-log entry. The most common target is
\`IMPLEMENTATION-LOG.md\`, but the same intent applies wherever the
project keeps session work-log notes.

Use this tool when, and ONLY when, the entry is one of the following:
- "I implemented X" — recording a concrete change that was just made
- "I tried Y, and Z was the result" — recording an attempt and its
  outcome (whether the attempt worked or not)
- "what worked / known issues / open questions" sections about what
  happened in this session
- Phase-completion entries that summarize what shipped in the session
- Dogfood notes about the agent's own behavior in this session

This tool MUST NOT be used for:
- Recording decisions ("we will adopt X") — those are \`edit_decision\`,
  written only after the decision is confirmed
- Recording observations generalized beyond the session ("X breaks when
  Y") — those are \`edit_observation\` (the observation outlives the
  session that found it)
- Proposing changes or raising open questions about the future — those
  are \`edit_proposal\`
- Describing how the system works for a future reader — that is
  \`edit_explanation\`
- Editing executable production code, test code, or configuration —
  use the matching kind-specific impl tool
- Asserting authoritative outcomes about other sessions' work
  (\`I observed that the previous session's X is wrong\`) — observation
  about another session's artifact is \`edit_observation\` or
  \`edit_proposal\`

Required tests: NONE. Progress notes are not executable; \`test_files\`
must be empty.

This tool does NOT carry a \`target\` field: workflow / progress
content does not belong to the prod/test axis. The prod/test target
flag is required only on the 15 impl tools (14 SQLite-derived +
\`edit_cosmetic\`).

\`additional_files\` cardinality:
This tool rejects \`additional_files\` in every provenance cell.
Progress is a per-session, per-place record — a batched progress note
across multiple files is almost always two separate moments fused, and
the audit log stays cleaner when each moment is its own declaration.
Split the entry.

Rationale: a progress entry exists to record what happened in this
session moment, not to argue for or against a course of action.
Conflating progress with decisions or proposals erases the distinction
between "done" and "should be done" — the exact distinction this
refactor is meant to restore.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (edit_progress-specific):
All five provenance values are accepted. The typical value is
\`direct_observation\` (the agent observed itself doing the work).
\`inference\` / \`speculation\` are accepted but the prose obligation
is strict: hedging language must surface in the body, not only in the
provenance field. A session work-log entry written with
\`speculation\` provenance whose prose reads as a confirmed outcome is
the exact "past-chat looks like a decision" failure this refactor is
meant to prevent.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_observation: `Record an observation, surprise, finding, or gotcha — content that
is meant to outlive the session that found it. The most common targets
are \`OBSERVED-FAILURES.md\`, code comments that flag known-bad
patterns (\`// XXX ...\`, \`// HACK ...\`), and bug-pattern notes
elsewhere in the project.

Use this tool when, and ONLY when, the entry is one of the following:
- "A breaks B when condition C holds" — recording a discovered failure
  pattern that will matter to future sessions
- "Adding code comment that an existing pattern is unsafe / surprising
  / load-bearing" (\`// XXX heredoc + redirect bypasses cat-substring
  scan\`)
- Stale-comment deletion that records "the previous comment was wrong"
- Dogfood records of agent behavior that generalizes beyond one
  session (\`AI consistently misclassifies X as Y when ...\`)

This tool MUST NOT be used for:
- Proposing a fix for the observation — observation and proposal are
  separate edits. If you want to record both ("X is broken, we should
  do Y about it"), write the observation here and a paired
  \`edit_proposal\` for the fix
- Writing an observation as a decision ("we will not use X because of
  this") — that is \`edit_decision\`
- Implementing a detector or check for the observed pattern — patch-
  content detection is out of scope per Article 7 / CLAUDE.md §3
- Editing executable code or tests — observation tools record
  observations; the kind-specific impl tool implements them
- Citing observations you did not actually make ("I observed that ..."
  with no concrete trace) — \`direct_observation\` provenance requires
  a visible observation source in the prose

Required tests: NONE. Observations are not executable; \`test_files\`
must be empty.

This tool does NOT carry a \`target\` field. The prod/test target flag
is required only on the 15 impl tools.

\`additional_files\` cardinality:
This tool rejects \`additional_files\` for \`user_confirmed\` and warns
for every other provenance value. Observations are usually per-place;
batching across files at observation time is usually two separate
findings fused. If the same observation truly applies across multiple
files (e.g., adding the same \`// XXX\` comment across a cluster of
modules that share an invariant), warn lets it land — but the rationale
MUST explicitly name the unifying theme. If the theme cannot be stated
in one sentence, split.

Rationale: observation is an act of generalization. A future session
encountering the observation file picks up the lesson without retracing
the discovery. Mixing observation with proposal / decision erodes the
file's value as a lesson archive.

escaping a repeating_failure spiral:
This is the tool to reach for first when you have noticed you are
repeating the same class of failure. Record the reproduction
conditions, the recent changes, and the competing hypotheses as
separate items, and verify your assumptions against primary sources
(official documentation, the actual source, execution logs) before
forming the next hypothesis. Declare this edit with
provenance: direct_observation — the reproduction conditions and
recent changes are directly observed, and the hypotheses are framed
as hedged prose — so the escape stays in this tool's typical
provenance cell and does not trip a kind/provenance warning.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (edit_observation-specific):
The typical provenance is \`direct_observation\` (you observed the
gotcha while doing other work). \`inference\` is accepted but warns:
declaring "observation + inference" usually means you are running an
inference about an observation, which is closer to \`edit_proposal\`.
Re-read the entry; if the body reads as "this is what I think, given
what I saw", route it through \`edit_proposal\` instead.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_proposal: `Raise a proposal, question, or open issue — content meant to start
or continue a deliberation about what to do. The most common targets
are files under \`issues/\`, RFC drafts under \`docs/plan/\`, ADR
drafts, and code comments that open a question (\`// TODO ...\`,
\`// FIXME ...\`).

Use this tool when, and ONLY when, the entry is one of the following:
- "Should we adopt X?" — raising a question the user / project owner
  has not yet answered
- Drafting an issue, RFC, or ADR that proposes a change but is not yet
  approved
- Adding a code comment that opens an open question (\`// TODO: revisit
  after Y\`, \`// FIXME: this assumes Z\`)
- Recording a course of action you are weighing, where the choice is
  still open

This tool MUST NOT be used for:
- Recording a decision that has already been made — that is
  \`edit_decision\`. A proposal becomes a decision only after the user
  (or the relevant decision authority) confirms it
- Implementing the proposed change in the same edit — implementation
  belongs to the kind-specific impl tool, separately, and only after
  the proposal is accepted
- Writing a proposal as if it were already approved (\`We will adopt
  X\`) — proposals describe options under consideration, not
  commitments
- Fabricating user consent (\`As the user agreed ...\` without a
  verbatim user statement to point to) — \`user_confirmed\` provenance
  requires actual user confirmation, not a guess about what the user
  would have agreed to

Required tests: NONE. Proposals are not executable; \`test_files\`
must be empty.

This tool does NOT carry a \`target\` field. The prod/test target flag
is required only on the 15 impl tools.

\`additional_files\` cardinality:
This tool accepts \`additional_files\` for \`accepted_artifact\` and
\`speculation\` (the typical proposal-burst patterns: a feature-kickoff
exploratory burst of issue stubs, or an artifact-driven sweep of
follow-up issues from an audit document) and warns for the other three
provenance values. When \`additional_files\` is used, the rationale
MUST name the unifying theme. If the theme cannot be stated in one
sentence, split the declaration.

Rationale: proposals model the open question. Conflating proposal with
decision erodes the agent's ability to tell, on a re-read, what has
been accepted vs. what is still being weighed.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (edit_proposal-specific):
The typical provenance is \`speculation\` (the proposal is exploratory
by nature). All five values are accepted. When provenance is
\`speculation\`, the prose obligation is especially strict — open with
strong hedging (\`**Unverified**:\`, \`**Hypothesis**:\`, \`TODO:
verify — ...\`) so future readers do not pick up the proposal as a
decision.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_decision: `Record a decision that has already been made. The most common
targets are accepted ADRs, CHANGELOG entries for releases that this
commit actually cuts, and IMPLEMENTATION-LOG entries that capture a
confirmed direction.

Use this tool when, and ONLY when, the entry is one of the following:
- "Decided to adopt X" — recording a direction after the user (or the
  relevant decision authority) has confirmed it
- Promoting an accepted proposal: the proposal lives under
  \`edit_proposal\`; the confirmation that the proposal is accepted
  lives under \`edit_decision\`
- CHANGELOG entries for a release that this commit produces
- Release commit batches that update CHANGELOG + version + plugin
  manifests in one place (use \`additional_files\` for the batch)

This tool MUST NOT be used for:
- Recording a proposal that has not yet been confirmed — that is
  \`edit_proposal\`. Decision presumes confirmation
- Writing inferences or hypotheses as decisions — declaring
  \`inference\` or \`speculation\` here is rejected (\`inference\` /
  \`speculation\` decisions are a contradiction in terms; re-route to
  \`edit_proposal\` until confirmation lands)
- Fabricating user consent — \`user_confirmed\` provenance requires
  actual user confirmation, with the confirming statement quoted or
  summarized in the rationale
- Editing executable code or tests — decisions are recorded; the
  kind-specific impl tool implements them
- Editing build / CI / meta-edit configuration that itself encodes a
  policy decision — that is \`edit_policy_change\`, which keeps the
  governance surface visible

Required tests: NONE. Decision records are not executable;
\`test_files\` must be empty.

This tool does NOT carry a \`target\` field. The prod/test target flag
is required only on the 15 impl tools.

\`additional_files\` cardinality:
This tool accepts \`additional_files\` for \`user_confirmed\` and
\`accepted_artifact\` (the typical release-commit and spec-driven
batch patterns) and warns for \`direct_observation\`. The
\`inference\` and \`speculation\` cells are unreachable because the
declaration itself is rejected at the (kind, provenance) level. Where
the batch is accepted, the rationale SHOULD still name the unifying
theme; where it is warned, the rationale MUST name the theme.

Rationale: decisions are the records future sessions read as
\`already settled.\` Conflating decision with inference or
speculation produces the exact "past-chat looks like a confirmed
decision" failure this refactor is meant to prevent.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (edit_decision-specific):
This tool rejects \`inference\` and \`speculation\`. The typical
provenance is \`user_confirmed\` (decisions are made by the user /
decision authority). \`accepted_artifact\` is accepted when the
decision is the codification of a previously-accepted artifact (an
ADR that this entry promotes from draft to accepted). When
provenance is \`direct_observation\`, that usually means the
"decision" is closer to an observation — re-classify if the prose
reads as observation rather than as a commitment.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_explanation: `Explain or document known facts for a reader. The most common
targets are README files (and their translations), docs/, JSDoc /
docstrings, API documentation, and code comments whose purpose is to
explain how a thing works (\`/** function does X */\`).

Use this tool when, and ONLY when, the entry is one of the following:
- Reader-facing explanation of a shipped feature, function, or
  behavior
- Filling out a docs/ surface with material from an accepted spec /
  ADR / API contract
- Adding or updating a JSDoc / docstring that documents an existing
  API contract
- Synchronizing translations of an explanation across multiple
  README files (use \`additional_files\` for the batch)
- Reformulating an existing explanation to be clearer — but only
  when the information content remains the same; if the explanation
  is revised to say something different, the underlying fact must
  already be true and accepted

This tool MUST NOT be used for:
- Describing future or aspirational behavior (\`This will ...\` for a
  feature that has not shipped) — that is \`edit_proposal\` until the
  behavior actually ships, then \`edit_explanation\` afterwards
- Promoting an unverified hypothesis to an explanation — declaring
  \`speculation\` here is rejected. Explanation is a contract with
  future readers; speculative explanations mislead more than they
  clarify
- Documenting an API contract change as if it were always documented
  this way — the contract change is \`edit_api_contract\`; the
  reader-facing doc that catches up is \`edit_explanation\`
- Editing executable code or tests — explanation tools record what
  the code already does; the kind-specific impl tool changes
  behavior
- Updating a CHANGELOG entry for a release that this commit does not
  actually cut — CHANGELOG entries for cut releases are
  \`edit_decision\`; queued / unreleased entries do not belong in
  CHANGELOG yet
- Batching unrelated explanations across multiple files in one
  declaration — each independent doc surface gets its own
  \`edit_explanation\` call unless the files share a single
  originating theme (the typical accepted batch is multilingual
  README sync)

Required tests: NONE. Explanations are not executable; \`test_files\`
must be empty.

This tool does NOT carry a \`target\` field. The prod/test target flag
is required only on the 15 impl tools.

\`additional_files\` cardinality:
This tool accepts \`additional_files\` for \`user_confirmed\`,
\`accepted_artifact\`, and \`direct_observation\` (the typical
multilingual-sync and spec-sweep patterns) and warns for
\`inference\`. The \`speculation\` cell is unreachable because the
declaration itself is rejected at the (kind, provenance) level. Where
the batch is accepted, the rationale SHOULD name the unifying theme;
where it is warned, the rationale MUST name the theme.

Recommended verifications (not enforced):
- Internal links resolve
- Code blocks (if any) are syntactically valid in their stated
  language
- Terminology is consistent with the rest of the project documentation
- No accidental references to renamed APIs or removed features

Rationale: explanation is a contract with future readers (AI and
human). A reader-facing explanation that mixes confirmed facts with
unverified speculation poisons every later citation that depends on
it.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (edit_explanation-specific):
This tool rejects \`speculation\`. The typical provenance is
\`accepted_artifact\` (the explanation is derived from an accepted
spec, ADR, or API contract; quote the artifact in the rationale and,
where natural, in the prose). \`inference\` is accepted but warns:
explanations sourced from inference are usually better when re-sourced
from an accepted artifact, since the explanation outlives the inference
that produced it.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`
};

// src/state/protected-paths.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";

// src/utils/realpath.ts
import * as fs from "node:fs";
import * as path from "node:path";
function realpathOfDeepestExisting(p) {
  let cur = p;
  const tail = [];
  while (true) {
    try {
      const real = fs.realpathSync(cur);
      if (tail.length === 0) {
        return real;
      }
      return path.join(real, ...tail.reverse());
    } catch (e) {
      const code = e?.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        const parent = path.dirname(cur);
        if (parent === cur) {
          return p;
        }
        tail.push(path.basename(cur));
        cur = parent;
        continue;
      }
      return null;
    }
  }
}
function canonicalDirRealpath(p) {
  let cur = path.dirname(p);
  const tail = [path.basename(p)];
  while (true) {
    let st = null;
    try {
      st = fs.statSync(cur);
    } catch (e) {
      const code = e?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        return null;
      }
      st = null;
    }
    if (st !== null && st.isDirectory()) {
      let real;
      try {
        real = fs.realpathSync(cur);
      } catch (e) {
        const code = e?.code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          real = "";
        } else {
          return null;
        }
      }
      if (real !== "") {
        return path.join(real, ...[...tail].reverse());
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) {
      return path.join(cur, ...[...tail].reverse());
    }
    tail.push(path.basename(cur));
    cur = parent;
  }
}

// src/state/protected-paths.ts
var PROTECTED_PREFIXES = [
  ".meta-edit/state/",
  ".meta-edit/tmp/"
];
function normalizeRepoRelative(p) {
  if (p.includes("\x00")) {
    throw new Error("path contains NUL byte");
  }
  let n = p.replace(/\\/g, "/");
  while (n.startsWith("./")) {
    n = n.slice(2);
  }
  while (n.startsWith("/")) {
    n = n.slice(1);
  }
  return n.replace(/\/+/g, "/");
}
var CASE_INSENSITIVE_FS = process.platform === "darwin" || process.platform === "win32";
function matchesProtectedPrefix(norm) {
  const folded = CASE_INSENSITIVE_FS ? norm.toLowerCase() : null;
  return PROTECTED_PREFIXES.some((prefix) => {
    const dir = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    if (norm.startsWith(prefix) || norm === dir) {
      return true;
    }
    if (folded !== null && (folded.startsWith(prefix) || folded === dir)) {
      return true;
    }
    return false;
  });
}
function isProtectedPath(p, options = {}) {
  let norm;
  try {
    norm = normalizeRepoRelative(p);
  } catch {
    return true;
  }
  if (matchesProtectedPrefix(norm)) {
    return true;
  }
  const repoRoot = options.repoRoot;
  if (repoRoot && !path2.isAbsolute(p)) {
    try {
      const absInput = path2.resolve(repoRoot, norm);
      const realResolved = realpathOfDeepestExisting(absInput);
      if (realResolved === null) {
        return false;
      }
      let realRoot;
      try {
        realRoot = fs2.realpathSync(repoRoot);
      } catch {
        realRoot = path2.resolve(repoRoot);
      }
      if (realResolved === realRoot || realResolved.startsWith(realRoot + path2.sep)) {
        const canonicalRel = normalizeRepoRelative(path2.relative(realRoot, realResolved));
        if (matchesProtectedPrefix(canonicalRel)) {
          return true;
        }
      }
    } catch {}
  }
  return false;
}

// src/utils/repo-paths.ts
import * as fs3 from "node:fs";
import * as path3 from "node:path";
function discoverRepoRoot(start) {
  let dir = path3.resolve(start);
  let found = null;
  for (;; ) {
    if (fs3.existsSync(path3.join(dir, ".git")) || fs3.existsSync(path3.join(dir, ".jj"))) {
      found = dir;
      break;
    }
    const parent = path3.dirname(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  const base = found ?? path3.resolve(start);
  return realpathOfDeepestExisting(base) ?? path3.resolve(base);
}
function resolveRepoRoot(primary) {
  if (typeof primary === "string" && primary.length > 0) {
    return discoverRepoRoot(primary);
  }
  const envRoot = process.env["META_EDIT_REPO_ROOT"];
  if (typeof envRoot === "string" && envRoot.length > 0) {
    return discoverRepoRoot(envRoot);
  }
  return discoverRepoRoot(process.cwd());
}
function canonicalizeRepoRelative(inputPath, repoRoot) {
  const resolved = path3.isAbsolute(inputPath) ? path3.normalize(inputPath) : path3.resolve(repoRoot, inputPath);
  const realRoot = realpathOfDeepestExisting(path3.resolve(repoRoot)) ?? path3.resolve(repoRoot);
  const realResolved = canonicalDirRealpath(resolved);
  if (realResolved === null) {
    return {
      ok: false,
      code: "uncanonicalizable",
      error: `path "${inputPath}" could not be canonicalized via realpath; failing closed`
    };
  }
  if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path3.sep)) {
    return {
      ok: false,
      code: "escapes",
      error: `path "${inputPath}" escapes repository root after symlink resolution`
    };
  }
  let rel;
  try {
    rel = normalizeRepoRelative(path3.relative(realRoot, realResolved));
  } catch (e) {
    return {
      ok: false,
      code: "uncanonicalizable",
      error: `path "${inputPath}" is invalid: ${e.message}`
    };
  }
  if (rel.length === 0) {
    return {
      ok: false,
      code: "is_root",
      error: `path "${inputPath}" resolves to the repository root`
    };
  }
  return { ok: true, canonical: rel };
}

// src/tools/repo-validity.ts
import * as fs4 from "node:fs";
import * as path4 from "node:path";
function repoIsValid(dir) {
  const sentinels = [".git", ".jj"];
  const found = sentinels.some((s) => fs4.existsSync(path4.join(dir, s)));
  if (found)
    return { ok: true };
  return {
    ok: false,
    error: `meta-edit: "${dir}" does not appear to be a repository root ` + `(no .git or .jj directory found). ` + `Run \`git init\` in this directory, or restart the MCP server ` + `with \`meta-edit serve --repo-root <path>\` (or set the ` + `META_EDIT_REPO_ROOT environment variable) pointed at the ` + `actual repository root.`
  };
}

// src/tools/common.ts
var RiskLevelSchema = exports_external.enum(["low", "medium", "high", "critical"]);
var EditTargetSchema = exports_external.enum(["prod", "test"]);
var ProvenanceSchema = exports_external.enum([
  "user_confirmed",
  "accepted_artifact",
  "direct_observation",
  "inference",
  "speculation"
]);
var ExecutionStateSchema = exports_external.enum([
  "normal",
  "repeating_failure",
  "recovery"
]);
var AdditionalFileSchema = exports_external.object({
  file: exports_external.string().min(1)
}).strict();
var MAX_ADDITIONAL_FILES = 32;
var TOOLS_ACCEPTING_ADDITIONAL_FILES = WORKFLOW_TOOLS;
function evaluateKindProvenanceValidity(kind, provenance) {
  if (kind === "edit_cosmetic") {
    if (provenance === "inference" || provenance === "speculation") {
      return "reject";
    }
    return "accept";
  }
  if (kind === "edit_decision") {
    if (provenance === "inference" || provenance === "speculation") {
      return "reject";
    }
    return "accept";
  }
  if (kind === "edit_policy_change") {
    if (provenance === "inference" || provenance === "speculation") {
      return "reject";
    }
    return "accept";
  }
  if (kind === "edit_explanation") {
    if (provenance === "speculation")
      return "reject";
    if (provenance === "inference")
      return "warn";
    return "accept";
  }
  if (kind === "edit_observation") {
    if (provenance === "inference")
      return "warn";
    return "accept";
  }
  return "accept";
}
function evaluateAdditionalFiles(kind, provenance) {
  if (kind === "edit_progress")
    return "reject";
  if (kind === "edit_observation") {
    if (provenance === "user_confirmed")
      return "reject";
    return "warn";
  }
  if (kind === "edit_proposal") {
    if (provenance === "accepted_artifact")
      return "accept";
    if (provenance === "speculation")
      return "accept";
    return "warn";
  }
  if (kind === "edit_decision") {
    if (provenance === "user_confirmed")
      return "accept";
    if (provenance === "accepted_artifact")
      return "accept";
    if (provenance === "direct_observation")
      return "warn";
    return "reject";
  }
  if (kind === "edit_explanation") {
    if (provenance === "user_confirmed")
      return "accept";
    if (provenance === "accepted_artifact")
      return "accept";
    if (provenance === "direct_observation")
      return "accept";
    if (provenance === "inference")
      return "warn";
    return "reject";
  }
  if (kind === "edit_policy_change") {
    if (provenance === "user_confirmed")
      return "accept";
    if (provenance === "accepted_artifact")
      return "accept";
    if (provenance === "direct_observation")
      return "warn";
    return "reject";
  }
  return "reject";
}
function evaluateKindExecutionStateValidity(kind, executionState) {
  if (executionState === "repeating_failure" && TOOLS_REQUIRING_TARGET.includes(kind)) {
    return "warn";
  }
  return "accept";
}
function evaluateTargetSpecDerivation(kind, target, provenance) {
  if (target === "prod")
    return "accept";
  if (kind === "edit_cosmetic")
    return "accept";
  if (provenance === "inference" || provenance === "speculation") {
    return "reject";
  }
  if (provenance === "direct_observation")
    return "warn";
  return "accept";
}
var ARTIFACT_CITATION_RE = new RegExp([
  "§",
  "\\bADR-\\w",
  "\\bRFC-\\w",
  "\\bissues/",
  "https?://"
].join("|"));
function rationaleHasArtifactCitation(rationale) {
  return ARTIFACT_CITATION_RE.test(rationale);
}
function coerceJsonStringToArray(fieldName) {
  return (v) => {
    if (typeof v !== "string")
      return v;
    let parsed;
    try {
      parsed = JSON.parse(v);
    } catch {
      return v;
    }
    if (!Array.isArray(parsed))
      return v;
    process.stderr.write(`[meta-edit] WARN: coerced ${fieldName} JSON-string to array (opencode harness mis-marshaling); ` + `see issues/2026-05-04-1700-opencode-empty-test-files-array-mismarshalled.md
`);
    return parsed;
  };
}
var EditToolRequestSchema = exports_external.object({
  target_file: exports_external.string().min(1),
  rationale: exports_external.string(),
  risk_level: RiskLevelSchema,
  target: EditTargetSchema.optional(),
  provenance: ProvenanceSchema,
  execution_state: ExecutionStateSchema,
  test_files: exports_external.preprocess(coerceJsonStringToArray("test_files"), exports_external.array(exports_external.string())),
  additional_files: exports_external.preprocess(coerceJsonStringToArray("additional_files"), exports_external.array(AdditionalFileSchema).max(MAX_ADDITIONAL_FILES)).optional()
}).strict();
var HIGH_IMPACT_KINDS = [
  "edit_policy_change",
  "edit_db_schema",
  "edit_data_migration",
  "edit_api_contract",
  "edit_permission_logic",
  "edit_dependency_config",
  "edit_concurrency",
  "edit_external_side_effect",
  "edit_cache_invalidation",
  "edit_retry_timeout"
];
function sha256Hex(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}
var SHA256_EMPTY = sha256Hex("");
function validateRequest(toolName, request, ctx) {
  const warnings = [];
  const auditWarnings = [];
  const repoCheck = repoIsValid(ctx.repoRoot);
  if (!repoCheck.ok) {
    return { ok: false, warnings: [repoCheck.error] };
  }
  if (request.rationale.trim().length === 0) {
    warnings.push("rationale must be non-empty");
  }
  const kpVerdict = evaluateKindProvenanceValidity(toolName, request.provenance);
  if (kpVerdict === "reject") {
    warnings.push(`(kind=${toolName}, provenance=${request.provenance}) is rejected per ` + `SPEC §3.3.1 / §3.3.3. Reclassify the edit: pick a kind whose ` + `semantics permit this epistemic source, or pick a provenance ` + `whose certainty matches this kind.`);
  } else if (kpVerdict === "warn") {
    auditWarnings.push({
      code: "kind_provenance_warn",
      message: `(kind=${toolName}, provenance=${request.provenance}) is atypical ` + `per SPEC §3.3.1. Land but consider whether the intent is closer ` + `to a different workflow kind.`
    });
  }
  if (request.provenance === "accepted_artifact" && !rationaleHasArtifactCitation(request.rationale)) {
    auditWarnings.push({
      code: "citation_lint_missing",
      message: `provenance="accepted_artifact" but the rationale has no ` + `recognizable artifact reference (\`§...\`, \`ADR-...\`, ` + `\`RFC-...\`, \`issues/...\`, or a URL). Add a citation so ` + `future readers can re-source the artifact.`
    });
  }
  if (evaluateKindExecutionStateValidity(toolName, request.execution_state) === "warn") {
    auditWarnings.push({
      code: "execution_state_repeating_failure",
      message: `execution_state="repeating_failure" was declared on ${toolName}, ` + `an implementation fix attempt. This is a self-flagged loop signal, ` + `not a mismatch — group it by code, separate from §3.3 warnings. ` + `The escape move is edit_observation or edit_proposal: record the ` + `failure (reproduction conditions, recent changes, hypotheses) ` + `before stacking another fix.`
    });
  }
  if (HIGH_IMPACT_KINDS.includes(toolName)) {
    auditWarnings.push({
      code: "high_impact_kind_warn",
      message: `kind=${toolName} is high-impact: the warn is unconditional so ` + `every declaration of this kind surfaces in audit summaries for ` + `separate review. No action required; the declaration lands ` + `(this signal does not block). Re-read the rationale, the ` + `obligation footer, and any LOOSEN-restriction implications ` + `once before the paired hook applies the patch.`
    });
  }
  if (TOOLS_REQUIRING_TARGET.includes(toolName) && request.target !== undefined) {
    const tsVerdict = evaluateTargetSpecDerivation(toolName, request.target, request.provenance);
    if (tsVerdict === "reject") {
      warnings.push(`(kind=${toolName}, target="${request.target}", provenance=` + `${request.provenance}) is rejected per SPEC §3.3.5. A test ` + `declared with inferred or speculative provenance cannot pin ` + `spec-defined behavior. If the spec is unclear, stop and ask ` + `which document defines the behavior the test should pin.`);
    } else if (tsVerdict === "warn") {
      auditWarnings.push({
        code: "target_spec_derivation_warn",
        message: `target="${request.target}" with provenance=` + `"${request.provenance}" usually means the test pins ` + `implementation-observed behavior, not spec-defined behavior ` + `(SPEC §3.3.5 impl-mirror smell). If the observation source ` + `is an external system (e.g. third-party API contract under ` + `test as regression), make the externality visible in the ` + `rationale. Otherwise re-classify provenance to ` + `accepted_artifact or user_confirmed citing the spec the ` + `test pins.`
      });
    }
  }
  const toolRequiresTarget = TOOLS_REQUIRING_TARGET.includes(toolName);
  if (toolRequiresTarget) {
    if (request.target === undefined) {
      warnings.push(`target must be declared as "prod" or "test" for ${toolName}`);
    }
  } else {
    if (request.target !== undefined) {
      warnings.push(`${toolName} does not accept a target field (prod/test split does ` + `not apply to this workflow tool)`);
    }
  }
  if (request.target === "test") {
    if (request.test_files.length > 0) {
      warnings.push(`test_files must be empty when target is "test" (target_file IS the test file)`);
    }
  } else if (request.target === "prod" && TOOLS_REQUIRING_TEST_FILES.includes(toolName)) {
    if (request.test_files.length === 0) {
      warnings.push(`test_files must be non-empty for ${toolName} with target "prod"`);
    }
  } else if (toolName === "edit_cosmetic") {
    if (request.test_files.length > 0) {
      warnings.push(`test_files must be empty for ${toolName} (cosmetic edits carry ` + `no test obligation — Required tests: NONE regardless of target)`);
    }
  } else if (WORKFLOW_TOOLS.includes(toolName)) {
    if (request.test_files.length > 0) {
      warnings.push(`test_files must be empty for ${toolName} (workflow-axis kinds ` + `carry no executable behavior — Required tests: NONE per the ` + `tool description)`);
    }
  }
  if (request.additional_files !== undefined) {
    if (!TOOLS_ACCEPTING_ADDITIONAL_FILES.includes(toolName)) {
      warnings.push(`${toolName} does not accept additional_files; this field is reserved ` + `for the workflow-axis kinds (edit_observation, edit_proposal, ` + `edit_decision, edit_explanation, edit_policy_change; ` + `edit_progress always rejects). ` + `Submit each file as its own typed_edit call.`);
    } else {
      const afVerdict = evaluateAdditionalFiles(toolName, request.provenance);
      if (afVerdict === "reject") {
        warnings.push(`(kind=${toolName}, provenance=${request.provenance}) does not ` + `accept additional_files per SPEC §3.3.2. Split the declaration: ` + `submit each file as its own typed_edit call, or pick a ` + `(kind, provenance) cell that accepts batching.`);
      } else if (afVerdict === "warn") {
        auditWarnings.push({
          code: "additional_files_warn",
          message: `additional_files batch under (kind=${toolName}, ` + `provenance=${request.provenance}) is atypical per SPEC §3.3.2. ` + `Land but consider splitting if the unifying theme is thin. ` + `The rationale MUST name the theme explicitly.`
        });
      }
    }
  }
  for (const tf of request.test_files) {
    const c = checkPathSafety(tf, ctx.repoRoot);
    if (!c.ok) {
      warnings.push(`test_files entry "${tf}": ${c.error}`);
    }
  }
  const targetCheck = checkPathSafety(request.target_file, ctx.repoRoot);
  let primaryBinding = null;
  if (!targetCheck.ok) {
    warnings.push(`target_file: ${targetCheck.error}`);
  } else {
    const beforeRead = computeBeforeSha256(targetCheck.canonical, ctx.repoRoot, "target_file");
    if (!beforeRead.ok) {
      warnings.push(beforeRead.error);
    } else {
      primaryBinding = {
        canonical: targetCheck.canonical,
        before_sha256: beforeRead.before_sha256
      };
    }
  }
  const additionalBindings = [];
  if (request.additional_files !== undefined && TOOLS_ACCEPTING_ADDITIONAL_FILES.includes(toolName)) {
    const seenCanonicals = new Set;
    if (primaryBinding !== null) {
      seenCanonicals.add(primaryBinding.canonical);
    }
    for (const af of request.additional_files) {
      const safe = checkPathSafety(af.file, ctx.repoRoot);
      if (!safe.ok) {
        warnings.push(`additional_files entry "${af.file}": ${safe.error}`);
        continue;
      }
      if (seenCanonicals.has(safe.canonical)) {
        warnings.push(`additional_files contains duplicate file "${safe.canonical}"; ` + `each binding must be unique within a single declaration.`);
        continue;
      }
      seenCanonicals.add(safe.canonical);
      const beforeRead = computeBeforeSha256(safe.canonical, ctx.repoRoot, `additional_files entry "${af.file}"`);
      if (!beforeRead.ok) {
        warnings.push(beforeRead.error);
        continue;
      }
      additionalBindings.push({
        canonical: safe.canonical,
        before_sha256: beforeRead.before_sha256
      });
    }
  }
  if (warnings.length > 0 || primaryBinding === null) {
    return { ok: false, warnings };
  }
  return { ok: true, primaryBinding, additionalBindings, auditWarnings };
}
function checkPathSafety(p, repoRoot) {
  if (path5.isAbsolute(p)) {
    return {
      ok: false,
      error: `path "${p}" is absolute; must be repository-relative`
    };
  }
  if (containsParentTraversal(p)) {
    return {
      ok: false,
      error: `path "${p}" contains a ".." traversal segment; pass an already-canonical repository-relative path so the resolved target is unambiguous`
    };
  }
  const res = canonicalizeRepoRelative(p, repoRoot);
  if (!res.ok) {
    if (res.code === "escapes") {
      return { ok: false, error: `path "${p}" escapes repository root` };
    }
    if (res.code === "is_root") {
      return {
        ok: false,
        error: `path "${p}" resolves to the repository root`
      };
    }
    return {
      ok: false,
      error: `path "${p}" could not be canonicalized via realpath; failing closed`
    };
  }
  const absInput = path5.resolve(repoRoot, p);
  try {
    const lst = fs5.lstatSync(absInput);
    if (lst.isSymbolicLink()) {
      const linkTarget = fs5.readlinkSync(absInput);
      const resolvedTarget = path5.resolve(path5.dirname(absInput), linkTarget);
      const targetRel = path5.relative(repoRoot, resolvedTarget);
      if (isProtectedPath(targetRel, { repoRoot })) {
        return {
          ok: false,
          error: `path "${p}" resolves into a protected directory (.meta-edit/state/ or .meta-edit/tmp/)`
        };
      }
    }
  } catch (e) {}
  if (isProtectedPath(res.canonical, { repoRoot })) {
    return {
      ok: false,
      error: `path "${p}" resolves into a protected directory (.meta-edit/state/ or .meta-edit/tmp/)`
    };
  }
  return { ok: true, canonical: res.canonical };
}
function containsParentTraversal(p) {
  for (const seg of p.split(/[\\/]/)) {
    if (seg === "..")
      return true;
  }
  return false;
}
function computeBeforeSha256(canonical, repoRoot, fieldLabel) {
  const absolute = path5.join(repoRoot, canonical);
  let onDisk = null;
  try {
    onDisk = fs5.readFileSync(absolute, "utf8");
  } catch (e) {
    const code = e?.code;
    if (code === "ENOENT") {
      return { ok: true, before_sha256: SHA256_EMPTY };
    }
    return {
      ok: false,
      error: `${fieldLabel} "${canonical}": failed to read disk content for sha256 computation (${code ?? "ERR"})`
    };
  }
  return { ok: true, before_sha256: sha256Hex(onDisk) };
}
function makeStubHandler(ctx) {
  return async (toolName, args) => {
    const result = validateRequest(toolName, args, ctx);
    if (!result.ok) {
      return {
        token: "",
        expires_at: "",
        edit_id: "edit_00000000_0000",
        warnings: result.warnings
      };
    }
    return {
      token: "",
      expires_at: "",
      edit_id: "edit_00000000_0000",
      warnings: [
        `${toolName}: validation passed; stub handler does not issue tokens`
      ]
    };
  };
}

// src/state/edit-log.ts
var BindingEntrySchema = exports_external.object({
  file: exports_external.string(),
  before_sha256: exports_external.string()
});
var AuditWarningEntrySchema = exports_external.object({
  code: exports_external.enum([
    "kind_provenance_warn",
    "additional_files_warn",
    "citation_lint_missing",
    "execution_state_repeating_failure",
    "target_spec_derivation_warn",
    "high_impact_kind_warn"
  ]),
  message: exports_external.string()
});
var IssuedEntrySchema = exports_external.object({
  edit_id: exports_external.string(),
  ts: exports_external.string(),
  phase: exports_external.literal("issued"),
  kind: exports_external.string(),
  target_file: exports_external.string(),
  rationale: exports_external.string(),
  risk_level: RiskLevelSchema,
  target: EditTargetSchema.optional(),
  provenance: ProvenanceSchema.optional(),
  execution_state: ExecutionStateSchema.optional(),
  audit_warnings: exports_external.array(AuditWarningEntrySchema).optional(),
  test_files: exports_external.array(exports_external.string()),
  binding: exports_external.array(BindingEntrySchema).min(1),
  token: exports_external.string()
});
var ConsumedEntrySchema = exports_external.object({
  edit_id: exports_external.string(),
  ts: exports_external.string(),
  phase: exports_external.literal("consumed"),
  consuming_tool: exports_external.string()
});
var RejectedEntrySchema = exports_external.object({
  edit_id: exports_external.string(),
  ts: exports_external.string(),
  phase: exports_external.literal("rejected"),
  kind: exports_external.string(),
  target_file: exports_external.string(),
  target: EditTargetSchema.optional(),
  provenance: ProvenanceSchema.optional(),
  execution_state: ExecutionStateSchema.optional(),
  audit_error: exports_external.string().min(1)
});
var EditLogEntrySchema = exports_external.discriminatedUnion("phase", [
  IssuedEntrySchema,
  ConsumedEntrySchema,
  RejectedEntrySchema
]);
var EDIT_ID_RE = /^edit_(\d{8})_(\d{4,})$/;

class EditLog {
  statePath;
  logPath;
  todayKey = null;
  todayCounter = 0;
  constructor(repoRoot) {
    this.statePath = path6.join(repoRoot, ".meta-edit", "state");
    this.logPath = path6.join(this.statePath, "edits.jsonl");
  }
  get filePath() {
    return this.logPath;
  }
  nextEditId(now = new Date) {
    const key = formatDayKey(now);
    if (this.todayKey !== key) {
      this.todayKey = key;
      this.todayCounter = 0;
    }
    this.ensureStateDir();
    return this.withFileLock(() => {
      const onDiskLog = this.scanMaxCounterForKey(key);
      const onDiskCounter = this.readCounterFile(key);
      const base = Math.max(this.todayCounter, onDiskLog, onDiskCounter);
      this.todayCounter = base + 1;
      this.writeCounterFile(key, this.todayCounter);
      const nnnn = String(this.todayCounter).padStart(4, "0");
      return `edit_${key}_${nnnn}`;
    });
  }
  nextRejectId(now = new Date) {
    const key = formatDayKey(now);
    const rand = crypto2.randomBytes(4).toString("hex");
    return `reject_${key}_${rand}`;
  }
  appendIssued(entry) {
    const validated = IssuedEntrySchema.parse(entry);
    this.appendRaw(validated);
  }
  appendConsumed(entry) {
    const validated = ConsumedEntrySchema.parse(entry);
    this.appendRaw(validated);
  }
  appendRejected(entry) {
    const validated = RejectedEntrySchema.parse(entry);
    this.appendRaw(validated);
  }
  append(entry) {
    const validated = EditLogEntrySchema.parse(entry);
    this.appendRaw(validated);
  }
  appendRaw(entry) {
    this.ensureStateDir();
    ensureNoSymlinkOnPath(this.statePath);
    const line = JSON.stringify(entry) + `
`;
    const O_NOFOLLOW = fs6.constants.O_NOFOLLOW;
    if (typeof O_NOFOLLOW !== "number" || O_NOFOLLOW === 0) {
      throw new Error("this platform does not expose O_NOFOLLOW; meta-edit refuses to append to the edit log without symlink-leaf protection");
    }
    this.withFileLock(() => {
      let fd = null;
      try {
        fd = fs6.openSync(this.logPath, fs6.constants.O_WRONLY | fs6.constants.O_APPEND | fs6.constants.O_CREAT | O_NOFOLLOW, 384);
        fs6.writeSync(fd, line, null, "utf8");
      } finally {
        if (fd !== null) {
          try {
            fs6.closeSync(fd);
          } catch {}
        }
      }
    });
  }
  ensureStateDir() {
    ensureNoSymlinkOnPath(this.statePath);
    fs6.mkdirSync(this.statePath, { recursive: true, mode: 448 });
    if (process.platform !== "win32") {
      fs6.chmodSync(this.statePath, 448);
    }
  }
  withFileLock(fn) {
    const lockPath = path6.join(this.statePath, ".lock");
    const start = Date.now();
    const TIMEOUT_MS = 30000;
    while (true) {
      try {
        fs6.mkdirSync(lockPath);
        break;
      } catch (e) {
        const code = e.code;
        if (code !== "EEXIST")
          throw e;
        if (Date.now() - start > TIMEOUT_MS) {
          throw new Error(`meta-edit: timed out waiting for edit-log lock at ${lockPath}; ` + `if no other meta-edit process is running, remove this directory manually.`);
        }
        const until = Date.now() + 2 + Math.floor(Math.random() * 3);
        while (Date.now() < until) {}
      }
    }
    try {
      return fn();
    } finally {
      try {
        fs6.rmdirSync(lockPath);
      } catch {}
    }
  }
  readCounterFile(key) {
    const counterPath = path6.join(this.statePath, "counter.json");
    let text;
    try {
      text = fs6.readFileSync(counterPath, "utf8");
    } catch (e) {
      const code = e.code;
      if (code === "ENOENT")
        return 0;
      throw e;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return 0;
    }
    if (typeof parsed === "object" && parsed !== null && key in parsed) {
      const v = parsed[key];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        return Math.floor(v);
      }
    }
    return 0;
  }
  writeCounterFile(key, value) {
    const counterPath = path6.join(this.statePath, "counter.json");
    const payload = JSON.stringify({ [key]: value });
    try {
      const lst = fs6.lstatSync(counterPath);
      if (lst.isSymbolicLink()) {
        throw new Error(`refusing to use edit-log path: "${counterPath}" is a symlink. The audit-log counter must not be redirected through a symlink.`);
      }
    } catch (e) {
      const code = e.code;
      if (code !== "ENOENT")
        throw e;
    }
    const O_NOFOLLOW = fs6.constants.O_NOFOLLOW;
    if (typeof O_NOFOLLOW !== "number" || O_NOFOLLOW === 0) {
      throw new Error("this platform does not expose O_NOFOLLOW; meta-edit refuses to write the audit-log counter without symlink-leaf protection");
    }
    let fd = null;
    try {
      fd = fs6.openSync(counterPath, fs6.constants.O_WRONLY | fs6.constants.O_CREAT | fs6.constants.O_TRUNC | O_NOFOLLOW, 384);
      fs6.writeSync(fd, payload, null, "utf8");
    } finally {
      if (fd !== null) {
        try {
          fs6.closeSync(fd);
        } catch {}
      }
    }
  }
  readAll() {
    let text;
    try {
      text = fs6.readFileSync(this.logPath, "utf8");
    } catch (e) {
      if (e.code === "ENOENT")
        return [];
      throw e;
    }
    const out = [];
    for (const line of text.split(`
`)) {
      const trimmed = line.trim();
      if (trimmed.length === 0)
        continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const validated = EditLogEntrySchema.safeParse(parsed);
      if (validated.success) {
        out.push(validated.data);
      }
    }
    return out;
  }
  scanMaxCounterForKey(key) {
    let text;
    try {
      text = fs6.readFileSync(this.logPath, "utf8");
    } catch (e) {
      if (e.code === "ENOENT")
        return 0;
      throw e;
    }
    let max = 0;
    for (const line of text.split(`
`)) {
      const trimmed = line.trim();
      if (trimmed.length === 0)
        continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (typeof parsed === "object" && parsed !== null && "edit_id" in parsed && typeof parsed.edit_id === "string") {
        const m = EDIT_ID_RE.exec(parsed.edit_id);
        if (m && m[1] === key) {
          const n = Number.parseInt(m[2], 10);
          if (Number.isFinite(n) && n > max) {
            max = n;
          }
        }
      }
    }
    return max;
  }
}
function ensureNoSymlinkOnPath(maybeRelativeDir) {
  const absDir = path6.resolve(maybeRelativeDir);
  const segments = absDir.split(path6.sep).filter((s) => s.length > 0);
  let cur = path6.sep;
  for (const seg of segments) {
    cur = path6.join(cur, seg);
    let stat;
    try {
      stat = fs6.lstatSync(cur);
    } catch (e) {
      const code = e?.code;
      if (code === "ENOENT")
        return;
      throw e;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`refusing to use edit-log path: "${cur}" is a symlink. The audit log must not be redirected through a symlink.`);
    }
  }
}
function formatDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
function isoTimestamp(d = new Date) {
  const pad = (n) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const offAbs = Math.abs(offMin);
  const offH = pad(Math.floor(offAbs / 60));
  const offM = pad(offAbs % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` + `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` + `${sign}${offH}:${offM}`;
}

// src/hooks/raw-edit-policy.ts
var RAW_EDIT_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "apply_patch"
]);
var LOWER_RAW_EDIT_TOOLS = new Set([...RAW_EDIT_TOOLS].map((t) => t.toLowerCase()));
function evaluateRawEdit(toolName) {
  if (LOWER_RAW_EDIT_TOOLS.has(toolName.toLowerCase())) {
    return {
      decision: "deny",
      reason: `meta-edit reminder:

` + `I was about to edit through raw "${toolName}" without a meta-edit declaration.

` + `That would skip the intended classification step. The correct next move is to choose the typed edit tool that best describes this change, then perform the edit.

` + `If the typed_edit tool schemas are not loaded in my tool list, I should use ToolSearch (e.g. query \`mcp meta-edit edit\` or \`select:mcp__plugin_meta-edit_meta-edit__edit_cosmetic\`) to load the relevant schema before declaring.`
    };
  }
  return { decision: "allow" };
}
async function evaluateTokenedEdit(args) {
  const { toolName, toolInput, repoRoot, grants, log } = args;
  const nowFn = args.now ?? (() => new Date);
  const lcName = toolName.toLowerCase();
  if (!LOWER_RAW_EDIT_TOOLS.has(lcName)) {
    return {
      decision: "deny",
      reason: `deny-raw-edit invoked for non-raw tool "${toolName}"; check hook matcher`
    };
  }
  if (lcName === "apply_patch") {
    return {
      decision: "deny",
      reason: `meta-edit reminder:

` + `I was about to use "apply_patch", whose unified-diff input has no top-level file_path that the typed_edit declaration can bind against.

` + `The correct next move is to use the opencode \`edit\` or \`write\` tool (which DO carry file_path) after a typed_edit declaration, or to invoke a typed edit_* MCP tool directly.

` + `If the typed_edit tool schemas are not loaded in my tool list, I should use ToolSearch (e.g. query \`mcp meta-edit edit\` or \`select:mcp__plugin_meta-edit_meta-edit__edit_cosmetic\`) to load the relevant schema before declaring.`
    };
  }
  const pathField = lcName === "notebookedit" ? "notebook_path" : "file_path";
  const pathRaw = typeof toolInput[pathField] === "string" ? toolInput[pathField] : "";
  if (pathRaw.length === 0) {
    return {
      decision: "deny",
      reason: `${toolName} call missing "${pathField}"; the deny-raw-edit hook needs a file path to look up the active typed_edit declaration.`
    };
  }
  if (!isPathInsideRepo(pathRaw, repoRoot)) {
    return { decision: "allow" };
  }
  if (lcName === "write" && toolInput.content === "") {
    const absPath = path7.isAbsolute(pathRaw) ? pathRaw : path7.join(repoRoot, pathRaw);
    let exists = true;
    try {
      await fs7.stat(absPath);
    } catch (e) {
      if (e.code === "ENOENT") {
        exists = false;
      }
    }
    if (!exists) {
      try {
        await fs7.mkdir(path7.dirname(absPath), { recursive: true });
      } catch {}
      return {
        decision: "warn",
        reason: `meta-edit reminder:

` + "I created an empty file without a typed_edit declaration. " + `Empty creates are authorized, but the actual content fill is the part that should be classified.

` + "The next move is to declare an appropriate edit_<TYPE> for the content " + "(e.g. edit_state_transition / edit_boundary_condition for source code, " + "edit_explanation / edit_progress / edit_observation / edit_proposal / edit_decision " + "for Markdown / docs depending on intent, or the matching impl tool with " + 'target="test" for new test files), then perform the content write through the typed surface.'
      };
    }
  }
  const canonical = canonicalizeForBinding(pathRaw, repoRoot);
  if (canonical === null) {
    return {
      decision: "deny",
      reason: `[meta-edit:path-mismatch] could not canonicalize "${pathRaw}" to a repository-relative path under repoRoot="${repoRoot}"; failing closed.`
    };
  }
  const diskRead = await readFileForBinding(repoRoot, canonical);
  if (!diskRead.ok) {
    return {
      decision: "deny",
      reason: `[meta-edit:unreadable] could not read "${canonical}" to verify the typed_edit precondition (${diskRead.error}); ` + `failing closed — re-read the file and re-issue a typed_edit declaration.`
    };
  }
  const diskSha = sha256Hex2(diskRead.content);
  const match = await grants.findActiveBindingForFile(canonical, {
    preferBeforeSha: diskSha
  });
  if (match === null) {
    return {
      decision: "deny",
      reason: `meta-edit reminder:

` + `I was about to write "${canonical}" (repoRoot="${repoRoot}") but no active typed_edit declaration covers it.

` + `That would skip the intended classification step. The correct next move is to call a typed edit_* MCP tool first, then perform the write.

` + `If I DID declare it, the path or repo root differs between the declaration and this write — I should re-declare with this exact repository-relative path.

` + `If the typed_edit tool schemas are not loaded in my tool list, I should use ToolSearch (e.g. query \`mcp meta-edit edit\` or \`select:mcp__plugin_meta-edit_meta-edit__edit_cosmetic\`) to load the relevant schema before declaring.`
    };
  }
  const { grant, binding: bound } = match;
  if (diskSha !== bound.before_sha256) {
    return {
      decision: "deny",
      reason: `[meta-edit:stale] disk content of "${canonical}" has drifted from the typed_edit declaration ` + `(declared before_sha256=${shortHash(bound.before_sha256)}, actual ${shortHash(diskSha)}). ` + `Something changed the file between the declaration and this write — re-read it and issue a fresh typed_edit declaration.`
    };
  }
  const consumeRes = await grants.consume(grant.token_id, canonical);
  if (!consumeRes.consumed) {
    const err = consumeRes.error ?? "unknown error";
    const cat = err.includes("expired") ? "expired" : err.includes("already consumed") ? "consumed" : "consume-failed";
    return {
      decision: "deny",
      reason: `[meta-edit:${cat}] could not consume the typed_edit declaration for "${canonical}": ${err}. ` + `Re-declare with a typed edit_* MCP tool before retrying the write.`
    };
  }
  const consumed = {
    edit_id: grant.edit_id,
    ts: isoTimestamp(nowFn()),
    phase: "consumed",
    consuming_tool: toolName
  };
  try {
    log.appendConsumed(consumed);
  } catch (e) {
    process.stderr.write(`[meta-edit] WARN: failed to append consumed record for ${grant.edit_id}: ${e.message}
`);
  }
  const additionalContext = grant.declaration !== undefined ? buildReminderContext({
    phase: "write_allowed",
    kind: grant.declaration.kind,
    ...grant.declaration.target !== undefined ? { target: grant.declaration.target } : {},
    provenance: grant.declaration.provenance,
    ...grant.declaration.execution_state !== undefined ? { executionState: grant.declaration.execution_state } : {},
    targetFile: canonical,
    declaredTestFiles: grant.declaration.test_files
  }) : undefined;
  return {
    decision: "allow",
    ...additionalContext !== undefined ? { additionalContext } : {}
  };
}
function canonicalizeForBinding(inputPath, repoRoot) {
  if (typeof inputPath !== "string" || inputPath.length === 0)
    return null;
  const r = canonicalizeRepoRelative(inputPath, repoRoot);
  return r.ok ? r.canonical : null;
}
function isPathInsideRepo(inputPath, repoRoot) {
  if (typeof inputPath !== "string" || inputPath.length === 0)
    return true;
  const r = canonicalizeRepoRelative(inputPath, repoRoot);
  if (r.ok)
    return true;
  if (r.code === "escapes")
    return false;
  return true;
}
async function readFileForBinding(repoRoot, canonical) {
  const abs = path7.join(repoRoot, canonical);
  try {
    return { ok: true, content: await fs7.readFile(abs, "utf8") };
  } catch (e) {
    const err = e;
    if (err.code === "ENOENT") {
      return { ok: true, content: "" };
    }
    return { ok: false, error: err.code ?? err.message };
  }
}
function sha256Hex2(content) {
  return crypto3.createHash("sha256").update(content, "utf8").digest("hex");
}
function shortHash(h) {
  return h.length >= 12 ? `${h.slice(0, 12)}…` : h;
}

// src/hooks/bash-write-policy.ts
import * as path8 from "node:path";
var DENY_SUBSTRINGS = [
  "sed -i",
  "sed --in-place",
  "perl -pi",
  "perl -i",
  "cat >",
  "cat >>",
  "git apply"
];
var VERB_ARG_SEPARATORS = [" ", "\t"];
var DENY_VERB_NAMES = ["patch"];
var WARN_VERB_NAMES = ["mv", "cp", "rsync"];
function expandVerbPrefixes(verbs) {
  return verbs.flatMap((v) => VERB_ARG_SEPARATORS.map((s) => v + s));
}
var DENY_PREFIX_PATTERNS = expandVerbPrefixes(DENY_VERB_NAMES);
var WARN_PREFIX_PATTERNS = expandVerbPrefixes(WARN_VERB_NAMES);
var PROTECTED_PATH_NEEDLES = [
  ".meta-edit/state",
  ".meta-edit/tmp"
];
function containsAsPathComponent(s, needle) {
  let from = 0;
  while (from <= s.length - needle.length) {
    const idx = s.indexOf(needle, from);
    if (idx < 0)
      return false;
    const after = idx + needle.length < s.length ? s[idx + needle.length] : undefined;
    if (isPathComponentContinuation(after)) {
      from = idx + 1;
      continue;
    }
    if (hasAcceptableBeforeBoundary(s, idx)) {
      return true;
    }
    from = idx + 1;
  }
  return false;
}
function isPathComponentContinuation(c) {
  if (c === undefined)
    return false;
  return /^[A-Za-z0-9._-]$/.test(c);
}
function hasAcceptableBeforeBoundary(s, pos) {
  if (pos === 0)
    return true;
  const before = s[pos - 1];
  if (before === "/")
    return true;
  if (!isPathComponentContinuation(before))
    return true;
  const tokenStart = findTokenStart(s, pos);
  const prefix = s.slice(tokenStart, pos);
  if (/^-[A-Za-z]+$/.test(prefix))
    return true;
  if (/^--[A-Za-z][A-Za-z0-9-]*=$/.test(prefix))
    return true;
  return false;
}
function findTokenStart(s, pos) {
  let i = pos;
  while (i > 0) {
    const c = s[i - 1];
    if (c === " " || c === "\t" || c === `
` || c === "\r" || c === "'" || c === '"' || c === "(" || c === ";" || c === "|" || c === "&" || c === ">" || c === "<" || c === "=" || c === "$") {
      break;
    }
    i--;
  }
  return i;
}
function evaluateBashCommand(command, opts = {}) {
  if (typeof command !== "string" || command.length === 0) {
    return { decision: "allow" };
  }
  command = command.replace(new RegExp("(>>|>\\||>)([\\r\\n\\u2028\\u2029]+)", "g"), (_m, op) => `${op} `);
  if (matchesDecodeAndExecute(stripQuotedContent(command))) {
    return {
      decision: "deny",
      reason: "decoder piped into a shell interpreter (e.g. `base64 -d | bash`) " + "executes arbitrary commands at runtime, bypassing every static " + "deny pattern. Use an edit_* tool instead."
    };
  }
  const segments = splitSegments(command);
  if (segments.length === 0) {
    return { decision: "allow" };
  }
  let firstWarn = null;
  for (const segment of segments) {
    const decision = evaluateSegment(segment, opts);
    if (decision.decision === "deny") {
      return decision;
    }
    if (decision.decision === "warn" && firstWarn === null) {
      firstWarn = decision;
    }
  }
  if (firstWarn !== null)
    return firstWarn;
  return { decision: "allow" };
}
function evaluateSegment(rawSegment, opts = {}) {
  const ansiExpanded = expandAnsiCQuoting(rawSegment);
  const normalized = collapsePathDoublings(ansiExpanded.replace(/\\/g, ""));
  const scanText = stripQuotedContent(normalized);
  if (touchesProtectedPathTokenized(rawSegment)) {
    const verb2 = extractCommandVerb(normalized.trimStart());
    const isReadOnly = verb2 !== null && READ_ONLY_VERBS.has(verb2);
    const writeTargetsProtected = redirectsToProtected(normalized, opts);
    if (!isReadOnly || writeTargetsProtected) {
      return {
        decision: "deny",
        reason: "command would write to a protected meta-edit path " + "(.meta-edit/state/** or .meta-edit/tmp/**); writes to these " + "paths must go through an edit_policy_change tool call."
      };
    }
  }
  if (opts.cwd && redirectsToProtected(normalized, opts)) {
    return {
      decision: "deny",
      reason: "command would write to a protected meta-edit path " + "(.meta-edit/state/** or .meta-edit/tmp/**) via a symlinked " + "redirect target; writes to these paths must go through an " + "edit_policy_change tool call."
    };
  }
  const trimOffset = normalized.length - normalized.trimStart().length;
  const verbInfo = extractCommandVerbInfo(normalized.trimStart());
  const verbWindowEnd = verbInfo === null ? scanText.length : trimOffset + verbInfo.verbEnd + VERB_WINDOW_TAIL_CHARS;
  let firstWarn = null;
  for (const needle of DENY_SUBSTRINGS) {
    const pos = scanText.indexOf(needle);
    if (pos < 0)
      continue;
    if (pos < verbWindowEnd) {
      return {
        decision: "deny",
        reason: denyReason(needle)
      };
    }
    if (firstWarn === null) {
      firstWarn = {
        decision: "warn",
        reason: `pattern "${needle}" appears at argument position (verb is "${verbInfo?.verb ?? "unknown"}"); ` + `not denied because the typed-edit hypothesis (Article 3 + Article 4) trusts ` + `descriptions to guide the agent away from real bypass intent. Recorded as ` + `bypass-risk and may be tightened in a future version (1107).`
      };
    }
  }
  const cpBypass = matchesReadOnlyVerbCpBypass(rawSegment);
  if (cpBypass !== null) {
    return cpBypass;
  }
  const hosted = evaluateShellHostedPayload(rawSegment, opts);
  if (hosted !== null) {
    if (hosted.decision === "deny")
      return hosted;
    if (hosted.decision === "warn" && firstWarn === null)
      firstWarn = hosted;
  }
  if (redirectsOutsideSafeSinkAllowlist(rawSegment) && firstWarn === null) {
    firstWarn = {
      decision: "warn",
      reason: `meta-edit reminder:

` + "I was about to write files through Bash redirection " + "(`>` / `>>` / `>|`) to a path outside the safe-sink allowlist " + `(/dev/null, /tmp/, /var/tmp/, /run/, /sys/).

` + "If this command changes repository files, that would bypass meta-edit's typed edit surface. " + "The next move should be to declare the edit kind first " + "(e.g. edit_state_transition / edit_cosmetic for source code; " + "edit_explanation / edit_progress / edit_observation / edit_proposal / edit_decision " + "for Markdown / docs depending on intent; " + 'for new files, native Write with content = "" is ' + "hook-authorized first, then declare the typed edit_* for the content) " + `and use the normal edit path.

` + "If the command is only inspecting files or running tests, it should not write to the repository. " + "This redirect is permitted but recorded as a bypass-risk and may be tightened to deny in a future version."
    };
  }
  const heredocScan = stripQuotedContent(unquoteHeredocDelimiters(normalized));
  if (/<<-?\s*['"]?[A-Za-z_][\w]*['"]?[^<\n]*?(?<!>)>(?!>|&)/.test(heredocScan)) {
    return {
      decision: "deny",
      reason: "heredoc-with-redirect (`<<MARKER ... > target`) writes to a file. " + "Use an edit_* tool instead of redirecting a heredoc body to a path."
    };
  }
  const verb = extractCommandVerb(normalized.trimStart());
  if (verb !== null && DENY_VERBS.has(verb) && !hasSafetyFlag(normalized, verb)) {
    return {
      decision: "deny",
      reason: denyReason(verb)
    };
  }
  if (verb !== null && WARN_VERBS.has(verb) && !hasSafetyFlag(normalized, verb)) {
    if (commandOperandResolvesProtected(normalized, opts)) {
      return {
        decision: "deny",
        reason: "command would write to a protected meta-edit path " + "(.meta-edit/state/** or .meta-edit/tmp/**) via a symlinked " + "operand; writes to these paths must go through an " + "edit_policy_change tool call."
      };
    }
    if (firstWarn === null) {
      firstWarn = {
        decision: "warn",
        reason: warnVerbReason(verb)
      };
    }
  }
  if (matchesDangerousDd(rawSegment)) {
    return {
      decision: "deny",
      reason: "`dd of=<path>` writes to an arbitrary file when the target is " + "an in-repo path. Use an edit_* tool instead."
    };
  }
  if (matchesDangerousTee(rawSegment)) {
    return {
      decision: "deny",
      reason: "`tee <path>` writes to a file when the target is an in-repo " + "path. Use an edit_* tool instead."
    };
  }
  if (matchesEvalDeferredString(rawSegment)) {
    return {
      decision: "deny",
      reason: "`eval` of a non-literal argument (command substitution / backticks / " + "variable expansion) executes a payload that cannot be statically " + "inspected, bypassing every deny pattern. Use an edit_* tool instead."
    };
  }
  if (matchesPythonNodeWrite(normalized, rawSegment)) {
    return {
      decision: "deny",
      reason: "inline interpreter write (python -c / node -e / perl -e / ruby -e / php -r) " + "is a bash bypass; use an edit_* tool instead."
    };
  }
  if (firstWarn !== null)
    return firstWarn;
  return { decision: "allow" };
}
function splitSegments(cmd) {
  const main = primarySplitSegments(cmd);
  const result = [];
  for (const seg of main) {
    result.push(seg);
    for (const inner of extractSubstitutionInners(seg)) {
      for (const innerSeg of splitSegments(inner)) {
        result.push(innerSeg);
      }
    }
    for (const inner of extractFindExecInners(seg)) {
      for (const innerSeg of splitSegments(inner)) {
        result.push(innerSeg);
      }
    }
  }
  return result;
}
function extractFindExecInners(seg) {
  const inners = [];
  if (!/(?:^|\s)-exec(?:dir)?(?:\s|$)/.test(seg))
    return inners;
  const verb = extractCommandVerb(seg.trimStart());
  if (verb === null || !FIND_VERBS.has(verb))
    return inners;
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < seg.length) {
    const c = seg[i];
    if (!inSingle && c === "\\" && i + 1 < seg.length) {
      i += 2;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      i++;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (c === "-" && (seg.slice(i, i + 5) === "-exec" || seg.slice(i, i + 8) === "-execdir") && (i === 0 || /\s/.test(seg[i - 1]))) {
        const tokenLen = seg.slice(i, i + 8) === "-execdir" ? 8 : 5;
        const after = seg[i + tokenLen];
        if (after === undefined || /\s/.test(after)) {
          let j = i + tokenLen;
          while (j < seg.length && /\s/.test(seg[j]))
            j++;
          const bodyStart = j;
          let bSingle = false;
          let bDouble = false;
          while (j < seg.length) {
            const cj = seg[j];
            if (!bSingle && cj === "\\" && j + 1 < seg.length) {
              if (seg[j + 1] === ";") {
                break;
              }
              j += 2;
              continue;
            }
            if (cj === "'" && !bDouble) {
              bSingle = !bSingle;
              j++;
              continue;
            }
            if (cj === '"' && !bSingle) {
              bDouble = !bDouble;
              j++;
              continue;
            }
            if (!bSingle && !bDouble) {
              if (cj === "+" && (seg[j + 1] === undefined || /\s/.test(seg[j + 1])) && /\s/.test(seg[j - 1] ?? " ")) {
                break;
              }
            }
            j++;
          }
          let body = seg.slice(bodyStart, j).trim();
          body = body.replace(/(^|\s)\{\}(\s|$)/g, "$1$2").trim();
          if (body.length > 0)
            inners.push(body);
          i = j;
          continue;
        }
      }
    }
    i++;
  }
  return inners;
}
function primarySplitSegments(cmd) {
  const segments = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0;i < cmd.length; i++) {
    const c = cmd[i];
    const next = cmd[i + 1];
    if (!inSingle && c === "\\" && i + 1 < cmd.length) {
      buf += c + next;
      i++;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      buf += c;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      buf += c;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (c === "&" && next === "&") {
        segments.push(buf);
        buf = "";
        i++;
        continue;
      }
      if (c === "|" && next === "|") {
        segments.push(buf);
        buf = "";
        i++;
        continue;
      }
      if (c === "|" && cmd[i - 1] === ">") {
        buf += c;
        continue;
      }
      if (c === ";" || c === "|" || c === `
` || c === "\r" || c === "\u2028" || c === "\u2029") {
        segments.push(buf);
        buf = "";
        continue;
      }
      if (c === "&") {
        const prev = i > 0 ? cmd[i - 1] : undefined;
        if (next === ">" || prev === ">") {
          buf += c;
          continue;
        }
        segments.push(buf);
        buf = "";
        continue;
      }
    }
    buf += c;
  }
  segments.push(buf);
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}
function extractSubstitutionInners(seg) {
  const inners = [];
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < seg.length) {
    const c = seg[i];
    if (!inSingle && c === "\\" && i + 1 < seg.length) {
      i += 2;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      i++;
      continue;
    }
    if (!inSingle && c === "$" && seg[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      let innerSingle = false;
      let innerDouble = false;
      while (j < seg.length && depth > 0) {
        const cj = seg[j];
        if (cj === "\\" && !innerSingle && j + 1 < seg.length) {
          j += 2;
          continue;
        }
        if (cj === "'" && !innerDouble) {
          innerSingle = !innerSingle;
          j++;
          continue;
        }
        if (cj === '"' && !innerSingle) {
          innerDouble = !innerDouble;
          j++;
          continue;
        }
        if (!innerSingle && !innerDouble) {
          if (cj === "(") {
            depth++;
          } else if (cj === ")") {
            depth--;
            if (depth === 0)
              break;
          }
        }
        j++;
      }
      if (depth === 0) {
        inners.push(seg.slice(i + 2, j));
        i = j + 1;
        continue;
      }
      return inners;
    }
    if (!inSingle && (c === "<" || c === ">") && seg[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      let innerSingle = false;
      let innerDouble = false;
      while (j < seg.length && depth > 0) {
        const cj = seg[j];
        if (cj === "\\" && !innerSingle && j + 1 < seg.length) {
          j += 2;
          continue;
        }
        if (cj === "'" && !innerDouble) {
          innerSingle = !innerSingle;
          j++;
          continue;
        }
        if (cj === '"' && !innerSingle) {
          innerDouble = !innerDouble;
          j++;
          continue;
        }
        if (!innerSingle && !innerDouble) {
          if (cj === "(") {
            depth++;
          } else if (cj === ")") {
            depth--;
            if (depth === 0)
              break;
          }
        }
        j++;
      }
      if (depth === 0) {
        inners.push(seg.slice(i + 2, j));
        i = j + 1;
        continue;
      }
      return inners;
    }
    if (!inSingle && c === "`") {
      let j = i + 1;
      while (j < seg.length) {
        const cj = seg[j];
        if (cj === "\\" && j + 1 < seg.length) {
          j += 2;
          continue;
        }
        if (cj === "`")
          break;
        j++;
      }
      if (j < seg.length) {
        inners.push(seg.slice(i + 1, j));
        i = j + 1;
        continue;
      }
      return inners;
    }
    i++;
  }
  return inners;
}
function unquoteHeredocDelimiters(s) {
  let out = s.replace(/(<<-?\s*)(['"])([A-Za-z_]\w*)\2/g, (_m, prefix, _q, name) => `${prefix}${name}`);
  out = out.replace(/(<<-?\s*)\\([A-Za-z_]\w*)/g, (_m, prefix, name) => `${prefix}${name}`);
  return out;
}
var ANSI_C_ESCAPE_MAP = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\x07",
  b: "\b",
  e: "\x1B",
  f: "\f",
  n: `
`,
  r: "\r",
  t: "\t",
  v: "\v",
  "0": "\x00"
};
function expandAnsiCQuoting(s) {
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < s.length) {
    const c = s[i];
    if (!inSingle && !inDouble && c === "$" && s[i + 1] === "'") {
      let j = i + 2;
      while (j < s.length && s[j] !== "'") {
        if (s[j] === "\\" && j + 1 < s.length) {
          const next = s[j + 1];
          if (next === "x") {
            let k = j + 2;
            let hex = "";
            while (k < s.length && k < j + 4 && /[0-9A-Fa-f]/.test(s[k])) {
              hex += s[k];
              k++;
            }
            if (hex.length > 0) {
              out += String.fromCharCode(parseInt(hex, 16));
              j = k;
              continue;
            }
          }
          out += ANSI_C_ESCAPE_MAP[next] ?? next;
          j += 2;
          continue;
        }
        out += s[j];
        j++;
      }
      i = j < s.length ? j + 1 : j;
      continue;
    }
    if (!inDouble && c === "'") {
      inSingle = !inSingle;
      out += c;
      i++;
      continue;
    }
    if (!inSingle && c === '"') {
      inDouble = !inDouble;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function stripQuotedContent(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      out += "'";
      i++;
      while (i < s.length && s[i] !== "'") {
        out += " ";
        i++;
      }
      if (i < s.length) {
        out += "'";
        i++;
      }
      continue;
    }
    if (c === '"') {
      out += '"';
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length) {
          out += "  ";
          i += 2;
          continue;
        }
        out += " ";
        i++;
      }
      if (i < s.length) {
        out += '"';
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function denyReason(pattern) {
  return `command matches deny pattern "${pattern}".`;
}
function warnVerbReason(verb) {
  return `meta-edit reminder:

` + `I was about to use "${verb}", which can write into the repository ` + `(rename/move, copy, or sync).

` + `If this command changes repository content, the next move should be to declare the edit kind first ` + `(e.g. edit_cosmetic / edit_state_transition for source code; ` + `edit_explanation / edit_progress / edit_observation / edit_proposal / edit_decision ` + `for Markdown / docs depending on intent; ` + `for new files, native Write with content = "" is hook-authorized first, then declare the typed edit_* for the content) ` + `and use the normal edit path.

` + `If "${verb}" here is a legitimate non-edit use (rename/move, copy templates/fixtures, backup, deploy/sync), ` + `it is permitted — but recorded as a bypass-risk and may be tightened back to deny in a future version. ` + `Writes to .meta-edit/state/** and .meta-edit/tmp/** remain hard-denied regardless of verb. ` + `See OBSERVED-FAILURES.md for the warn→deny restore trigger.`;
}
var FIND_VERBS = new Set([
  "find",
  "fdfind",
  "fd",
  "gfind"
]);
var WRAPPER_VERBS = new Set([
  "sudo",
  "doas",
  "env",
  "xargs",
  "nice",
  "ionice",
  "nohup",
  "time",
  "command",
  "exec",
  "eval",
  "stdbuf",
  "chrt",
  "taskset",
  "busybox",
  "toybox"
]);
var DENY_VERBS = new Set(DENY_VERB_NAMES);
var WARN_VERBS = new Set(WARN_VERB_NAMES);
var SAFE_ABSOLUTE_PREFIXES = [
  "/tmp/",
  "/var/tmp/",
  "/run/",
  "/sys/"
];
var SAFE_EXACT_TARGETS = new Set([
  "/dev/null",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/zero"
]);
var SAFE_PATH_COMPONENT_NEEDLES = [".claude"];
function isInRepoWriteTarget(target) {
  if (target.length === 0)
    return false;
  if (SAFE_EXACT_TARGETS.has(target))
    return false;
  const resolved = path8.normalize(target);
  if (SAFE_EXACT_TARGETS.has(resolved))
    return false;
  for (const needle of SAFE_PATH_COMPONENT_NEEDLES) {
    if (containsAsPathComponent(resolved, needle))
      return false;
  }
  if (resolved.startsWith("/")) {
    return !SAFE_ABSOLUTE_PREFIXES.some((p) => resolved.startsWith(p));
  }
  return true;
}
function tokenizeSegment(segment) {
  const tokens = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let hasContent = false;
  for (let i = 0;i < segment.length; i++) {
    const c = segment[i];
    if (!inSingle && c === "\\" && i + 1 < segment.length) {
      buf += segment[i + 1];
      hasContent = true;
      i++;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      hasContent = true;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      hasContent = true;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(c)) {
      if (hasContent) {
        tokens.push(buf);
        buf = "";
        hasContent = false;
      }
      continue;
    }
    buf += c;
    hasContent = true;
  }
  if (hasContent)
    tokens.push(buf);
  return tokens;
}
function matchesDangerousDd(segment) {
  const trimmed = stripLeadingEnvAssignments(segment.trimStart());
  const verb = extractCommandVerb(trimmed);
  if (verb !== "dd")
    return false;
  const tokens = tokenizeSegment(trimmed);
  for (const tok of tokens) {
    if (tok.startsWith("of=")) {
      const target = tok.slice(3);
      if (isInRepoWriteTarget(target))
        return true;
    }
  }
  return false;
}
function matchesDangerousTee(segment) {
  const trimmed = stripLeadingEnvAssignments(segment.trimStart());
  const verb = extractCommandVerb(trimmed);
  if (verb !== "tee")
    return false;
  const tokens = tokenizeSegment(trimmed);
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    const base = tok.includes("/") ? tok.slice(tok.lastIndexOf("/") + 1) : tok;
    if (base === "tee") {
      i++;
      break;
    }
    i++;
  }
  for (;i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith("-"))
      continue;
    if (isFdRedirectToken(tok))
      continue;
    if (isInRepoWriteTarget(tok))
      return true;
  }
  for (const target of iterRedirectTargets(segment)) {
    if (target.length === 0)
      continue;
    if (isInRepoWriteTarget(target))
      return true;
  }
  return false;
}
function isFdRedirectToken(tok) {
  if (tok.length === 0)
    return false;
  if (tok.startsWith(">") || tok.startsWith("&>"))
    return true;
  if (tok.startsWith("<"))
    return true;
  return /^\d+(?:>|<)/.test(tok);
}
var WRAPPER_VALUE_OPTS = {
  sudo: new Set([
    "-u",
    "-g",
    "-h",
    "-C",
    "-D",
    "-p",
    "-r",
    "-t",
    "-T",
    "-R",
    "-c",
    "-U"
  ]),
  doas: new Set(["-u", "-C"]),
  env: new Set(["-u", "-C", "-S"]),
  xargs: new Set([
    "-I",
    "-J",
    "-E",
    "-L",
    "-n",
    "-P",
    "-s",
    "-d",
    "-a"
  ])
};
var READ_ONLY_VERBS = new Set([
  "tail",
  "head",
  "cat",
  "grep",
  "egrep",
  "fgrep",
  "wc",
  "cut",
  "tr",
  "od",
  "hexdump",
  "stat",
  "ls",
  "du",
  "df",
  "jq",
  "diff",
  "cmp"
]);
function redirectsToProtected(s, opts = {}) {
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < s.length) {
    const c = s[i];
    if (!inSingle && c === "\\" && i + 1 < s.length) {
      i += 2;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      i++;
      continue;
    }
    if (inSingle || inDouble || c !== ">") {
      i++;
      continue;
    }
    if (s[i + 1] === "&") {
      i += 2;
      continue;
    }
    let j = i + 1;
    if (s[j] === ">" || s[j] === "|")
      j++;
    while (j < s.length && (s[j] === " " || s[j] === "\t"))
      j++;
    const tokenStart = j;
    while (j < s.length) {
      const tc = s[j];
      if (tc === " " || tc === "\t" || tc === ";" || tc === "|" || tc === "&" || tc === `
` || tc === ">" || tc === "<") {
        break;
      }
      j++;
    }
    let target = s.slice(tokenStart, j);
    target = target.replace(/^["']|["']$/g, "");
    for (const needle of PROTECTED_PATH_NEEDLES) {
      if (containsAsPathComponent(target, needle)) {
        return true;
      }
    }
    if (opts.cwd && target.length > 0) {
      const absolute = path8.isAbsolute(target) ? target : path8.resolve(opts.cwd, target);
      const rel = path8.relative(opts.cwd, absolute);
      if (rel.length > 0 && isProtectedPath(rel, { repoRoot: opts.cwd })) {
        return true;
      }
    }
    i = j;
  }
  return false;
}
function* operandPathCandidates(token) {
  if (token.length === 0)
    return;
  if (!token.startsWith("-")) {
    yield token;
    return;
  }
  const eq = token.indexOf("=");
  if (eq >= 0) {
    yield token.slice(eq + 1);
    return;
  }
  if (token.length > 2 && /[A-Za-z]/.test(token[1])) {
    yield token.slice(2);
  }
}
function commandOperandResolvesProtected(normalized, opts) {
  const cwd = opts.cwd;
  if (!cwd)
    return false;
  for (const token of tokenizeSegment(normalized)) {
    for (const candidate of operandPathCandidates(token)) {
      if (candidate.length === 0)
        continue;
      const absolute = path8.isAbsolute(candidate) ? candidate : path8.resolve(cwd, candidate);
      const rel = path8.relative(cwd, absolute);
      if (rel.length > 0 && isProtectedPath(rel, { repoRoot: cwd })) {
        return true;
      }
    }
  }
  return false;
}
function* iterRedirectTargets(s, opts = {}) {
  const skipSub = opts.skipSubstitutionInternal === true;
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let subDepth = 0;
  while (i < s.length) {
    const c = s[i];
    if (!inSingle && c === "\\" && i + 1 < s.length) {
      i += 2;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      i++;
      continue;
    }
    if (!inSingle && c === "$" && s[i + 1] === "(") {
      subDepth++;
      i += 2;
      continue;
    }
    if (!inSingle && !inDouble && c === ")" && subDepth > 0) {
      subDepth--;
      i++;
      continue;
    }
    if (inSingle || inDouble || c !== ">") {
      i++;
      continue;
    }
    if (s[i + 1] === "&") {
      i += 2;
      continue;
    }
    if (skipSub && subDepth > 0) {
      i++;
      continue;
    }
    let j = i + 1;
    if (s[j] === ">" || s[j] === "|")
      j++;
    while (j < s.length && (s[j] === " " || s[j] === "\t"))
      j++;
    const tokenStart = j;
    while (j < s.length) {
      const tc = s[j];
      if (tc === " " || tc === "\t" || tc === ";" || tc === "|" || tc === "&" || tc === `
` || tc === ">" || tc === "<") {
        break;
      }
      j++;
    }
    let target = s.slice(tokenStart, j);
    target = target.replace(/^["']|["']$/g, "");
    yield target;
    i = j;
  }
}
var SHELL_HOSTING_C_RE = /(?:^|[\s;&|(])(?:[A-Za-z0-9_.\/-]*\/)?(?:r?bash|sh|dash|zsh|m?ksh|ash)\d*(?:\.\d+)*\s+(?:-[A-Za-z]*c[A-Za-z]*)\b\s*/;
function evaluateShellHostedPayload(rawSegment, opts) {
  const cMatch = rawSegment.match(SHELL_HOSTING_C_RE);
  if (cMatch !== null && typeof cMatch.index === "number") {
    const argStart = cMatch.index + cMatch[0].length;
    const arg = readShellArg(rawSegment, argStart);
    const hit = recursivelyEvaluateArg(arg, opts);
    if (hit !== null)
      return hit;
  }
  const evalArg = extractEvalArg(rawSegment);
  if (evalArg !== null) {
    const hit = recursivelyEvaluateArg(evalArg, opts);
    if (hit !== null)
      return hit;
  }
  return null;
}
function recursivelyEvaluateArg(arg, opts) {
  if (arg === null || arg.length === 0)
    return null;
  const deEscaped = arg.replace(/\\/g, "");
  const decision = evaluateBashCommand(deEscaped, opts);
  if (decision.decision === "deny" || decision.decision === "warn") {
    return decision;
  }
  return null;
}
function extractEvalArg(rawSegment) {
  let s = stripLeadingEnvAssignments(rawSegment.trimStart());
  for (let safety = 0;safety < 32; safety++) {
    s = stripLeadingEnvAssignments(s);
    const m = s.match(/^(\S+)/);
    if (m === null || m[0] === undefined)
      return null;
    const word = m[0];
    const baseStart = word.lastIndexOf("/");
    const base = baseStart >= 0 ? word.slice(baseStart + 1) : word;
    if (base === "eval") {
      const argStart = word.length + (s.slice(word.length).match(/^\s+/)?.[0].length ?? 0);
      return readShellArg(s, argStart);
    }
    if (!WRAPPER_VERBS.has(base))
      return null;
    const valueOpts = WRAPPER_VALUE_OPTS[base];
    s = s.slice(word.length).replace(/^\s+/, "");
    while (true) {
      const optMatch = s.match(/^(-[^\s-]\S*|--[^\s=]+(?:=\S*)?)/);
      if (optMatch === null || optMatch[0] === undefined)
        break;
      const opt = optMatch[0];
      s = s.slice(opt.length).replace(/^\s+/, "");
      if (valueOpts !== undefined && !opt.includes("=") && valueOpts.has(opt)) {
        const valMatch = s.match(/^\S+/);
        if (valMatch !== null && valMatch[0] !== undefined) {
          s = s.slice(valMatch[0].length).replace(/^\s+/, "");
        }
      }
    }
  }
  return null;
}
function redirectsOutsideSafeSinkAllowlist(rawSegment) {
  for (const target of iterRedirectTargets(rawSegment, {
    skipSubstitutionInternal: true
  })) {
    if (target.length === 0)
      continue;
    if (isInRepoWriteTarget(target))
      return true;
  }
  return false;
}
function matchesReadOnlyVerbCpBypass(rawSegment) {
  const trimmed = stripLeadingEnvAssignments(rawSegment.trimStart());
  const verb = extractCommandVerb(trimmed);
  if (verb === null || !READ_ONLY_VERBS.has(verb))
    return null;
  for (const target of iterRedirectTargets(rawSegment)) {
    if (target.length === 0)
      continue;
    if (isInRepoWriteTarget(target)) {
      return {
        decision: "deny",
        reason: `\`${verb} ... > <in-repo target>\` is functionally a copy/transform ` + `into a repo file. Use a typed edit_* tool (edit_cosmetic for source code, ` + `edit_explanation / edit_progress / edit_observation / edit_proposal / edit_decision for Markdown / docs by intent, or whichever kind-specific impl tool fits the change) instead of ` + `redirecting a read-only verb's stdout to a repository path. For ` + `new files, native Write with content = "" is hook-authorized; ` + `then declare a typed_edit for the content. Out-of-repo redirects (` + `/dev/null, /tmp/, /var/tmp/, ~/.claude/) remain allowed.`
      };
    }
  }
  return null;
}
var DECODE_AND_EXEC_RE = /(?:base64\s+(?:--decode\b|-[A-Za-z]*d[A-Za-z]*\b)|xxd\s+-[A-Za-z]*r[A-Za-z]*\b|openssl\s+(?:base64|enc)\b[^|]*?\s-d\b)[^|]*\|\s*(?:sudo\s+|env\s+(?:[A-Z][A-Z0-9_]*=\S*\s+)*)?(?:\/\S+\/)?(?:bash|sh|dash|zsh|ksh|ash)\b/;
function matchesDecodeAndExecute(command) {
  return DECODE_AND_EXEC_RE.test(command);
}
function matchesEvalDeferredString(rawSegment) {
  const trimmed = rawSegment.replace(/^\s+/, "");
  const head = stripLeadingEnvAssignments(trimmed);
  const m = head.match(/^eval\b\s*/);
  if (m === null)
    return false;
  const arg = head.slice(m[0].length);
  if (arg.length === 0)
    return false;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0;i < arg.length; i++) {
    const c = arg[i];
    if (!inSingle && c === "\\" && i + 1 < arg.length) {
      i++;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle)
      continue;
    if (c === "$") {
      const next = arg[i + 1];
      if (next === "(" || next === "{")
        return true;
      if (next !== undefined && /[A-Za-z_]/.test(next))
        return true;
    }
    if (c === "`")
      return true;
  }
  return false;
}
function hasSafetyFlag(segment, verb) {
  if (verb === "patch") {
    const hasDryRun = /(?:^|\s)(?:--dry-run|--check)(?:\s|$)/.test(segment);
    if (!hasDryRun)
      return false;
    const hasOutput = /(?:^|\s)(?:-o(?:\s|=|\S|$)|--output(?:\s|=|$))/.test(segment);
    return !hasOutput;
  }
  return false;
}
function collapsePathDoublings(s) {
  let prev;
  let cur = s;
  do {
    prev = cur;
    cur = cur.replace(/\/(\.\/)+/g, "/");
    cur = cur.replace(/\/[^/]+\/\.\.(?=\/|$)/g, "");
    cur = cur.replace(/\/{2,}/g, "/");
  } while (cur !== prev);
  return cur;
}
function extractCommandVerb(segment) {
  return extractCommandVerbInfo(segment)?.verb ?? null;
}
function extractCommandVerbInfo(segment) {
  let s = stripLeadingEnvAssignments(segment);
  let consumed = segment.length - s.length;
  for (let safety = 0;safety < 32; safety++) {
    const beforeStrip = s;
    s = stripLeadingEnvAssignments(s);
    consumed += beforeStrip.length - s.length;
    const m = s.match(/^(\S+)/);
    if (m === null || m[0] === undefined)
      return null;
    const word = m[0];
    const baseStart = word.lastIndexOf("/");
    const base = baseStart >= 0 ? word.slice(baseStart + 1) : word;
    if (WRAPPER_VERBS.has(base)) {
      const valueOpts = WRAPPER_VALUE_OPTS[base];
      const afterWord = s.slice(word.length).replace(/^\s+/, "");
      consumed += s.length - afterWord.length;
      s = afterWord;
      while (true) {
        const optMatch = s.match(/^(-[^\s-]\S*|--[^\s=]+(?:=\S*)?)/);
        if (optMatch === null || optMatch[0] === undefined)
          break;
        const opt = optMatch[0];
        const afterOpt = s.slice(opt.length).replace(/^\s+/, "");
        consumed += s.length - afterOpt.length;
        s = afterOpt;
        if (valueOpts !== undefined && !opt.includes("=") && valueOpts.has(opt)) {
          const valMatch = s.match(/^\S+/);
          if (valMatch !== null && valMatch[0] !== undefined) {
            const afterVal = s.slice(valMatch[0].length).replace(/^\s+/, "");
            consumed += s.length - afterVal.length;
            s = afterVal;
          }
        }
      }
      continue;
    }
    return { verb: base, verbEnd: consumed + word.length };
  }
  return null;
}
var VERB_WINDOW_TAIL_CHARS = 0;
function stripLeadingEnvAssignments(s) {
  let i = 0;
  while (i < s.length) {
    while (i < s.length && (s[i] === " " || s[i] === "\t")) {
      i++;
    }
    const nameStart = i;
    if (i < s.length && (s[i] >= "A" && s[i] <= "Z" || s[i] >= "a" && s[i] <= "z" || s[i] === "_")) {
      i++;
      while (i < s.length && (s[i] >= "A" && s[i] <= "Z" || s[i] >= "a" && s[i] <= "z" || s[i] >= "0" && s[i] <= "9" || s[i] === "_")) {
        i++;
      }
      if (s[i] !== "=") {
        return s.slice(nameStart);
      }
      i++;
      let inSingle = false;
      let inDouble = false;
      while (i < s.length) {
        const c = s[i];
        if (!inSingle && c === "\\" && i + 1 < s.length) {
          i += 2;
          continue;
        }
        if (c === "'" && !inDouble) {
          inSingle = !inSingle;
          i++;
          continue;
        }
        if (c === '"' && !inSingle) {
          inDouble = !inDouble;
          i++;
          continue;
        }
        if (!inSingle && !inDouble && (c === " " || c === "\t")) {
          break;
        }
        i++;
      }
      continue;
    }
    return s.slice(i);
  }
  return "";
}
function touchesProtectedPathTokenized(rawSegment) {
  for (const tok of tokenizeSegment(rawSegment)) {
    if (tok.length === 0)
      continue;
    if (/\s/.test(tok))
      continue;
    const norm = collapsePathDoublings(tok.replace(/\\/g, ""));
    for (const needle of PROTECTED_PATH_NEEDLES) {
      if (containsAsPathComponent(norm, needle))
        return true;
    }
  }
  return false;
}
var PYTHON_WRITE_RE = /write_text|\.write\(|open\(\s*[^)]*['"]w/;
var NODE_WRITE_RE = /writeFile|writeFileSync/;
var PERL_WRITE_RE = /\bopen\b[^;]*?["']>{1,2}["']|\bsyswrite\b|->\s*spew(?:_raw|_utf8)?\b|IO::File->new\b[^;]*?["']>{1,2}/;
var RUBY_WRITE_RE = /\bFile\.(?:write|open)\b|\bIO\.(?:write|binwrite)\b|\.write\b\s*\(\s*['"]/;
var PHP_WRITE_RE = /\bfile_put_contents\b|\bfwrite\b|\bfputs\b|\bfputcsv\b/;
var INTERP_PATH_PREFIX = "(?:[A-Za-z0-9_./\\-]*/)?";
var INTERP_VERSION_SUFFIX = "\\d*(?:\\.\\d+)*";
var PYTHON_INVOCATION_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "(?:python|pypy)" + INTERP_VERSION_SUFFIX + "\\s+-c\\b");
var PYTHON_INVOCATION_HEAD_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "(?:python|pypy)" + INTERP_VERSION_SUFFIX + "\\s+-c\\s+");
var PERL_INVOCATION_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "perl" + INTERP_VERSION_SUFFIX + "\\s+-[A-Za-z]*[eE][A-Za-z]*\\b");
var PERL_INVOCATION_HEAD_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "perl" + INTERP_VERSION_SUFFIX + "\\s+-[A-Za-z]*[eE][A-Za-z]*\\b\\s*");
var PERL_INPLACE_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "perl" + INTERP_VERSION_SUFFIX + "\\s+(?:-[A-Za-z]*\\s+)*-[a-z]*i");
var RUBY_INVOCATION_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "ruby" + INTERP_VERSION_SUFFIX + "\\s+-[A-Za-z]*e[A-Za-z]*\\b");
var RUBY_INVOCATION_HEAD_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "ruby" + INTERP_VERSION_SUFFIX + "\\s+-[A-Za-z]*e[A-Za-z]*\\b\\s*");
var AWK_INVOCATION_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "(?:g|m|n)?awk" + INTERP_VERSION_SUFFIX + "\\b");
var AWK_INSCRIPT_REDIRECT_RE = /\bprintf?\b[^;}\n]*?(>>?)\s*["']([^"']+)["']/g;
var PHP_INVOCATION_RE = /(?:^|[\s;&|(])php\s+-[A-Za-z]*[rRB][A-Za-z]*\b/;
var PHP_INVOCATION_HEAD_RE = /(?:^|[\s;&|(])php\s+-[A-Za-z]*[rRB][A-Za-z]*\b\s*/;
var NODE_INVOCATION_RE = /(?:^|[\s;&|(])node\s+(?:-e\b|--[e]val\b=?)/;
var NODE_INVOCATION_HEAD_RE = /(?:^|[\s;&|(])node\s+(?:-e\b|--[e]val\b=?)\s*/;
function matchesPythonNodeWrite(normalized, raw) {
  if (PYTHON_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(PYTHON_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null) {
        if (/(?:^|[^A-Za-z0-9_])(?:exec|[e]val|compile)\s*\(/.test(arg)) {
          if (PYTHON_WRITE_RE.test(arg))
            return true;
        }
        const masked = maskLanguageStringLiterals(arg);
        if (PYTHON_WRITE_RE.test(masked))
          return true;
      } else if (PYTHON_WRITE_RE.test(normalized)) {
        return true;
      }
    } else if (PYTHON_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  if (PERL_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(PERL_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null && PERL_WRITE_RE.test(arg))
        return true;
      if (arg === null && PERL_WRITE_RE.test(normalized))
        return true;
    } else if (PERL_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  if (PERL_INPLACE_RE.test(normalized))
    return true;
  if (RUBY_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(RUBY_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null && RUBY_WRITE_RE.test(arg))
        return true;
      if (arg === null && RUBY_WRITE_RE.test(normalized))
        return true;
    } else if (RUBY_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  if (AWK_INVOCATION_RE.test(normalized)) {
    for (const m of normalized.matchAll(AWK_INSCRIPT_REDIRECT_RE)) {
      const target = m[2];
      if (target !== undefined && isInRepoWriteTarget(target))
        return true;
    }
  }
  if (PHP_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(PHP_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null && PHP_WRITE_RE.test(arg))
        return true;
      if (arg === null && PHP_WRITE_RE.test(normalized))
        return true;
    } else if (PHP_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  if (NODE_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(NODE_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null) {
        if (/(?:^|[^A-Za-z0-9_])(?:[e]val|Function|runInThisContext|runInNewContext)\s*\(/.test(arg)) {
          if (NODE_WRITE_RE.test(arg))
            return true;
        }
        const masked = maskLanguageStringLiterals(arg);
        if (NODE_WRITE_RE.test(masked))
          return true;
      } else if (NODE_WRITE_RE.test(normalized)) {
        return true;
      }
    } else if (NODE_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  return false;
}
function readShellArg(s, start) {
  if (start >= s.length)
    return null;
  let i = start;
  let buf = "";
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === `
` || c === "\r" || c === ";" || c === "|" || c === "&" || c === ">" || c === "<") {
      break;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === "\\" && j + 1 < s.length) {
          buf += s[j + 1];
          j += 2;
          continue;
        }
        if (s[j] === '"')
          break;
        buf += s[j];
        j++;
      }
      if (j >= s.length)
        return null;
      i = j + 1;
      continue;
    }
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0)
        return null;
      buf += s.slice(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === "$" && s[i + 1] === "'") {
      let j = i + 2;
      while (j < s.length) {
        if (s[j] === "\\" && j + 1 < s.length) {
          buf += s[j + 1];
          j += 2;
          continue;
        }
        if (s[j] === "'")
          break;
        buf += s[j];
        j++;
      }
      if (j >= s.length)
        return null;
      i = j + 1;
      continue;
    }
    buf += c;
    i++;
  }
  if (i === start)
    return null;
  return buf;
}
function maskLanguageStringLiterals(s) {
  let result = "";
  let i = 0;
  while (i < s.length) {
    const start = detectStringStart(s, i);
    if (start === null) {
      result += s[i];
      i++;
      continue;
    }
    const { prefixLen, quote, isF } = start;
    const quoteStart = i + prefixLen;
    const prefix = s.slice(i, quoteStart);
    if (s[quoteStart + 1] === quote && s[quoteStart + 2] === quote) {
      const triple = quote + quote + quote;
      const end = s.indexOf(triple, quoteStart + 3);
      if (end < 0) {
        result += s.slice(i);
        return result;
      }
      if (isF) {
        const inner = s.slice(quoteStart + 3, end);
        result += prefix + triple + preserveFInterpolations(inner) + triple;
      } else {
        result += prefix + triple + triple;
      }
      i = end + 3;
      continue;
    }
    let j = quoteStart + 1;
    while (j < s.length) {
      if (s[j] === "\\" && j + 1 < s.length) {
        j += 2;
        continue;
      }
      if (s[j] === quote)
        break;
      j++;
    }
    if (j >= s.length) {
      result += s.slice(i);
      return result;
    }
    if (isF) {
      const inner = s.slice(quoteStart + 1, j);
      result += prefix + quote + preserveFInterpolations(inner) + quote;
    } else {
      result += prefix + quote + quote;
    }
    i = j + 1;
  }
  return result;
}
function detectStringStart(s, i) {
  const c0 = s[i];
  if (c0 === undefined)
    return null;
  if (c0 === "'" || c0 === '"') {
    return { prefixLen: 0, quote: c0, isF: false };
  }
  const isPrefixChar = (c) => c !== undefined && /^[fFrRbBuU]$/.test(c);
  if (isPrefixChar(c0) && (s[i + 1] === "'" || s[i + 1] === '"')) {
    return {
      prefixLen: 1,
      quote: s[i + 1],
      isF: c0 === "f" || c0 === "F"
    };
  }
  if (isPrefixChar(c0) && isPrefixChar(s[i + 1]) && (s[i + 2] === "'" || s[i + 2] === '"')) {
    const c1 = s[i + 1];
    return {
      prefixLen: 2,
      quote: s[i + 2],
      isF: c0 === "f" || c0 === "F" || c1 === "f" || c1 === "F"
    };
  }
  return null;
}
function preserveFInterpolations(content) {
  let result = "";
  let i = 0;
  while (i < content.length) {
    const c = content[i];
    if (c === "{" && content[i + 1] === "{") {
      i += 2;
      continue;
    }
    if (c === "}" && content[i + 1] === "}") {
      i += 2;
      continue;
    }
    if (c === "{") {
      let j = i + 1;
      let depth = 1;
      while (j < content.length && depth > 0) {
        const cj = content[j];
        if (cj === "{") {
          depth++;
        } else if (cj === "}") {
          depth--;
          if (depth === 0)
            break;
        }
        j++;
      }
      if (depth === 0) {
        result += content.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      return result;
    }
    i++;
  }
  return result;
}

// src/state/grants.ts
import * as crypto4 from "node:crypto";
import * as fs8 from "node:fs/promises";
import * as path9 from "node:path";
var GRANT_TTL_MS = 600000;
var TOKEN_ID_RE = /^met_\d{8}_[0-9a-f]{10}$/;
function formatDayKey2(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
function generateTokenId(now = new Date) {
  const key = formatDayKey2(now);
  const rand = crypto4.randomBytes(5).toString("hex");
  return `met_${key}_${rand}`;
}
var HEX64_RE = /^[0-9a-f]{64}$/;
function isGrant(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const v = value;
  if (typeof v.token_id !== "string" || !TOKEN_ID_RE.test(v.token_id)) {
    return false;
  }
  if (typeof v.edit_id !== "string")
    return false;
  if (typeof v.issued_at !== "string")
    return false;
  if (typeof v.expires_at !== "string")
    return false;
  if (!Array.isArray(v.binding) || v.binding.length === 0)
    return false;
  for (const b of v.binding) {
    if (typeof b !== "object" || b === null)
      return false;
    const bb = b;
    if (typeof bb.file !== "string" || bb.file.length === 0)
      return false;
    if (typeof bb.before_sha256 !== "string" || !HEX64_RE.test(bb.before_sha256)) {
      return false;
    }
  }
  if ("declaration" in v && v.declaration !== undefined) {
    if (!isGrantDeclaration(v.declaration))
      return false;
  }
  if (!Array.isArray(v.consumed_files))
    return false;
  for (const c of v.consumed_files) {
    if (typeof c !== "string")
      return false;
  }
  return true;
}
function isGrantDeclaration(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const v = value;
  if (typeof v.kind !== "string" || v.kind.length === 0)
    return false;
  if (v.target !== undefined && v.target !== "prod" && v.target !== "test") {
    return false;
  }
  if (v.execution_state !== undefined && typeof v.execution_state !== "string") {
    return false;
  }
  if (typeof v.provenance !== "string" || v.provenance.length === 0) {
    return false;
  }
  if (typeof v.target_file !== "string" || v.target_file.length === 0) {
    return false;
  }
  if (!Array.isArray(v.test_files))
    return false;
  for (const file of v.test_files) {
    if (typeof file !== "string")
      return false;
  }
  return true;
}
var SHARED_MUTEX_TAILS = new Map;
async function withSharedLock(key, fn) {
  const prev = SHARED_MUTEX_TAILS.get(key) ?? Promise.resolve();
  let release;
  const next = new Promise((resolve7) => {
    release = resolve7;
  });
  const myTurn = prev.then(() => {
    return;
  }, () => {
    return;
  });
  const myTail = prev.then(() => next, () => next);
  SHARED_MUTEX_TAILS.set(key, myTail);
  try {
    await myTurn;
    return await fn();
  } finally {
    release();
    if (SHARED_MUTEX_TAILS.get(key) === myTail) {
      SHARED_MUTEX_TAILS.delete(key);
    }
  }
}
async function withInterProcessLock(lockPath, fn) {
  const timeoutMs = 5000;
  const staleMs = 15000;
  const start = Date.now();
  let held = false;
  while (Date.now() - start < timeoutMs) {
    try {
      const fh = await fs8.open(lockPath, "wx", 384);
      await fh.close();
      held = true;
      break;
    } catch (e) {
      if (e.code !== "EEXIST") {
        break;
      }
      try {
        const st = await fs8.stat(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          await fs8.unlink(lockPath).catch(() => {
            return;
          });
          continue;
        }
      } catch {
        continue;
      }
      await new Promise((r) => setTimeout(r, 25 + Math.random() * 40));
    }
  }
  if (!held) {
    process.stderr.write(`[meta-edit] WARN: grant consume proceeding WITHOUT cross-process lock ` + `(could not acquire ${lockPath} within ${timeoutMs}ms); ` + `concurrent native writes against this grant may race.
`);
  }
  try {
    return await fn();
  } finally {
    if (held) {
      await fs8.unlink(lockPath).catch(() => {
        return;
      });
    }
  }
}

class GrantsStoreImpl {
  grantsDir;
  constructor(repoRoot) {
    this.grantsDir = path9.join(repoRoot, ".meta-edit", "state", "grants");
  }
  mutexKey(token_id) {
    return path9.resolve(this.grantPath(token_id));
  }
  async ensureDir() {
    await fs8.mkdir(this.grantsDir, { recursive: true, mode: 448 });
  }
  grantPath(token_id) {
    return path9.join(this.grantsDir, `${token_id}.json`);
  }
  async issue(args) {
    if (args.binding.length === 0) {
      throw new Error("grants.issue: binding must contain at least one entry");
    }
    const seenFiles = new Set;
    for (const b of args.binding) {
      if (typeof b.file !== "string" || b.file.length === 0) {
        throw new Error("grants.issue: binding[].file must be a non-empty string");
      }
      if (seenFiles.has(b.file)) {
        throw new Error(`grants.issue: duplicate binding file "${b.file}" — each grant must bind each file at most once`);
      }
      seenFiles.add(b.file);
      if (!HEX64_RE.test(b.before_sha256)) {
        throw new Error(`grants.issue: binding[].before_sha256 must be 64 lowercase hex chars (file=${b.file})`);
      }
    }
    if (args.declaration !== undefined && !isGrantDeclaration(args.declaration)) {
      throw new Error("grants.issue: declaration metadata is malformed");
    }
    await this.ensureDir();
    try {
      await this.reapExpired();
    } catch {}
    const now = new Date;
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + GRANT_TTL_MS).toISOString();
    const MAX_RETRIES = 8;
    let lastErr = null;
    for (let attempt = 0;attempt < MAX_RETRIES; attempt++) {
      const token_id = generateTokenId(now);
      const grant = {
        token_id,
        edit_id: args.edit_id,
        issued_at: issuedAt,
        expires_at: expiresAt,
        binding: args.binding,
        ...args.declaration !== undefined ? {
          declaration: {
            ...args.declaration,
            test_files: [...args.declaration.test_files]
          }
        } : {},
        consumed_files: []
      };
      const filePath = this.grantPath(token_id);
      try {
        await fs8.writeFile(filePath, JSON.stringify(grant), {
          encoding: "utf8",
          flag: "wx",
          mode: 384
        });
        return grant;
      } catch (e) {
        const code = e.code;
        if (code === "EEXIST") {
          lastErr = e;
          continue;
        }
        throw e;
      }
    }
    throw new Error(`grants.issue: exhausted token id retries (last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)})`);
  }
  async lookup(token_id) {
    if (typeof token_id !== "string" || !TOKEN_ID_RE.test(token_id)) {
      return null;
    }
    const filePath = this.grantPath(token_id);
    let text;
    try {
      text = await fs8.readFile(filePath, "utf8");
    } catch (e) {
      if (e.code === "ENOENT")
        return null;
      throw e;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (!isGrant(parsed))
      return null;
    if (Date.parse(parsed.expires_at) <= Date.now()) {
      return null;
    }
    return parsed;
  }
  async consume(token_id, file_path) {
    if (typeof token_id !== "string" || !TOKEN_ID_RE.test(token_id)) {
      return { consumed: false, fully_consumed: false, error: "invalid token id" };
    }
    return withSharedLock(this.mutexKey(token_id), () => withInterProcessLock(`${this.grantPath(token_id)}.lock`, () => this.consumeLocked(token_id, file_path)));
  }
  async consumeLocked(token_id, file_path) {
    const filePath = this.grantPath(token_id);
    let text;
    try {
      text = await fs8.readFile(filePath, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") {
        return {
          consumed: false,
          fully_consumed: false,
          error: "token not found"
        };
      }
      throw e;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        consumed: false,
        fully_consumed: false,
        error: "grant file is corrupt"
      };
    }
    if (!isGrant(parsed)) {
      return {
        consumed: false,
        fully_consumed: false,
        error: "grant file is malformed"
      };
    }
    if (Date.parse(parsed.expires_at) <= Date.now()) {
      return { consumed: false, fully_consumed: false, error: "token expired" };
    }
    const matchIdx = parsed.binding.findIndex((b) => b.file === file_path);
    if (matchIdx === -1) {
      return {
        consumed: false,
        fully_consumed: false,
        error: "file_path not bound by this token"
      };
    }
    if (parsed.consumed_files.includes(file_path)) {
      return {
        consumed: false,
        fully_consumed: false,
        error: "binding already consumed"
      };
    }
    parsed.consumed_files = [...parsed.consumed_files, file_path];
    const fullyConsumed = parsed.consumed_files.length === parsed.binding.length;
    if (fullyConsumed) {
      try {
        await fs8.unlink(filePath);
      } catch (e) {
        if (e.code !== "ENOENT")
          throw e;
      }
    } else {
      await fs8.writeFile(filePath, JSON.stringify(parsed), {
        encoding: "utf8",
        mode: 384
      });
    }
    return { consumed: true, fully_consumed: fullyConsumed };
  }
  async findActiveBindingForFile(canonicalFile, opts) {
    if (typeof canonicalFile !== "string" || canonicalFile.length === 0) {
      return null;
    }
    let names;
    try {
      names = await fs8.readdir(this.grantsDir);
    } catch (e) {
      if (e.code === "ENOENT")
        return null;
      throw e;
    }
    const now = Date.now();
    const candidates = [];
    for (const name of names) {
      if (!name.endsWith(".json"))
        continue;
      const filePath = path9.join(this.grantsDir, name);
      let text;
      try {
        text = await fs8.readFile(filePath, "utf8");
      } catch (e) {
        if (e.code === "ENOENT")
          continue;
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      if (!isGrant(parsed))
        continue;
      if (Date.parse(parsed.expires_at) <= now)
        continue;
      if (parsed.consumed_files.includes(canonicalFile))
        continue;
      const binding = parsed.binding.find((b) => b.file === canonicalFile);
      if (!binding)
        continue;
      const issuedMs = Date.parse(parsed.issued_at);
      const issuedScore = Number.isFinite(issuedMs) ? issuedMs : -Infinity;
      candidates.push({ match: { grant: parsed, binding }, issuedScore });
    }
    if (candidates.length === 0)
      return null;
    let pool = candidates;
    if (opts?.preferBeforeSha !== undefined) {
      const matching = candidates.filter((c) => c.match.binding.before_sha256 === opts.preferBeforeSha);
      if (matching.length > 0)
        pool = matching;
    }
    let best = pool[0];
    for (const c of pool) {
      if (c.issuedScore > best.issuedScore)
        best = c;
    }
    return best.match;
  }
  async reapExpired() {
    let names;
    try {
      names = await fs8.readdir(this.grantsDir);
    } catch (e) {
      if (e.code === "ENOENT")
        return 0;
      throw e;
    }
    let removed = 0;
    const now = Date.now();
    for (const name of names) {
      if (!name.endsWith(".json"))
        continue;
      const filePath = path9.join(this.grantsDir, name);
      let text;
      try {
        text = await fs8.readFile(filePath, "utf8");
      } catch (e) {
        if (e.code === "ENOENT")
          continue;
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      if (!isGrant(parsed))
        continue;
      if (Date.parse(parsed.expires_at) > now)
        continue;
      try {
        await fs8.unlink(filePath);
        removed++;
      } catch (e) {
        if (e.code === "ENOENT")
          continue;
      }
    }
    return removed;
  }
}
function createGrantsStore(repoRoot) {
  return new GrantsStoreImpl(repoRoot);
}

// src/opencode/tool-name-map.ts
var OPENCODE_TO_CANONICAL = Object.freeze({
  edit: "Edit",
  write: "Write",
  apply_patch: "apply_patch"
});
function isOpencodeRawEditTool(name) {
  if (typeof name !== "string")
    return false;
  return Object.prototype.hasOwnProperty.call(OPENCODE_TO_CANONICAL, name.toLowerCase());
}
function toCanonicalRawEditName(name) {
  if (typeof name !== "string")
    return null;
  const key = name.toLowerCase();
  return key in OPENCODE_TO_CANONICAL ? OPENCODE_TO_CANONICAL[key] ?? null : null;
}

// src/opencode/plugin.ts
function createMetaEditPlugin(deps = {}) {
  const newEditLog = deps.newEditLog ?? ((root) => new EditLog(root));
  const newGrantsStore = deps.newGrantsStore ?? createGrantsStore;
  const skillContent = deps.skillContent ?? loadDefaultSkillContent();
  return async (ctx) => {
    const repoRoot = ctx.project.worktree;
    const log = newEditLog(repoRoot);
    const grants = newGrantsStore(repoRoot);
    const pendingReminders = new Map;
    const onToolBefore = async (input, output) => {
      const lower = typeof input.tool === "string" ? input.tool.toLowerCase() : "";
      if (isOpencodeRawEditTool(lower)) {
        const canonical = toCanonicalRawEditName(lower);
        if (canonical === null) {
          throwAbort(`meta-edit opencode plugin: tool "${input.tool}" passed isOpencodeRawEditTool but failed toCanonicalRawEditName — map/predicate drift; please report.`, output);
          return;
        }
        const rawInput = mapOpencodeArgsToRawToolInput(canonical, output.args);
        let decision;
        try {
          decision = await evaluateTokenedEdit({
            toolName: canonical,
            toolInput: rawInput,
            repoRoot,
            grants,
            log
          });
        } catch (e) {
          throwAbort(`meta-edit opencode plugin errored on ${canonical}: ${e.message}`, output);
        }
        if (decision.decision === "deny") {
          throwAbort(decision.reason ?? "denied by meta-edit", output);
        }
        if (decision.decision === "warn") {
          process.stderr.write(`[meta-edit] WARN (${canonical}): ${decision.reason ?? "warned by meta-edit"}
`);
        }
        if (decision.decision === "allow" && decision.additionalContext !== undefined) {
          if (typeof input.callID === "string" && input.callID.length > 0) {
            pendingReminders.set(input.callID, decision.additionalContext);
          } else {
            process.stderr.write(`[meta-edit] CONTEXT (${canonical}): ${decision.additionalContext}
`);
          }
        }
        return;
      }
      if (lower === "bash") {
        const command = typeof output.args["command"] === "string" ? output.args["command"] : "";
        const decision = evaluateBashCommand(command, { cwd: repoRoot });
        if (decision.decision === "deny") {
          throwAbort(decision.reason ?? "denied by meta-edit", output);
        }
        return;
      }
    };
    const onSystemTransform = (_input, output) => {
      output.system.push(skillContent);
    };
    const onToolAfter = (input, output) => {
      const callID = typeof input.callID === "string" ? input.callID : "";
      if (callID.length === 0)
        return;
      const reminder = pendingReminders.get(callID);
      if (reminder === undefined)
        return;
      pendingReminders.delete(callID);
      if (typeof output.output !== "string")
        return;
      output.output = output.output.length > 0 ? `${output.output}

${reminder}` : reminder;
    };
    return {
      "tool.execute.before": onToolBefore,
      "tool.execute.after": onToolAfter,
      "experimental.chat.system.transform": onSystemTransform
    };
  };
}
var MetaEditPlugin = createMetaEditPlugin();
var plugin_default = MetaEditPlugin;
function mapOpencodeArgsToRawToolInput(canonical, args) {
  const filePath = pickString(args, "file_path") ?? pickString(args, "filePath") ?? undefined;
  const oldString = pickString(args, "old_string") ?? pickString(args, "oldString") ?? undefined;
  const newString = pickString(args, "new_string") ?? pickString(args, "newString") ?? undefined;
  const content = args["content"];
  const edits = args["edits"];
  const out = {};
  if (filePath !== undefined)
    out.file_path = filePath;
  if (oldString !== undefined)
    out.old_string = oldString;
  if (newString !== undefined)
    out.new_string = newString;
  if (content !== undefined)
    out.content = content;
  if (edits !== undefined)
    out.edits = edits;
  return out;
}
function pickString(args, key) {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}
function summarizeReasonForOpencode(reason) {
  const noBackticks = reason.replace(/`/g, "");
  const jp = noBackticks.match(/^[\s\S]*?。/);
  let firstSentence;
  if (jp) {
    firstSentence = jp[0];
  } else {
    const en = noBackticks.match(/^[\s\S]*?\.(?=\s+[A-Z])/);
    firstSentence = en ? en[0] : noBackticks;
  }
  if (firstSentence.length <= 160)
    return firstSentence;
  return firstSentence.slice(0, 157) + "...";
}
function throwAbort(reason, output) {
  output.aborted = true;
  throw new Error(summarizeReasonForOpencode(reason));
}
var FALLBACK_ONBOARDING_POINTER = [
  "meta-edit MCP server is registered for this project.",
  "Use the typed_edit_* MCP tools — raw edit / write / apply_patch " + "calls are denied by the meta-edit pre-tool hook unless preceded " + "by a typed_edit declaration. Empty-content writes for new files " + "are authorized as a free path.",
  "(typed-edit-onboarding SKILL.md was not found in the installed " + "package; agent guidance is operating in fallback mode.)"
].join(" ");
function loadDefaultSkillContent() {
  try {
    const raw = fs9.readFileSync(defaultSkillSourcePath(), "utf8");
    return stripFrontmatter(raw).trimStart();
  } catch {
    return FALLBACK_ONBOARDING_POINTER;
  }
}
function defaultSkillSourcePath() {
  const here = path10.dirname(fileURLToPath(import.meta.url));
  let cur = here;
  for (let i = 0;i < 4; i++) {
    const candidate = path10.join(cur, "skills", "typed-edit-onboarding", "SKILL.md");
    if (fs9.existsSync(candidate))
      return candidate;
    const parent = path10.dirname(cur);
    if (parent === cur)
      break;
    cur = parent;
  }
  return path10.join(here, "..", "..", "skills", "typed-edit-onboarding", "SKILL.md");
}
function stripFrontmatter(text) {
  if (!text.startsWith("---"))
    return text;
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!m)
    return text;
  return text.slice(m[0].length);
}
export {
  summarizeReasonForOpencode,
  stripFrontmatter,
  loadDefaultSkillContent,
  plugin_default as default,
  createMetaEditPlugin,
  FALLBACK_ONBOARDING_POINTER
};

//# debugId=3E104066A8E8415464756E2164756E21
