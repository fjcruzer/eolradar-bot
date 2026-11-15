import { clearTimeout, setTimeout } from "node:timers";
import type { KeyValueStore } from "./store/types";

/** Same instant as the Worker cron in wrangler.jsonc: Monday 14:00 UTC. */
export const DEFAULT_DIGEST_CRON = "0 14 * * MON";

const DAY_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const MAX_TIMER_MS = 2_147_483_647;
const YEAR_MS = 366 * 24 * 60 * 60 * 1000;
const SLOT_TTL_SECONDS = 8 * 24 * 60 * 60;

export interface CronExpression {
  minutes: Set<number>;
  hours: Set<number>;
  /** null means `*` (unrestricted). */
  daysOfMonth: Set<number> | null;
  months: Set<number> | null;
  daysOfWeek: Set<number> | null;
}

export interface TimerHandle {
  cancel(): void;
}

/**
 * Five-field cron in UTC. Day-of-week numbers follow POSIX: 0 and 7 are Sunday,
 * 1 is Monday. Names SUN–SAT are accepted. `0 14 * * MON` is the Worker schedule.
 * When both day-of-month and day-of-week are restricted, either one is enough.
 */
export function parseCron(expression: string): CronExpression {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid DIGEST_CRON "${expression}". Expected 5 fields, for example "${DEFAULT_DIGEST_CRON}".`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (minute === undefined || hour === undefined || dayOfMonth === undefined || month === undefined || dayOfWeek === undefined) {
    throw new Error(`Invalid DIGEST_CRON "${expression}".`);
  }
  try {
    return {
      minutes: parseField(minute, 0, 59),
      hours: parseField(hour, 0, 23),
      daysOfMonth: parseOptional(dayOfMonth, 1, 31),
      months: parseOptional(month, 1, 12),
      daysOfWeek: parseDaysOfWeek(dayOfWeek),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid DIGEST_CRON "${expression}". ${reason}`, { cause: error });
  }
}

export function cronMatches(cron: CronExpression, date: Date): boolean {
  if (!cron.minutes.has(date.getUTCMinutes())) return false;
  if (!cron.hours.has(date.getUTCHours())) return false;
  if (cron.months && !cron.months.has(date.getUTCMonth() + 1)) return false;
  const domOk = cron.daysOfMonth === null || cron.daysOfMonth.has(date.getUTCDate());
  const dowOk = cron.daysOfWeek === null || cron.daysOfWeek.has(date.getUTCDay());
  if (cron.daysOfMonth !== null && cron.daysOfWeek !== null) return domOk || dowOk;
  return domOk && dowOk;
}

/** The soonest matching minute strictly after `fromMs`. */
export function nextCronTime(expression: string, fromMs: number): number {
  const cron = parseCron(expression);
  const cursor = new Date(fromMs);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const limit = fromMs + YEAR_MS;
  while (cursor.getTime() <= limit) {
    if (cronMatches(cron, cursor)) return cursor.getTime();
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new Error(`No digest time in the year after ${new Date(fromMs).toISOString()}`);
}

/** The latest matching minute at or before `fromMs`. */
export function previousCronTime(expression: string, fromMs: number): number {
  const cron = parseCron(expression);
  const cursor = new Date(fromMs);
  cursor.setUTCSeconds(0, 0);
  const limit = fromMs - YEAR_MS;
  while (cursor.getTime() >= limit) {
    if (cursor.getTime() <= fromMs && cronMatches(cron, cursor)) return cursor.getTime();
    cursor.setUTCMinutes(cursor.getUTCMinutes() - 1);
  }
  throw new Error(`No digest time at or before ${new Date(fromMs).toISOString()}`);
}

export function cronSlotId(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 16);
}

export async function claimDigestSlot(store: KeyValueStore, slot: string): Promise<boolean> {
  return store.add(`digest-slot:${slot}`, new Date().toISOString(), { ttlSeconds: SLOT_TTL_SECONDS });
}

export async function releaseDigestSlot(store: KeyValueStore, slot: string): Promise<void> {
  await store.delete(`digest-slot:${slot}`);
}

