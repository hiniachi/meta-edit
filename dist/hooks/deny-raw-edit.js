#!/usr/bin/env node
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

// src/hooks/deny-raw-edit.ts
import * as path8 from "node:path";

// src/hooks/hook-runtime.ts
async function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim().length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    process.stdin.on("error", reject);
  });
}
function replyAllow() {
  process.stdout.write("");
  return 0;
}
function replyDeny(reason) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
  process.stdout.write(JSON.stringify(payload));
  return 0;
}
function replyAllowWithWarning(reason) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: reason,
      additionalContext: reason
    }
  };
  process.stdout.write(JSON.stringify(payload));
  process.stderr.write(`[meta-edit] ${reason}
`);
  return 0;
}

// src/hooks/raw-edit-policy.ts
import * as crypto3 from "node:crypto";
import * as fs6 from "node:fs/promises";
import * as path6 from "node:path";

// src/state/edit-log.ts
import * as crypto2 from "node:crypto";
import * as fs5 from "node:fs";
import * as path5 from "node:path";

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
import * as fs4 from "node:fs";
import * as path4 from "node:path";

// src/tools/descriptions.ts
var TOOL_NAMES = [
  "edit_refactor_only",
  "edit_test_only_change",
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
  "edit_policy_change",
  "edit_docs_only"
];
var TOOLS_REQUIRING_TEST_FILES = TOOL_NAMES.filter((name) => name !== "edit_refactor_only" && name !== "edit_test_only_change" && name !== "edit_docs_only");
var TOOL_DESCRIPTIONS = {
  edit_refactor_only: `Refactor production code without changing observable behavior.

Use this tool when:
- Renaming variables, functions, or types
- Extracting helpers without changing call sites' observable behavior
- Reorganizing file or module structure
- Reformatting beyond what the formatter does
- Simplifying expressions while preserving evaluation results

Required tests: NONE (existing tests must continue to pass).
test_files may be empty.

This tool MUST NOT be used when the patch contains any of the following.
If your patch contains any of these, choose a more specific edit_* tool:

- Comparison operator changes (<, <=, >, >=, ==, !=)
- Boolean operator changes (&&, ||, !)
- Guard clauses or early returns being added or removed
- Return value structure changes (new fields, removed fields, reordered tuple)
- Throw / catch / error type changes
- Database read or write operations changes
- Event / job / webhook / email / billing call additions or removals
- Serializer, parser, or schema changes
- Permission / role / owner / tenant / feature flag reference changes
- Timeout / retry / backoff changes
- Cache key / TTL / invalidation changes
- Concurrency primitives (lock, transaction, mutex) changes

If you are unsure whether your change qualifies as refactor-only, choose a
more specific tool. False precision is safer than false generality. Misusing
this tool is the largest source of regression bugs in AI-generated code.

Fallback obligation:
If, after applying this tool, you discover that your patch did
contain any of the change kinds listed above (comparison change,
boolean change, guard clause, error-handling change, etc.), you
owe the user a follow-up explanation in your next message: name
what slipped in, and say why the typed surface didn't catch it
before you applied. This is a personal debt that posts to the
user, not a detection bypass — acknowledging the slip is what
keeps the typed surface honest.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_test_only_change: `Add or modify test code only. No production code changes are allowed.

Use this tool when:
- Adding new test cases for existing behavior
- Strengthening assertions in existing tests
- Refactoring test fixtures or helpers
- Removing flaky or duplicated tests
- Filling content into a freshly-created (currently empty) test file:
  empty files are created freely without an MCP declaration (see SPEC §5);
  the content fill goes through this tool

Required: patch must only modify a single file — the \`target_file\` you
declare as a test file. test_files must be empty. The server does not
pattern-match the target path against any naming convention; choosing
this tool is itself your declaration that the change is test-only. The
obligation is tool selection, not server-side classification.

Recommended assertion practice:
- Each test must contain at least one explicit assert / expect
- Snapshot-only tests are discouraged unless you have a documented reason
  for snapshot semantics
- Tests that only check "no exception was thrown" should also check the
  actual return value or side effect

This tool is the standard way to fulfill testing obligations created by
other edit_* tools. After making a non-trivial change with another edit_*
tool, your next action is typically one or more edit_test_only_change calls
covering the obligations stated in the prior tool's description.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_boundary_condition: `Modify a comparison, threshold, limit, or boundary in production code.

Use this tool when:
- Changing comparison operators (<, <=, >, >=, ==, !=)
- Changing numeric limits or thresholds (max, min, cap, floor, ceiling)
- Changing range bounds (loop bounds, array sizes, page sizes)
- Changing pagination, rate limit, timeout duration, retry count
- Changing buffer or window sizes

Required tests (you MUST cover all three of these per boundary):
1. Value just below the boundary (boundary - 1, or just-outside)
2. Value exactly at the boundary
3. Value just above the boundary (boundary + 1, or just-inside)

These three cases are non-negotiable. Off-by-one errors are the most common
bug class in this category, and SQLite testing methodology treats boundary
tests as a hard requirement. If your change has multiple boundaries
(e.g., both a min and a max), all three cases must be tested for each
boundary.

If you cannot enumerate all three boundary values for this change, the
boundary semantics are unclear. Stop and ask the user to clarify which
value should be inclusive and which should be exclusive, before applying
the edit.

test_files must list at least one file where these three cases will be
added. Existing test files are acceptable.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_boolean_condition: `Modify a boolean expression, conditional logic, or guard clause in
production code.

Use this tool when:
- Changing boolean operators (&&, ||, !)
- Adding or removing conditions in an if / else / switch
- Adding or removing guard clauses or early returns
- Changing the structure of conditional branching
- Changing null / nil / undefined checks

Required tests (you MUST cover):
1. Each path through the new conditional must have at least one test
   that takes that path
2. For each atomic condition that was changed (e.g., changing \`a && b\` to
   \`a && b && c\`), there must be a test where that atomic condition
   independently determines the outcome
3. Boolean inversion: at least one test where the change in logic produces
   a different observable result than the old logic would have

The third requirement is the test that proves your edit was meaningful.
If no test exists that distinguishes the new behavior from the old, the
edit is either a no-op or insufficiently tested. Either is a problem.

This is a lightweight version of MC/DC (Modified Condition / Decision
Coverage). Full MC/DC is not required, but the spirit of "each condition
independently affects outcome" is.

If the boolean change is purely a refactor (e.g., De Morgan's law applied
without changing truth values), use edit_refactor_only instead.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_state_transition: `Modify a state machine, workflow, or status transition in production code.

Use this tool when:
- Adding, removing, or modifying allowed transitions between states
- Changing what triggers a state transition
- Adding or removing valid states
- Changing the side effects that occur on transition

Required tests (you MUST cover):
1. Allowed transitions: each new or modified allowed transition must have
   a test that performs it and verifies the resulting state
2. Forbidden transitions: each transition that should NOT be allowed must
   have a test that attempts it and verifies it is rejected (and that no
   partial state change occurred)
3. Invalid input no-op: triggering a transition from an invalid state must
   not produce a partial state change

State transition bugs are particularly insidious because they often
manifest only under specific orderings of events. The forbidden-transition
tests are as important as the allowed-transition tests.

If your change adds new states, you must also test transitions from
existing states into the new states, and from the new states to existing
states (where allowed).

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_db_schema: `Modify database schema: tables, columns, indexes, constraints, migrations.

Use this tool when:
- Adding, removing, or modifying columns, tables, indexes
- Changing constraints (NOT NULL, UNIQUE, FOREIGN KEY, CHECK)
- Creating or modifying migration files (DDL)
- Changing collation, charset, or storage parameters

Required tests (you MUST cover):
1. Migration application: the migration must apply cleanly to a schema in
   the previous state
2. Existing data compatibility: the migration must not corrupt or lose
   existing data. Provide test fixtures that exist before the migration
   and verify they are accessible after
3. Rollback OR forward-only justification: either provide a tested
   down-migration, or document explicitly in rationale why this migration
   is forward-only and how recovery would work
4. Index / constraint behavior: any new index must have a test
   demonstrating it is used; any new constraint must have a test showing
   both accepted and rejected inputs

Schema changes are infrastructural and rarely revertible in production.
The rollback question is not optional — answer it explicitly even if the
answer is "no rollback, here's why."

If your change modifies existing data (UPDATE statements, data backfills),
you MUST also use edit_data_migration alongside this tool.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_data_migration: `Modify production data through migration scripts, backfills, or
data-transformation code.

Use this tool when:
- Backfilling data into new columns
- Transforming or normalizing existing data
- Correcting bad data through scripted updates
- Splitting or merging records

Required tests (you MUST cover):
1. Idempotency: running the migration twice must produce the same result
   as running it once
2. Partial failure recovery: if the migration fails partway through, the
   remaining work must be safely re-runnable
3. Existing fixture transformation: provide concrete examples of
   pre-migration data and verify they are correctly transformed
4. Edge cases: NULL values, empty strings, maximum-length values,
   already-migrated rows

Data migrations are one-way operations on production data. Test them as
thoroughly as production code, ideally more so. The idempotency test is
the single most important one — write it first.

For long-running migrations, also consider testing chunked execution and
verifying that an interrupted-then-resumed migration completes correctly.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_api_contract: `Modify the request or response shape of an API: endpoints, fields, status
codes, schemas.

Use this tool when:
- Adding, removing, or renaming fields in API request or response
- Changing field types or formats
- Changing status codes returned for given conditions
- Adding or removing endpoints
- Modifying OpenAPI / GraphQL / gRPC schema files

Required tests (you MUST cover):
1. Backward compatibility: existing clients (including older versions)
   must continue to work, or the breaking change must be explicitly
   acknowledged in rationale
2. Missing field: request with the new field absent must behave correctly
   (default value, error, or fallback as documented)
3. Extra field: request with unknown extra fields must behave correctly
   (typically ignored, but verify)
4. Status code: each status code path that this change affects must have
   a test verifying the correct code is returned

API contract changes affect every consumer. The backward compatibility
test is the most important — name it explicitly and write it first.

If the change is a breaking change, the rationale field must say so
explicitly, e.g., "Breaking change: removing the deprecated \`legacyId\`
field. Migration plan: ..."

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_serialization: `Modify a serializer, parser, codec, or data format handler.

Use this tool when:
- Changing JSON / YAML / XML / Protobuf / MessagePack handling
- Modifying custom binary or text formats
- Changing how data is encoded for storage or transport
- Modifying compatibility layers between format versions

Required tests (you MUST cover):
1. Round-trip: serialize then deserialize, verify equivalence
2. Read old format: the new code must be able to read data produced by
   the previous version
3. Write new format: produced output must be readable by the new parser,
   and ideally by tools that consume this format
4. Invalid input: malformed input must be rejected with a clear error,
   not silently corrupted

Format compatibility bugs are particularly painful because they tend to
be discovered only when production data is already in the new format and
cannot be read by anything. The "read old format" test is the safety net.

If the format change is intentionally non-backward-compatible, the
rationale must say so and describe the migration path for existing data.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_error_handling: `Modify how errors, exceptions, or failure paths are handled.

Use this tool when:
- Adding, removing, or modifying try / catch blocks
- Changing what exceptions are thrown or how they propagate
- Modifying fallback or retry logic on failure
- Changing rollback behavior on partial success
- Changing what is logged or reported on error

Required tests (you MUST cover):
1. Failure path executes: trigger the error condition and verify the new
   handling code runs
2. Observable error: the caller (or user, or log) must see an appropriate
   error indicator. Silent failures are forbidden
3. State after failure: any partial state changes must be either rolled
   back or explicitly documented as accepted partial state
4. Error type / code: if specific error types or codes are part of the
   contract, verify the correct one is produced

Silent failure — a catch block that doesn't re-throw, log, or otherwise
expose the error — is almost certainly a bug. Add at least one test that
verifies the error is observable.

Swallowing exceptions is forbidden unless the rationale explicitly states
why and what the recovery path is.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_retry_timeout: `Modify retry, timeout, or backoff behavior.

Use this tool when:
- Changing retry counts, retry intervals, or backoff strategies
- Modifying timeout durations
- Adding or removing retry logic
- Changing idempotency keys or duplicate-detection logic

Required tests (you MUST cover):
1. Timeout exhaustion: when the timeout is exceeded, the operation fails
   with the expected error and does not hang
2. Retry exhaustion: when all retries are consumed, the operation fails
   with the expected error and reports the underlying cause
3. No duplicate side effects: retries must not produce duplicate external
   side effects (emails, charges, database writes), unless idempotency is
   documented as not required for this operation
4. Success on retry: if the underlying operation succeeds on a retry
   attempt, the overall call must report success

The duplicate-side-effect test is the one that catches the worst bugs.
If your code retries an HTTP POST that creates a record, verify that two
records are not created when the first attempt times out but actually
succeeded server-side.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_concurrency: `Modify concurrency primitives: locks, transactions, mutexes, parallelism,
race conditions.

Use this tool when:
- Adding, removing, or modifying locks (mutex, RWLock, semaphore)
- Changing transaction boundaries or isolation levels
- Modifying parallel execution (async, threads, goroutines)
- Changing lock ordering or scope
- Adding or removing critical sections

Required tests (you MUST cover):
1. Concurrent execution: multiple invocations in parallel must produce a
   consistent final state
2. Race prevention: a sequence that would race without the new primitives
   must produce a correct result with them
3. Transaction or lock scope: assertions about what is or is not atomic
   must be tested

Concurrency tests are notoriously hard to write reliably. If your test
framework supports controlled scheduling (e.g., loom in Rust, or property-
based testing with race scheduling), use it. Otherwise, loop the test
many times under stress and treat any failure as a bug.

If you cannot reproduce the race or contention this change addresses,
the change is speculative. Prefer to demonstrate the bug with a failing
test before applying the fix.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_external_side_effect: `Modify code that produces external side effects: emails, events, queue
messages, webhooks, billing operations, audit logs.

Use this tool when:
- Adding, removing, or modifying calls that affect external systems
- Changing what events are emitted or to whom
- Modifying billing or payment-affecting logic
- Changing notification logic
- Adding or removing audit or compliance logging

Required tests (you MUST cover):
1. Side effect fires on success: when the conditions for the side effect
   are met, the side effect occurs (with correct payload)
2. Side effect does NOT fire on failure: when the operation fails, no
   spurious external effect is produced
3. Idempotency: if the operation is retried (network failure, duplicate
   request), the side effect occurs at most once
4. Correct recipient / payload: the side effect targets the right
   external system with the right data

The "no spurious side effect on failure" test is the most important one
for billing, email, and audit code. Send-money-but-fail-to-record is the
textbook AI-generated billing bug.

For test environments, side effects MUST be mocked or routed to a test
sink. Verify that the test does not actually charge a card or send a
real email. If your test makes a real external call, your test is wrong.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_cache_invalidation: `Modify cache keys, TTLs, invalidation logic, or staleness handling.

Use this tool when:
- Changing cache key generation
- Modifying TTL or expiration logic
- Adding or removing invalidation triggers
- Changing what is cached or where

Required tests (you MUST cover):
1. Stale data prevention: after an invalidation event, the next read must
   return fresh data, not the cached stale value
2. Invalidation triggers: the events that should invalidate the cache
   must be tested explicitly
3. TTL boundary: behavior just before, at, and after expiration (this is
   also a boundary_condition pattern — be explicit)
4. Cache key collision: keys for different data must not collide

Cache bugs typically manifest as "wrong data shown to user" or "stale
data persisted to a downstream system". Both are silent until reported
by users, which is too late. Test invalidation explicitly.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_permission_logic: `Modify authorization, access control, role checks, ownership checks,
tenancy, or feature flag gating.

Use this tool when:
- Changing role / permission / owner / tenant / feature flag checks
- Modifying access control predicates
- Changing the subject-action-resource matrix
- Modifying authentication state checks
- Changing API key, token, or session validation

Required tests (you MUST cover):
1. Allow matrix: enumerate the (subject, resource) pairs that should be
   allowed, and test each one
2. Deny matrix: enumerate the (subject, resource) pairs that should be
   denied, and test each one
3. Negative side-effect: when access is denied, no database write, no
   event emission, no external call, no state mutation must occur. Test
   this explicitly with a deny case
4. Edge cases: suspended user, expired token, missing role, deleted
   resource — each must have a test

Permission bugs are silent failures that compromise data integrity, user
trust, and regulatory compliance. They cannot be caught by ordinary smoke
tests, because the system continues to function — it just authorizes the
wrong people.

If you cannot enumerate the allow matrix and the deny matrix for this
change, the change is too risky to apply without further specification.
Stop and ask for the matrix to be confirmed before proceeding.

The negative side-effect test (test 3) is the one that catches the worst
bugs. A permission check that returns false but still writes to the
database is a permission bypass. Test it.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_dependency_config: `Modify package dependencies, runtime configuration, or feature
configuration files.

Use this tool when:
- Adding, removing, or upgrading package dependencies
- Modifying runtime config (env vars, config files)
- Changing feature flag default values
- Modifying build or deploy configuration that affects runtime behavior

Required tests (you MUST cover):
1. Build / install reproducibility: the new configuration must produce a
   working build from a clean state
2. Behavior under new config: at least one test exercises code paths
   affected by the configuration change
3. Default value: if a default is changed, both the old and new default
   behaviors must be tested (the new default for the new code, the old
   default for backward compatibility verification)

Dependency upgrades are a common source of subtle regressions. If a
dependency is upgraded, run the existing test suite and verify no
behavior change in covered paths. If you observe a behavior change,
document it explicitly — do not silently absorb it.

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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_policy_change: `Modify the meta-edit configuration itself: hooks, Claude permissions,
CI configuration, this server's behavior, or the tool descriptions of
edit_* tools.

Use this tool when:
- Modifying .claude/ configuration
- Modifying .github/workflows/ files that affect meta-edit
- Modifying AI-instruction files (CLAUDE.md, AGENTS.md, .cursor/rules, etc.)
- Modifying tool descriptions of edit_* tools themselves
- Modifying argument schemas or hook behavior
- Modifying build / release profile flags in package manifests
  (\`[profile.release]\` in Cargo.toml, \`[tool.poetry.build]\` in
  pyproject.toml, \`scripts\` / \`engines\` mutations in package.json
  that change how the project builds or releases) — see the boundary
  note in edit_dependency_config

Required tests (you MUST cover):
1. Configuration validity: the new configuration must parse and load
   without error
2. Existing edit log entries must remain readable under the new
   configuration
3. The new configuration must be applicable from a clean checkout (no
   hidden dependencies on local state)

Policy changes are at a higher trust boundary than ordinary code. This
tool exists to mark them clearly in the edit log so they can be reviewed
separately.

Policy changes that LOOSEN restrictions (allowing previously-denied
operations, reducing test obligations, removing obligations from edit_*
tool descriptions) require an explicit justification in rationale that
explains why the loosening is safe. "Convenience" is not an acceptable
rationale.

If your change loosens a restriction without a strong justification, do
not use this tool. Reconsider whether the restriction was correct in the
first place.

Fallback obligation:
Before applying this tool, ask the user a clarifying question
about the intended scope of the policy change, even when the
change feels obvious. A single confirmation message is the cost
of the safer path. Loosening restrictions, modifying hook
behavior, and editing tool descriptions all carry implications
the user has the standing to weigh; do not assume.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
  edit_docs_only: `Modify documentation, README, comments, or other narrative content
that does not affect runtime behavior.

Use this tool when:
- Editing Markdown files (README, docs/, *.md)
- Editing inline code comments
- Editing JSDoc / docstrings / Rustdoc that document existing API
- Editing changelogs, release notes, contribution guides
- Editing project meta-documentation (CHANGELOG, ROADMAP, post-mortems)
- Filling content into a freshly-created (currently empty) Markdown file:
  issues/*.md, ADRs, design docs, post-mortems, dogfood reports.
  Empty files are created freely without an MCP declaration (see SPEC §5);
  the content fill goes through this tool.

Required tests: NONE. test_files may be empty.

Recommended verifications (not enforced):
- Internal links resolve
- Code blocks (if any) are syntactically valid in their stated language
- Terminology is consistent with the rest of the project documentation
- No accidental references to renamed APIs or removed features

This tool MUST NOT be used when:
- The patch modifies any executable production code
- The patch modifies test code (use edit_test_only_change)
- The patch modifies build, CI, or meta-edit configuration
  (use edit_dependency_config or edit_policy_change)
- The "documentation" change actually changes API contracts
  documented in code (use edit_api_contract)
- The patch updates README / docs to claim functionality that has not
  yet shipped — describing future or aspirational behavior misleads
  every future reader (including AI agents). Land the implementation
  in the same change set or wait
- The patch updates a CHANGELOG entry for a release that this commit
  does not actually cut (CHANGELOG must reflect what merged, not what
  is queued)
- The patch contains a code example (fenced block, inline snippet)
  that does not compile or run as written; broken examples mislead
  readers more than no example
- The patch updates a Markdown test fixture loaded by tests at runtime
  (use edit_test_only_change since the fixture's content is part of
  the test contract)
- The patch batches unrelated documentation changes across multiple
  files in one declaration; each independent doc surface gets its own
  edit_docs_only call so the rationale and audit trail stay tied to
  the actual reason

Rationale: documentation changes have a different risk profile from
code refactors. They cannot break runtime behavior, but they can
mislead future readers (including future AI agents). Treat
documentation as a contract with future readers.

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

// src/tools/repo-validity.ts
import * as fs3 from "node:fs";
import * as path3 from "node:path";
function repoIsValid(dir) {
  const sentinels = [".git", ".jj"];
  const found = sentinels.some((s) => fs3.existsSync(path3.join(dir, s)));
  if (found)
    return { ok: true };
  return {
    ok: false,
    error: `meta-edit: "${dir}" does not appear to be a repository root ` + `(no .git or .jj directory found). ` + `Run \`git init\` in this directory or restart the MCP server with ` + `--repo-root pointed at the actual repository root.`
  };
}

// src/tools/common.ts
var RiskLevelSchema = exports_external.enum(["low", "medium", "high", "critical"]);
var AdditionalFileSchema = exports_external.object({
  file: exports_external.string().min(1)
}).strict();
var MAX_ADDITIONAL_FILES = 32;
var TOOLS_ACCEPTING_ADDITIONAL_FILES = [
  "edit_docs_only"
];
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
  test_files: exports_external.preprocess(coerceJsonStringToArray("test_files"), exports_external.array(exports_external.string())),
  additional_files: exports_external.preprocess(coerceJsonStringToArray("additional_files"), exports_external.array(AdditionalFileSchema).max(MAX_ADDITIONAL_FILES)).optional()
}).strict();
function sha256Hex(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}
var SHA256_EMPTY = sha256Hex("");
function validateRequest(toolName, request, ctx) {
  const warnings = [];
  const repoCheck = repoIsValid(ctx.repoRoot);
  if (!repoCheck.ok) {
    return { ok: false, warnings: [repoCheck.error] };
  }
  if (request.rationale.trim().length === 0) {
    warnings.push("rationale must be non-empty");
  }
  if (toolName === "edit_test_only_change") {
    if (request.test_files.length > 0) {
      warnings.push("test_files must be empty for edit_test_only_change");
    }
  } else if (TOOLS_REQUIRING_TEST_FILES.includes(toolName)) {
    if (request.test_files.length === 0) {
      warnings.push(`test_files must be non-empty for ${toolName}`);
    }
  }
  if (request.additional_files !== undefined && !TOOLS_ACCEPTING_ADDITIONAL_FILES.includes(toolName)) {
    warnings.push(`${toolName} does not accept additional_files; this field is reserved for ` + `the workflow tool (edit_docs_only). Submit each ` + `file as its own typed_edit call.`);
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
  return { ok: true, primaryBinding, additionalBindings };
}
function checkPathSafety(p, repoRoot) {
  if (path4.isAbsolute(p)) {
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
  let norm;
  try {
    norm = normalizeRepoRelative(p);
  } catch (err) {
    return {
      ok: false,
      error: `path "${p}" is invalid: ${err.message}`
    };
  }
  if (norm.length === 0) {
    return { ok: false, error: "path is empty after normalization" };
  }
  const lexicalRoot = path4.resolve(repoRoot);
  const lexicalResolved = path4.resolve(lexicalRoot, norm);
  if (lexicalResolved !== lexicalRoot && !lexicalResolved.startsWith(lexicalRoot + path4.sep)) {
    return { ok: false, error: `path "${p}" escapes repository root` };
  }
  const realRoot = realpathOrSelf(lexicalRoot);
  const realResolved = realpathOfDeepestExisting(lexicalResolved);
  if (realResolved === null) {
    return {
      ok: false,
      error: `path "${p}" could not be canonicalized via realpath; failing closed`
    };
  }
  if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path4.sep)) {
    return {
      ok: false,
      error: `path "${p}" escapes repository root after symlink resolution`
    };
  }
  const canonical = normalizeRepoRelative(path4.relative(realRoot, realResolved));
  if (canonical.length === 0) {
    return { ok: false, error: `path "${p}" resolves to the repository root` };
  }
  if (isProtectedPath(canonical)) {
    return {
      ok: false,
      error: `path "${p}" resolves into a protected directory (.meta-edit/state/ or .meta-edit/tmp/)`
    };
  }
  return { ok: true, canonical };
}
function realpathOrSelf(p) {
  try {
    return fs4.realpathSync(p);
  } catch {
    return p;
  }
}
function containsParentTraversal(p) {
  for (const seg of p.split(/[\\/]/)) {
    if (seg === "..")
      return true;
  }
  return false;
}
function computeBeforeSha256(canonical, repoRoot, fieldLabel) {
  const absolute = path4.join(repoRoot, canonical);
  let onDisk = null;
  try {
    onDisk = fs4.readFileSync(absolute, "utf8");
  } catch (e) {
    const code = e?.code;
    if (code === "ENOENT") {
      return {
        ok: false,
        error: `${fieldLabel} "${canonical}" does not exist on disk. ` + `v0.3.1 expects you to create the empty file first via a ` + `native Write with content === "" (no MCP declaration needed; ` + `the deny-raw-edit hook authorizes empty creates and auto-mkdirs ` + `parent directories), THEN declare the typed_edit for the content fill.`
      };
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
var IssuedEntrySchema = exports_external.object({
  edit_id: exports_external.string(),
  ts: exports_external.string(),
  phase: exports_external.literal("issued"),
  kind: exports_external.string(),
  target_file: exports_external.string(),
  rationale: exports_external.string(),
  risk_level: RiskLevelSchema,
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
    this.statePath = path5.join(repoRoot, ".meta-edit", "state");
    this.logPath = path5.join(this.statePath, "edits.jsonl");
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
    const O_NOFOLLOW = fs5.constants.O_NOFOLLOW;
    if (typeof O_NOFOLLOW !== "number" || O_NOFOLLOW === 0) {
      throw new Error("this platform does not expose O_NOFOLLOW; meta-edit refuses to append to the edit log without symlink-leaf protection");
    }
    this.withFileLock(() => {
      let fd = null;
      try {
        fd = fs5.openSync(this.logPath, fs5.constants.O_WRONLY | fs5.constants.O_APPEND | fs5.constants.O_CREAT | O_NOFOLLOW, 384);
        fs5.writeSync(fd, line, null, "utf8");
      } finally {
        if (fd !== null) {
          try {
            fs5.closeSync(fd);
          } catch {}
        }
      }
    });
  }
  ensureStateDir() {
    ensureNoSymlinkOnPath(this.statePath);
    fs5.mkdirSync(this.statePath, { recursive: true, mode: 448 });
    if (process.platform !== "win32") {
      fs5.chmodSync(this.statePath, 448);
    }
  }
  withFileLock(fn) {
    const lockPath = path5.join(this.statePath, ".lock");
    const start = Date.now();
    const TIMEOUT_MS = 30000;
    while (true) {
      try {
        fs5.mkdirSync(lockPath);
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
        fs5.rmdirSync(lockPath);
      } catch {}
    }
  }
  readCounterFile(key) {
    const counterPath = path5.join(this.statePath, "counter.json");
    let text;
    try {
      text = fs5.readFileSync(counterPath, "utf8");
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
    const counterPath = path5.join(this.statePath, "counter.json");
    const payload = JSON.stringify({ [key]: value });
    try {
      const lst = fs5.lstatSync(counterPath);
      if (lst.isSymbolicLink()) {
        throw new Error(`refusing to use edit-log path: "${counterPath}" is a symlink. The audit-log counter must not be redirected through a symlink.`);
      }
    } catch (e) {
      const code = e.code;
      if (code !== "ENOENT")
        throw e;
    }
    const O_NOFOLLOW = fs5.constants.O_NOFOLLOW;
    if (typeof O_NOFOLLOW !== "number" || O_NOFOLLOW === 0) {
      throw new Error("this platform does not expose O_NOFOLLOW; meta-edit refuses to write the audit-log counter without symlink-leaf protection");
    }
    let fd = null;
    try {
      fd = fs5.openSync(counterPath, fs5.constants.O_WRONLY | fs5.constants.O_CREAT | fs5.constants.O_TRUNC | O_NOFOLLOW, 384);
      fs5.writeSync(fd, payload, null, "utf8");
    } finally {
      if (fd !== null) {
        try {
          fs5.closeSync(fd);
        } catch {}
      }
    }
  }
  readAll() {
    let text;
    try {
      text = fs5.readFileSync(this.logPath, "utf8");
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
      text = fs5.readFileSync(this.logPath, "utf8");
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
  const absDir = path5.resolve(maybeRelativeDir);
  const segments = absDir.split(path5.sep).filter((s) => s.length > 0);
  let cur = path5.sep;
  for (const seg of segments) {
    cur = path5.join(cur, seg);
    let stat;
    try {
      stat = fs5.lstatSync(cur);
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
      reason: `meta-edit denies raw "${toolName}"; use a typed edit_* MCP tool. ` + `If the typed_edit tool schemas are not loaded in your tool list, use ToolSearch (e.g. query \`mcp meta-edit edit\` or \`select:mcp__plugin_meta-edit_meta-edit__edit_refactor_only\`) to load the relevant schema before declaring.`
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
      reason: `meta-edit denies "apply_patch": its unified-diff input has no top-level file_path to bind a typed_edit declaration against. ` + `Use the opencode \`edit\` or \`write\` tool (which DO carry file_path) after a typed_edit declaration, or invoke a typed edit_* MCP tool directly. ` + `If the typed_edit tool schemas are not loaded in your tool list, use ToolSearch (e.g. query \`mcp meta-edit edit\` or \`select:mcp__plugin_meta-edit_meta-edit__edit_refactor_only\`) to load the relevant schema before declaring.`
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
    const absPath = path6.isAbsolute(pathRaw) ? pathRaw : path6.join(repoRoot, pathRaw);
    let exists = true;
    try {
      await fs6.stat(absPath);
    } catch (e) {
      if (e.code === "ENOENT") {
        exists = false;
      }
    }
    if (!exists) {
      try {
        await fs6.mkdir(path6.dirname(absPath), { recursive: true });
      } catch {}
      return {
        decision: "warn",
        reason: "empty file create authorized without typed_edit declaration. " + "For the actual content, declare an appropriate edit_<TYPE> next " + "(e.g. edit_state_transition / edit_boundary_condition for source code, " + "edit_docs_only for Markdown / docs, edit_test_only_change for new tests)."
      };
    }
  }
  const canonical = canonicalizeForBinding(pathRaw, repoRoot);
  if (canonical === null) {
    return {
      decision: "deny",
      reason: `meta-edit could not canonicalize "${pathRaw}" to a repository-relative path; failing closed.`
    };
  }
  const match = await grants.findActiveBindingForFile(canonical);
  if (match === null) {
    return {
      decision: "deny",
      reason: `meta-edit denies "${toolName}" for "${canonical}": no active typed_edit declaration covers this file. ` + `Call a typed edit_* MCP tool first. ` + `If the typed_edit tool schemas are not loaded in your tool list, use ToolSearch (e.g. query \`mcp meta-edit edit\` or \`select:mcp__plugin_meta-edit_meta-edit__edit_refactor_only\`) to load the relevant schema before declaring.`
    };
  }
  const { grant, binding: bound } = match;
  const diskRead = await readFileForBinding(repoRoot, canonical);
  if (!diskRead.ok) {
    return {
      decision: "deny",
      reason: `meta-edit could not read "${canonical}" to verify the typed_edit precondition (${diskRead.error}); ` + `failing closed — re-read the file and re-issue a typed_edit declaration.`
    };
  }
  const diskContent = diskRead.content;
  const diskSha = sha256Hex2(diskContent);
  if (diskSha !== bound.before_sha256) {
    return {
      decision: "deny",
      reason: `disk content of "${canonical}" has drifted from the typed_edit declaration ` + `(declared before_sha256=${shortHash(bound.before_sha256)}, actual ${shortHash(diskSha)}). ` + `Re-read the file and issue a fresh typed_edit declaration.`
    };
  }
  const consumeRes = await grants.consume(grant.token_id, canonical);
  if (!consumeRes.consumed) {
    return {
      decision: "deny",
      reason: `meta-edit could not consume the typed_edit declaration for "${canonical}": ${consumeRes.error ?? "unknown error"}.`
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
  return { decision: "allow" };
}
function canonicalizeForBinding(inputPath, repoRoot) {
  if (typeof inputPath !== "string" || inputPath.length === 0)
    return null;
  let resolved;
  if (path6.isAbsolute(inputPath)) {
    resolved = path6.normalize(inputPath);
  } else {
    resolved = path6.resolve(repoRoot, inputPath);
  }
  const realRoot = realpathOrSelfSync(repoRoot);
  const realResolved = realpathOfDeepestExisting(resolved);
  if (realResolved === null)
    return null;
  if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path6.sep)) {
    return null;
  }
  let rel;
  try {
    rel = normalizeRepoRelative(path6.relative(realRoot, realResolved));
  } catch {
    return null;
  }
  if (rel.length === 0)
    return null;
  return rel;
}
function isPathInsideRepo(inputPath, repoRoot) {
  if (typeof inputPath !== "string" || inputPath.length === 0)
    return true;
  const resolved = path6.isAbsolute(inputPath) ? path6.normalize(inputPath) : path6.resolve(repoRoot, inputPath);
  const realRoot = realpathOrSelfSync(repoRoot);
  const realResolved = realpathOfDeepestExisting(resolved);
  if (realResolved === null)
    return true;
  if (realResolved === realRoot)
    return true;
  return realResolved.startsWith(realRoot + path6.sep);
}
function realpathOrSelfSync(p) {
  const r = realpathOfDeepestExisting(p);
  return r ?? path6.resolve(p);
}
async function readFileForBinding(repoRoot, canonical) {
  const abs = path6.join(repoRoot, canonical);
  try {
    return { ok: true, content: await fs6.readFile(abs, "utf8") };
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

// src/state/grants.ts
import * as crypto4 from "node:crypto";
import * as fs7 from "node:fs/promises";
import * as path7 from "node:path";
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
  if (!Array.isArray(v.consumed_files))
    return false;
  for (const c of v.consumed_files) {
    if (typeof c !== "string")
      return false;
  }
  return true;
}
var SHARED_MUTEX_TAILS = new Map;
async function withSharedLock(key, fn) {
  const prev = SHARED_MUTEX_TAILS.get(key) ?? Promise.resolve();
  let release;
  const next = new Promise((resolve6) => {
    release = resolve6;
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

class GrantsStoreImpl {
  grantsDir;
  constructor(repoRoot) {
    this.grantsDir = path7.join(repoRoot, ".meta-edit", "state", "grants");
  }
  mutexKey(token_id) {
    return path7.resolve(this.grantPath(token_id));
  }
  async ensureDir() {
    await fs7.mkdir(this.grantsDir, { recursive: true, mode: 448 });
  }
  grantPath(token_id) {
    return path7.join(this.grantsDir, `${token_id}.json`);
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
        consumed_files: []
      };
      const filePath = this.grantPath(token_id);
      try {
        await fs7.writeFile(filePath, JSON.stringify(grant), {
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
      text = await fs7.readFile(filePath, "utf8");
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
    return withSharedLock(this.mutexKey(token_id), () => this.consumeLocked(token_id, file_path));
  }
  async consumeLocked(token_id, file_path) {
    const filePath = this.grantPath(token_id);
    let text;
    try {
      text = await fs7.readFile(filePath, "utf8");
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
        await fs7.unlink(filePath);
      } catch (e) {
        if (e.code !== "ENOENT")
          throw e;
      }
    } else {
      await fs7.writeFile(filePath, JSON.stringify(parsed), {
        encoding: "utf8",
        mode: 384
      });
    }
    return { consumed: true, fully_consumed: fullyConsumed };
  }
  async findActiveBindingForFile(canonicalFile) {
    if (typeof canonicalFile !== "string" || canonicalFile.length === 0) {
      return null;
    }
    let names;
    try {
      names = await fs7.readdir(this.grantsDir);
    } catch (e) {
      if (e.code === "ENOENT")
        return null;
      throw e;
    }
    const now = Date.now();
    let best = null;
    let bestIssuedMs = -Infinity;
    for (const name of names) {
      if (!name.endsWith(".json"))
        continue;
      const filePath = path7.join(this.grantsDir, name);
      let text;
      try {
        text = await fs7.readFile(filePath, "utf8");
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
      if (issuedScore > bestIssuedMs) {
        bestIssuedMs = issuedScore;
        best = { grant: parsed, binding };
      }
    }
    return best;
  }
  async reapExpired() {
    let names;
    try {
      names = await fs7.readdir(this.grantsDir);
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
      const filePath = path7.join(this.grantsDir, name);
      let text;
      try {
        text = await fs7.readFile(filePath, "utf8");
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
        await fs7.unlink(filePath);
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

// src/hooks/deny-raw-edit.ts
function resolveRepoRoot(eventCwd) {
  if (typeof eventCwd === "string" && eventCwd.length > 0) {
    return path8.resolve(eventCwd);
  }
  const envRoot = process.env["META_EDIT_REPO_ROOT"];
  if (typeof envRoot === "string" && envRoot.length > 0) {
    return path8.resolve(envRoot);
  }
  return process.cwd();
}
async function main() {
  const event = await readStdin();
  const toolName = typeof event["tool_name"] === "string" ? event["tool_name"] : "";
  const classification = evaluateRawEdit(toolName);
  if (classification.decision !== "deny") {
    if (classification.decision === "warn") {
      return replyAllowWithWarning(classification.reason ?? "warned by deny-raw-edit");
    }
    return replyAllow();
  }
  const repoRoot = resolveRepoRoot(typeof event["cwd"] === "string" ? event["cwd"] : undefined);
  const toolInput = event["tool_input"] ?? {};
  const grants = createGrantsStore(repoRoot);
  const log = new EditLog(repoRoot);
  let decision;
  try {
    decision = await evaluateTokenedEdit({
      toolName,
      toolInput,
      repoRoot,
      grants,
      log
    });
  } catch (e) {
    const msg = e.message;
    return replyDeny(`deny-raw-edit policy errored on ${toolName}: ${msg}`);
  }
  if (decision.decision === "deny") {
    return replyDeny(decision.reason ?? "denied by deny-raw-edit");
  }
  if (decision.decision === "warn") {
    return replyAllowWithWarning(decision.reason ?? "warned by deny-raw-edit");
  }
  return replyAllow();
}
main().then((code) => process.exit(code), (err) => {
  console.error(`deny-raw-edit hook crashed: ${err.message}`);
  process.exit(2);
});

//# debugId=71C816A2FA58EC5B64756E2164756E21
