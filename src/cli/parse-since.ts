// Strict --since date / timestamp parser shared by `meta-edit log` and
// `meta-edit summary`.
//
// We accept exactly two shapes:
//
//   1. YYYY-MM-DD            — start of that local day
//   2. YYYY-MM-DDTHH:MM:SS[.sss][Z|+HH:MM|+HHMM] (or - offsets)
//                              — full ISO 8601 timestamp with explicit
//                                 timezone (Z, +0900, +09:00, ...)
//
// Both shapes validate the calendar fields manually (month 1-12, day
// within the month, h:m:s ranges) BEFORE letting `Date` parse, so silent
// rollover (`2026-02-31` -> March 3) cannot slip through, and forms that
// `Date` happens to accept (`2026/02/31`, `02/31/2026`, `2026-2-31`) are
// rejected outright because they don't match the strict regex.

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+\-]\d{2}:?\d{2})$/;

export function parseStrictSince(s: string): Date | null {
  const ymd = YMD_RE.exec(s);
  if (ymd) {
    const y = Number.parseInt(ymd[1]!, 10);
    const m = Number.parseInt(ymd[2]!, 10);
    const d = Number.parseInt(ymd[3]!, 10);
    if (!isValidYMD(y, m, d)) return null;
    const dt = new Date(y, m - 1, d, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const iso = ISO_RE.exec(s);
  if (iso) {
    const y = Number.parseInt(iso[1]!, 10);
    const m = Number.parseInt(iso[2]!, 10);
    const d = Number.parseInt(iso[3]!, 10);
    const hh = Number.parseInt(iso[4]!, 10);
    const mm = Number.parseInt(iso[5]!, 10);
    const ss = Number.parseInt(iso[6]!, 10);
    if (!isValidYMD(y, m, d)) return null;
    if (hh > 23 || mm > 59 || ss > 59) return null;
    // Calendar fields are valid; let Date resolve the timezone offset.
    // Because we already validated the literal calendar values, Date
    // cannot silently roll over here.
    const dt = new Date(s);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

function isValidYMD(y: number, m: number, d: number): boolean {
  // Reject years below 100 to dodge JavaScript's two-digit year remapping
  // (`new Date(0, 0, 1)` means 1900-01-01, not year 0). Realistic edit
  // logs cover modern dates; an explicit `0099-12-31` from a user is far
  // more likely a typo than an intentional ancient calendar lookup.
  if (y < 100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1) return false;
  // The 0th day of month m+1 is the last day of month m, which Date
  // computes correctly for leap years.
  const lastDay = new Date(y, m, 0).getDate();
  return d <= lastDay;
}
