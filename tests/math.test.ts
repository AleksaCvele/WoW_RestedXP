import { describe, expect, it } from "vitest";
import {
  computeRested,
  formatDuration,
  hourlyRatePct,
  inferWellRestedRank,
  maxCapPct,
  wellRestedMultiplier,
} from "../src/math";

const HOUR = 3600;

describe("Well Rested table", () => {
  const table = [
    { rank: 0, mult: 1.0, cap: 150, inn: 0.625, world: 0.15625 },
    { rank: 1, mult: 1.04, cap: 156, inn: 0.65, world: 0.1625 },
    { rank: 2, mult: 1.08, cap: 162, inn: 0.675, world: 0.16875 },
    { rank: 3, mult: 1.12, cap: 168, inn: 0.7, world: 0.175 },
    { rank: 4, mult: 1.16, cap: 174, inn: 0.725, world: 0.18125 },
    { rank: 5, mult: 1.2, cap: 180, inn: 0.75, world: 0.1875 },
  ];
  it.each(table)("rank $rank", ({ rank, mult, cap, inn, world }) => {
    expect(wellRestedMultiplier(rank)).toBeCloseTo(mult, 10);
    expect(maxCapPct(rank)).toBeCloseTo(cap, 10);
    expect(hourlyRatePct(true, rank)).toBeCloseTo(inn, 10);
    expect(hourlyRatePct(false, rank)).toBeCloseTo(world, 10);
    // Every rank takes exactly 10 days in an inn from 0% to full.
    expect(maxCapPct(rank) / hourlyRatePct(true, rank)).toBeCloseTo(240, 10);
  });

  it("clamps out-of-range ranks", () => {
    expect(wellRestedMultiplier(9)).toBeCloseTo(1.2);
    expect(wellRestedMultiplier(-3)).toBe(1);
  });
});

describe("computeRested", () => {
  const t0 = 1_800_000_000;

  it("accumulates at the inn rate", () => {
    const s = computeRested({ restedPct: 10, isResting: true, timestamp: t0 }, 0, t0 + 8 * HOUR);
    expect(s.currentPct).toBeCloseTo(15, 10);
    expect(s.maxCap).toBe(150);
    expect(s.isMaxed).toBe(false);
    expect(s.hoursUntilMax).toBeCloseTo(135 / 0.625, 6);
  });

  it("accumulates at a quarter of the rate in the open world", () => {
    const s = computeRested({ restedPct: 0, isResting: false, timestamp: t0 }, 0, t0 + 8 * HOUR);
    expect(s.currentPct).toBeCloseTo(1.25, 10);
  });

  it("applies the Well Rested bonus to rate and cap", () => {
    const s = computeRested({ restedPct: 0, isResting: true, timestamp: t0 }, 5, t0 + 100 * HOUR);
    expect(s.currentPct).toBeCloseTo(75, 10);
    expect(s.maxCap).toBe(180);
  });

  it("caps and reports maxed", () => {
    const s = computeRested({ restedPct: 149, isResting: true, timestamp: t0 }, 0, t0 + 10 * HOUR);
    expect(s.currentPct).toBe(150);
    expect(s.isMaxed).toBe(true);
    expect(s.hoursUntilMax).toBe(0);
    expect(s.fractionOfCap).toBe(1);
  });

  it("goes from 0% to full in exactly 10 days at an inn", () => {
    const s = computeRested({ restedPct: 0, isResting: true, timestamp: t0 }, 3, t0 + 240 * HOUR);
    expect(s.isMaxed).toBe(true);
    const almost = computeRested({ restedPct: 0, isResting: true, timestamp: t0 }, 3, t0 + 239 * HOUR);
    expect(almost.isMaxed).toBe(false);
    expect(almost.hoursUntilMax).toBeCloseTo(1, 6);
  });

  it("ignores snapshots from the future (clock skew)", () => {
    const s = computeRested({ restedPct: 20, isResting: true, timestamp: t0 + HOUR }, 0, t0);
    expect(s.currentPct).toBe(20);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0m"],
    [0.1, "6m"],
    [1, "1h"],
    [1.5, "1h 30m"],
    [24, "1d"],
    [62.25, "2d 14h"],
    [240, "10d"],
  ])("%s hours → %s", (hours, text) => {
    expect(formatDuration(hours)).toBe(text);
  });
});

describe("inferWellRestedRank", () => {
  const t0 = 1_800_000_000;
  const point = (restedPct: number, timestamp: number, isResting?: boolean) => ({
    level: 30,
    restedXP: restedPct * 100,
    maxXP: 10000,
    restedPct,
    isResting,
    timestamp,
  });

  it.each([0, 1, 2, 3, 4, 5])("recovers rank %s from a 30h inn logout", (rank) => {
    const gain = 30 * 0.625 * (1 + rank * 0.04);
    const result = inferWellRestedRank(point(20, t0, true), point(20 + gain, t0 + 30 * HOUR));
    expect(result?.rank).toBe(rank);
  });

  it("recovers the rank from the cap when the character maxed out offline", () => {
    const result = inferWellRestedRank(point(100, t0, true), point(174, t0 + 200 * HOUR));
    expect(result?.rank).toBe(4);
  });

  it("works for open-world logouts given enough time", () => {
    const gain = 120 * 0.15625 * 1.2;
    expect(inferWellRestedRank(point(0, t0, false), point(gain, t0 + 120 * HOUR))?.rank).toBe(5);
  });

  it("refuses to guess when the offline time is too short to tell ranks apart", () => {
    const gain = 3 * 0.625 * 1.08;
    expect(inferWellRestedRank(point(10, t0, true), point(10 + gain, t0 + 3 * HOUR))).toBeNull();
  });

  it("returns null when nothing fits the model", () => {
    expect(inferWellRestedRank(point(10, t0, true), point(90, t0 + 30 * HOUR))).toBeNull();
    expect(inferWellRestedRank(point(10, t0, true), { ...point(40, t0 + 30 * HOUR), level: 31 })).toBeNull();
    expect(inferWellRestedRank(undefined, point(40, t0))).toBeNull();
  });

  it("ignores a logout saved without real XP data (RestedSync 1.0.0 on WoW Forever)", () => {
    // 0 rested, "open world", 120 h later 22.5% fits rank 5 exactly, but the 0 is bogus.
    const broken = { ...point(0, t0, false), restedXP: 0, maxXP: 1 };
    const gain = 120 * 0.15625 * 1.2;
    expect(inferWellRestedRank(broken, point(gain, t0 + 120 * HOUR))).toBeNull();
  });
});
