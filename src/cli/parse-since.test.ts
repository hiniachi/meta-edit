import { describe, it, expect } from "bun:test";
import { parseStrictSince } from "./parse-since.js";

describe("parseStrictSince", () => {
  describe("YYYY-MM-DD", () => {
    it("accepts a valid date", () => {
      const d = parseStrictSince("2026-04-30");
      expect(d).not.toBeNull();
      expect(d?.getFullYear()).toBe(2026);
      expect(d?.getMonth()).toBe(3); // April
      expect(d?.getDate()).toBe(30);
    });

    it("rejects rollover (2026-02-31, 2026-04-31)", () => {
      expect(parseStrictSince("2026-02-31")).toBeNull();
      expect(parseStrictSince("2026-04-31")).toBeNull();
    });

    it("rejects month 13 / month 0", () => {
      expect(parseStrictSince("2026-13-01")).toBeNull();
      expect(parseStrictSince("2026-00-01")).toBeNull();
    });

    it("rejects day 0", () => {
      expect(parseStrictSince("2026-04-00")).toBeNull();
    });

    it("accepts February 29 in a leap year and rejects in a non-leap year", () => {
      expect(parseStrictSince("2024-02-29")).not.toBeNull();
      expect(parseStrictSince("2025-02-29")).toBeNull();
    });

    it("rejects years below 100 (JS year remapping hazard)", () => {
      expect(parseStrictSince("0000-01-01")).toBeNull();
      expect(parseStrictSince("0099-12-31")).toBeNull();
      expect(parseStrictSince("0099-12-31T00:00:00Z")).toBeNull();
    });

    it("rejects single-digit months / days (2026-2-3)", () => {
      expect(parseStrictSince("2026-2-3")).toBeNull();
    });

    it("rejects slash-separated forms (2026/02/31, 02/31/2026)", () => {
      expect(parseStrictSince("2026/02/31")).toBeNull();
      expect(parseStrictSince("02/31/2026")).toBeNull();
    });
  });

  describe("ISO 8601 timestamp", () => {
    it("accepts Z-suffixed timestamp", () => {
      expect(parseStrictSince("2026-04-30T12:34:56Z")).not.toBeNull();
    });

    it("accepts +HH:MM offset timestamp", () => {
      expect(parseStrictSince("2026-04-30T12:34:56+09:00")).not.toBeNull();
    });

    it("accepts +HHMM offset timestamp", () => {
      expect(parseStrictSince("2026-04-30T12:34:56+0900")).not.toBeNull();
    });

    it("accepts -HH:MM offset timestamp", () => {
      expect(parseStrictSince("2026-04-30T12:34:56-05:00")).not.toBeNull();
    });

    it("accepts a timestamp whose offset crosses the UTC date boundary (no over-rejection)", () => {
      // 2026-04-30T00:30:00+09:00 is 2026-04-29T15:30:00 UTC. The previous
      // implementation over-rejected by comparing UTC getters to literal
      // calendar fields. The new parser must not.
      expect(parseStrictSince("2026-04-30T00:30:00+09:00")).not.toBeNull();
      expect(parseStrictSince("2026-04-30T23:30:00-08:00")).not.toBeNull();
    });

    it("rejects ISO with rollover date (2026-02-31T00:00:00Z)", () => {
      expect(parseStrictSince("2026-02-31T00:00:00Z")).toBeNull();
    });

    it("rejects ISO with month 13", () => {
      expect(parseStrictSince("2026-13-01T00:00:00Z")).toBeNull();
    });

    it("rejects ISO with hour 24", () => {
      expect(parseStrictSince("2026-04-30T24:00:00Z")).toBeNull();
    });

    it("rejects ISO without explicit timezone", () => {
      // Local-time interpretation is ambiguous across machines/CI. Force
      // an explicit offset.
      expect(parseStrictSince("2026-04-30T12:34:56")).toBeNull();
    });

    it("rejects ISO with a space separator instead of T", () => {
      expect(parseStrictSince("2026-04-30 12:34:56Z")).toBeNull();
    });
  });

  describe("non-ISO Date-parseable strings", () => {
    it("rejects English-language dates", () => {
      expect(parseStrictSince("April 30, 2026")).toBeNull();
      expect(parseStrictSince("yesterday")).toBeNull();
      expect(parseStrictSince("now")).toBeNull();
    });

    it("rejects Unix timestamps", () => {
      expect(parseStrictSince("1714497296")).toBeNull();
    });
  });
});
