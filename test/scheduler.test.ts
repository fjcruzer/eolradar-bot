import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/store/memory";
import {
  DEFAULT_DIGEST_CRON,
  claimDigestSlot,
  cronMatches,
  cronSlotId,
  nextCronTime,
  parseCron,
  previousCronTime,
  startDigestSchedule,
} from "../src/scheduler";

const SUNDAY = Date.parse("2026-11-15T12:00:00.000Z");
const MONDAY = Date.parse("2026-11-16T14:00:00.000Z");

describe("digest cron", () => {
  it("matches the Worker Monday 14:00 UTC schedule", () => {
    expect(new Date(SUNDAY).getUTCDay()).toBe(0);
    expect(new Date(nextCronTime(DEFAULT_DIGEST_CRON, SUNDAY)).toISOString()).toBe("2026-11-16T14:00:00.000Z");
    expect(new Date(nextCronTime(DEFAULT_DIGEST_CRON, MONDAY)).toISOString()).toBe("2026-11-23T14:00:00.000Z");
    expect(new Date(previousCronTime(DEFAULT_DIGEST_CRON, Date.parse("2026-11-16T14:10:00.000Z"))).toISOString()).toBe(
      "2026-11-16T14:00:00.000Z",
    );
    expect(new Date(nextCronTime("0 14 * * 1", SUNDAY)).toISOString()).toBe("2026-11-16T14:00:00.000Z");
    expect(new Date(nextCronTime("0 14 * * 7", Date.parse("2026-11-14T15:00:00.000Z"))).toISOString()).toBe(
      "2026-11-15T14:00:00.000Z",
    );
  });

  it("treats a restricted day-of-month and day-of-week as either", () => {
    const cron = parseCron("0 0 16 * MON");
    const wednesdayThe16th = new Date(Date.UTC(2026, 11, 16));
    expect(wednesdayThe16th.getUTCDay()).not.toBe(1);
    expect(cronMatches(cron, wednesdayThe16th)).toBe(true);
    const mondayNotThe16th = new Date(wednesdayThe16th);
    mondayNotThe16th.setUTCDate(16 - ((wednesdayThe16th.getUTCDay() + 6) % 7));
    expect(mondayNotThe16th.getUTCDay()).toBe(1);
    expect(mondayNotThe16th.getUTCDate()).not.toBe(16);
    expect(cronMatches(cron, mondayNotThe16th)).toBe(true);
  });

  it("rejects a cron that is not five fields", () => {
    expect(() => parseCron("0 14 * MON")).toThrow(/DIGEST_CRON/);
    expect(() => parseCron("60 14 * * MON")).toThrow(/DIGEST_CRON/);
  });
});

describe("startDigestSchedule", () => {
  it("waits until the next slot, then runs it once", async () => {
    const ran: string[] = [];
    let scheduled: { delay: number; fire: () => void } | undefined;
    const handle = startDigestSchedule({
      cron: DEFAULT_DIGEST_CRON,
      now: () => SUNDAY,
      catchupMs: 0,
      setTimer(callback, delayMs) {
        scheduled = { delay: delayMs, fire: callback };
        return { cancel() {} };
      },
      run: (slot) => {
        ran.push(slot);
        return Promise.resolve();
      },
    });
    expect(ran).toEqual([]);
    expect(scheduled?.delay).toBe(MONDAY - SUNDAY);
    expect(new Date(handle.nextRunAt()).toISOString()).toBe("2026-11-16T14:00:00.000Z");
    scheduled?.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ran).toEqual([cronSlotId(MONDAY)]);
    handle.stop();
  });

  it("runs a missed slot that is still inside the catch-up window", async () => {
    const ran: string[] = [];
    const tenPast = Date.parse("2026-11-16T14:10:00.000Z");
    startDigestSchedule({
      cron: DEFAULT_DIGEST_CRON,
      now: () => tenPast,
      catchupMs: 15 * 60 * 1000,
      setTimer: () => ({ cancel() {} }),
      run: (slot) => {
        ran.push(slot);
        return Promise.resolve();
      },
    }).stop();
    expect(ran).toEqual(["2026-11-16T14:00"]);
  });
});

describe("claimDigestSlot", () => {
  it("lets the first caller post and skips the second", async () => {
    const store = createMemoryStore();
    await expect(claimDigestSlot(store, "2026-11-16T14:00")).resolves.toBe(true);
    await expect(claimDigestSlot(store, "2026-11-16T14:00")).resolves.toBe(false);
  });
});
