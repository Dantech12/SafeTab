import { z } from "zod";

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");
// Android package names, e.g. com.example.app
export const PackageName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/).max(255);
// Domain or Chrome URL-filter host pattern (no paths, no query strings: domain level only).
const Domain = z
  .string()
  .toLowerCase()
  .regex(/^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,63}$/, "expected a domain like example.org or *.example.org");

export const DowntimeWindow = z
  .object({
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7), // ISO weekday, 1 = Monday
    start: HHMM,
    end: HHMM, // may be earlier than start => crosses midnight
  })
  .refine((w) => w.start !== w.end, "start and end must differ");

export const PolicySpec = z.object({
  downtime: z
    .object({
      enabled: z.boolean().default(false),
      timezone: z.string().default("UTC"), // IANA zone of the student/school
      windows: z.array(DowntimeWindow).max(14).default([]),
    })
    .default({ enabled: false, timezone: "UTC", windows: [] }),
  apps: z
    .object({
      // allowlist: only listed apps can be installed from managed Google Play.
      // blocklist: listed apps are blocked/removed; others remain installable.
      mode: z.enum(["allowlist", "blocklist"]).default("blocklist"),
      packages: z.array(PackageName).max(500).default([]),
    })
    .default({ mode: "blocklist", packages: [] }),
  web: z
    .object({
      // Applies to managed Chrome only, via Chrome's managed configuration.
      mode: z.enum(["off", "blocklist", "allowlist"]).default("off"),
      domains: z.array(Domain).max(1000).default([]),
    })
    .default({ mode: "off", domains: [] }),
  usageSummaries: z
    .object({
      // Daily per-app minute totals reported by the visible companion app. Off by default.
      enabled: z.boolean().default(false),
    })
    .default({ enabled: false }),
});

export type PolicySpec = z.infer<typeof PolicySpec>;
export const DEFAULT_POLICY: PolicySpec = PolicySpec.parse({});

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parsePolicySpec(input: unknown): PolicySpec {
  const spec = PolicySpec.parse(input);
  if (!isValidTimeZone(spec.downtime.timezone)) {
    throw new z.ZodError([{ code: "custom", path: ["downtime", "timezone"], message: "unknown IANA time zone", input: spec.downtime.timezone }]);
  }
  return spec;
}

/** Local weekday (1-7) and minutes since midnight for `now` in `tz`. */
function localTime(now: Date, tz: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** True if `now` falls inside an enabled downtime window. Overnight windows belong to their start day. */
export function isInDowntime(spec: PolicySpec, now: Date): boolean {
  if (!spec.downtime.enabled) return false;
  const { day, minutes } = localTime(now, spec.downtime.timezone);
  const prevDay = day === 1 ? 7 : day - 1;
  return spec.downtime.windows.some((w) => {
    const s = toMin(w.start);
    const e = toMin(w.end);
    if (s < e) return w.days.includes(day) && minutes >= s && minutes < e;
    // crosses midnight: [s, 24:00) on start day, [00:00, e) on the following day
    return (w.days.includes(day) && minutes >= s) || (w.days.includes(prevDay) && minutes < e);
  });
}
