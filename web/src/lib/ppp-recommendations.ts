import type { PppCandidate, PppPriorityLever, PppSelectorMode } from "../types";

const DISPLAY_PROTECTION_STEP_BPS = 500;

export function getPppCandidateKey(candidate: PppCandidate): string {
  return [
    candidate.expirationTimestamp,
    normalizeBps(candidate.quotedProtectionBps, candidate.quotedProtection ?? candidate.protectionLevel),
    normalizeBps(candidate.quotedParticipationBps, candidate.quotedParticipation)
  ].join(":");
}

export function getPppRecommendations({
  best,
  candidates,
  selectorMode,
  priorityLever,
  targetProtectionBps,
  limit = 3
}: {
  best: PppCandidate | null;
  candidates: PppCandidate[] | undefined;
  selectorMode: PppSelectorMode;
  priorityLever: PppPriorityLever | undefined;
  targetProtectionBps: number;
  limit?: number;
}): PppCandidate[] {
  const ordered = uniqueByCandidateKey([best, ...(candidates ?? [])]);
  const eligible = ordered.filter((candidate) => candidate.eligible);
  const pool = eligible.length > 0 ? eligible : ordered;
  if (selectorMode === "auto_participation" && priorityLever === "duration") {
    return shapeDurationPriorityRecommendations(pool, best, targetProtectionBps, limit);
  }
  return pool.slice(0, limit);
}

function shapeDurationPriorityRecommendations(
  candidates: PppCandidate[],
  best: PppCandidate | null,
  targetProtectionBps: number,
  limit: number
): PppCandidate[] {
  const anchorKey = best ? getPppCandidateKey(best) : null;
  const anchor = (anchorKey ? candidates.find((candidate) => getPppCandidateKey(candidate) === anchorKey) : null) ?? candidates[0];
  if (!anchor) return [];

  const sameExpiry = candidates.filter((candidate) => candidate.expirationTimestamp === anchor.expirationTimestamp);
  const selected: PppCandidate[] = [];
  const selectedKeys = new Set<string>();

  for (const protectionBps of buildDisplayProtectionSlots(targetProtectionBps)) {
    const next = nearestProtectionCandidate(sameExpiry, protectionBps, targetProtectionBps, selectedKeys);
    if (next) {
      selected.push(next);
      selectedKeys.add(getPppCandidateKey(next));
      if (selected.length >= limit) return selected;
    }
  }

  for (const candidate of [...sameExpiry, ...candidates]) {
    const key = getPppCandidateKey(candidate);
    if (selectedKeys.has(key)) continue;
    selected.push(candidate);
    selectedKeys.add(key);
    if (selected.length >= limit) break;
  }

  return selected;
}

function nearestProtectionCandidate(
  candidates: PppCandidate[],
  protectionBps: number,
  targetProtectionBps: number,
  selectedKeys: Set<string>
): PppCandidate | null {
  let best: PppCandidate | null = null;
  let bestScore = Infinity;
  candidates.forEach((candidate, index) => {
    const key = getPppCandidateKey(candidate);
    if (selectedKeys.has(key)) return;
    const candidateProtectionBps = normalizeBps(candidate.quotedProtectionBps, candidate.quotedProtection ?? candidate.protectionLevel);
    const score =
      Math.abs(candidateProtectionBps - protectionBps) * 1_000_000 +
      Math.abs(candidateProtectionBps - targetProtectionBps) * 1_000 +
      index;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return best;
}

function buildDisplayProtectionSlots(targetProtectionBps: number): number[] {
  const target = clamp(Math.round(targetProtectionBps), 0, 10000);
  const slots = new Set<number>([target]);
  for (let offset = DISPLAY_PROTECTION_STEP_BPS; offset <= 10000; offset += DISPLAY_PROTECTION_STEP_BPS) {
    slots.add(clamp(target - offset, 0, 10000));
    slots.add(clamp(target + offset, 0, 10000));
  }
  return [...slots];
}

function uniqueByCandidateKey(candidates: Array<PppCandidate | null>): PppCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is PppCandidate => {
    if (!candidate) return false;
    const key = getPppCandidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeBps(value: number | null | undefined, decimalFallback: number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof decimalFallback === "number" && Number.isFinite(decimalFallback)) return Math.round(decimalFallback * 10000);
  return -1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
