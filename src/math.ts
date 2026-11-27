// WoW (Forever / Classic / Retail) rested XP mechanics, including WoW Forever's
// "Well Rested" Legacy perk (Adventure tree, 5 ranks, +4% rate and +4% cap per rank).

import type { RestedPoint } from "./types";

/** Base rested cap: 150% of the current level's XP bar (30 "bubbles"). */
export const BASE_CAP_PCT = 150;
/** Inn / capital city: 5% of a level per 8 hours. */
export const INN_RATE_PCT_PER_HOUR = 5 / 8;
/** Open world: 1.25% of a level per 8 hours (a quarter of the inn rate). */
export const WORLD_RATE_PCT_PER_HOUR = 1.25 / 8;
/** Each Well Rested rank adds 4% to both the accumulation rate and the cap. */
export const WELL_RESTED_BONUS_PER_RANK = 0.04;
export const WELL_RESTED_MAX_RANK = 5;

export function clampRank(rank: number): number {
  if (!Number.isFinite(rank)) return 0;
  return Math.min(WELL_RESTED_MAX_RANK, Math.max(0, Math.round(rank)));
}

export function wellRestedMultiplier(rank: number): number {
  return 1 + clampRank(rank) * WELL_RESTED_BONUS_PER_RANK;
}

export function maxCapPct(rank: number): number {
  return BASE_CAP_PCT * wellRestedMultiplier(rank);
}

export function hourlyRatePct(isResting: boolean, rank: number): number {
  const base = isResting ? INN_RATE_PCT_PER_HOUR : WORLD_RATE_PCT_PER_HOUR;
  return base * wellRestedMultiplier(rank);
}

export interface RestedInput {
  restedPct: number;
  isResting: boolean;
  /** Unix epoch seconds of the snapshot. */
  timestamp: number;
}

export interface RestedStatus {
  /** Estimated rested XP right now, in % of the current level. */
  currentPct: number;
  /** Cap for this character, in % of the current level. */
  maxCap: number;
  /** Accumulation rate in % of a level per hour. */
  hourlyRate: number;
  hoursElapsed: number;
  remainingPct: number;
  hoursUntilMax: number;
  isMaxed: boolean;
  /** 0..1 progress toward the cap. */
  fractionOfCap: number;
}

export function computeRested(input: RestedInput, rank: number, nowSec: number = Date.now() / 1000): RestedStatus {
  const maxCap = maxCapPct(rank);
  const hourlyRate = hourlyRatePct(input.isResting, rank);
  const saved = Number.isFinite(input.restedPct) ? Math.max(0, input.restedPct) : 0;
  const hoursElapsed = Math.max(0, (nowSec - input.timestamp) / 3600);
  const currentPct = Math.min(maxCap, saved + hoursElapsed * hourlyRate);
  const remainingPct = Math.max(0, maxCap - currentPct);
  const hoursUntilMax = hourlyRate > 0 ? remainingPct / hourlyRate : 0;
  // Treat anything within 0.01% of the cap as full (avoids "0m left" flicker).
  const isMaxed = remainingPct < 0.01;
  return {
    currentPct,
    maxCap,
    hourlyRate,
    hoursElapsed,
    remainingPct: isMaxed ? 0 : remainingPct,
    hoursUntilMax: isMaxed ? 0 : hoursUntilMax,
    isMaxed,
    fractionOfCap: maxCap > 0 ? Math.min(1, currentPct / maxCap) : 0,
  };
}

/** "2d 14h", "14h 5m", "12m", "<1m" */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0m";
  const totalMinutes = Math.ceil(hours * 60);
  if (totalMinutes < 1) return "<1m";
  const d = Math.floor(totalMinutes / (24 * 60));
  const h = Math.floor((totalMinutes % (24 * 60)) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** "just now", "5m ago", "3h ago", "2d ago" */
export function formatAgo(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatPct(pct: number): string {
  return `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
}

export interface RankInference {
  rank: number;
  /** Distance between the predicted and observed rested %, in percentage points. */
  error: number;
  hoursOffline: number;
}

/** Predictions closer than this (percentage points) to the observed value are a match. */
const MATCH_TOLERANCE = 0.2;
/** The runner-up rank must be at least this much worse for the result to count. */
const MIN_SEPARATION = 0.25;
const MIN_HOURS_OFFLINE = 1;

function pctOf(point: RestedPoint): number {
  if (point.maxXP > 1 && Number.isFinite(point.restedXP)) return (point.restedXP / point.maxXP) * 100;
  return point.restedPct;
}

/**
 * Works out the Well Rested rank by comparing the rested XP saved at the previous
 * logout with the rested XP right after the next login. Returns null when the
 * offline period was too short to tell ranks apart or nothing fits the model.
 */
export function inferWellRestedRank(prevLogout: RestedPoint | undefined, login: RestedPoint | undefined): RankInference | null {
  if (!prevLogout || !login) return null;
  if (prevLogout.level !== login.level) return null;
  const hoursOffline = (login.timestamp - prevLogout.timestamp) / 3600;
  if (!Number.isFinite(hoursOffline) || hoursOffline < MIN_HOURS_OFFLINE) return null;

  const before = pctOf(prevLogout);
  const after = pctOf(login);
  if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) return null;

  const isResting = prevLogout.isResting === true;
  const errors: { rank: number; error: number }[] = [];
  for (let rank = 0; rank <= WELL_RESTED_MAX_RANK; rank++) {
    const predicted = Math.min(maxCapPct(rank), before + hoursOffline * hourlyRatePct(isResting, rank));
    errors.push({ rank, error: Math.abs(predicted - after) });
  }
  errors.sort((a, b) => a.error - b.error);
  const [best, runnerUp] = errors;
  if (best.error > MATCH_TOLERANCE) return null;
  if (runnerUp.error - best.error < MIN_SEPARATION) return null;
  return { rank: best.rank, error: best.error, hoursOffline };
}