export function startDigestSchedule(options: {
  cron: string;
  now?: () => number;
  catchupMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  run: (slot: string) => Promise<void>;
  onError?: (error: unknown) => void;
}): { stop(): void; nextRunAt(): number } {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? defaultSetTimer;
  const catchupMs = options.catchupMs ?? 0;
  const onError = options.onError ?? (() => undefined);
  let stopped = false;
  let nextAt = 0;
  let timer: TimerHandle | null = null;

  const arm = (): void => {
    if (stopped) return;
    const from = now();
    const next = nextCronTime(options.cron, from);
    nextAt = next;
    timer = setTimer(() => {
      void (async () => {
        try {
          await options.run(cronSlotId(next));
        } catch (error) {
          onError(error);
        } finally {
          arm();
        }
      })();
    }, Math.max(0, next - from));
  };

  const previous = previousCronTime(options.cron, now());
  if (now() - previous <= catchupMs) {
    void (async () => {
      try {
        await options.run(cronSlotId(previous));
      } catch (error) {
        onError(error);
      }
    })();
  }
  arm();

  return {
    stop() {
      stopped = true;
      timer?.cancel();
    },
    nextRunAt() {
      return nextAt;
    },
  };
}

function defaultSetTimer(callback: () => void, delayMs: number): TimerHandle {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const arm = (remaining: number): void => {
    const slice = Math.min(remaining, MAX_TIMER_MS);
    timer = setTimeout(() => {
      if (cancelled) return;
      const left = remaining - slice;
      if (left > 0) arm(left);
      else callback();
    }, slice);
    timer.unref();
  };
  arm(Math.max(0, delayMs));
  return {
    cancel() {
      cancelled = true;
      clearTimeout(timer);
    },
  };
}

function parseOptional(field: string, min: number, max: number): Set<number> | null {
  if (field === "*") return null;
  return parseField(field, min, max);
}

function parseDaysOfWeek(field: string): Set<number> | null {
  if (field === "*") return null;
  const normalized = new Set<number>();
  for (const value of parseField(field, 0, 7, DAY_NAMES)) normalized.add(value === 7 ? 0 : value);
  return normalized;
}

function parseField(field: string, min: number, max: number, names?: Record<string, number>): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    if (part.length === 0) throw new Error("Empty cron list item");
    for (const value of expandPart(part, min, max, names)) values.add(value);
  }
  if (values.size === 0) throw new Error(`Cron field "${field}" matched nothing`);
  return values;
}

function expandPart(part: string, min: number, max: number, names?: Record<string, number>): number[] {
  const pieces = part.split("/");
  if (pieces.length > 2) throw new Error(`Invalid cron field "${part}"`);
  const rangeText = pieces[0] === undefined || pieces[0].length === 0 ? "*" : pieces[0];
  const stepText = pieces[1];
  const step = stepText === undefined ? 1 : Number(stepText);
  if (!Number.isInteger(step) || step <= 0) throw new Error(`Invalid cron step in "${part}"`);
  let start = min;
  let end = max;
  if (rangeText !== "*") {
    const bounds = rangeText.split("-");
    if (bounds.length === 1) {
      start = resolveToken(bounds[0] ?? "", min, max, names);
      end = start;
    } else if (bounds.length === 2) {
      start = resolveToken(bounds[0] ?? "", min, max, names);
      end = resolveToken(bounds[1] ?? "", min, max, names);
    } else {
      throw new Error(`Invalid cron range "${part}"`);
    }
  }
  if (start > end || start < min || end > max) throw new Error(`Invalid cron range "${part}"`);
  const values: number[] = [];
  for (let value = start; value <= end; value += step) values.push(value);
  if (values.length === 0) throw new Error(`Cron field "${part}" matched nothing`);
  return values;
}

function resolveToken(token: string, min: number, max: number, names?: Record<string, number>): number {
  const named = names?.[token.toUpperCase()];
  if (named !== undefined) {
    if (named < min || named > max) throw new Error(`Cron value ${token} is outside ${min}-${max}`);
    return named;
  }
  if (!/^\d+$/.test(token)) throw new Error(`Invalid cron value "${token}"`);
  const value = Number(token);
  if (value < min || value > max) throw new Error(`Cron value ${value} is outside ${min}-${max}`);
  return value;
}
