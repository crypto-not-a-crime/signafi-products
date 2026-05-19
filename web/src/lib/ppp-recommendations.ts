import type { PppCandidate, PppPriorityLever, PppSelectorMode } from "../types";

const DISPLAY_PROTECTION_STEP_BPS = 500;
const DISPLAY_PARTICIPATION_STEP_BPS = 500;

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
  targetParticipationBps,
  limit = 3
}: {
  best: PppCandidate | null;
  candidates: PppCandidate[] | undefined;
  selectorMode: PppSelectorMode;
  priorityLever: PppPriorityLever | undefined;
  targetProtectionBps: number;
  targetParticipationBps?: number;
  limit?: number;
}): PppCandidate[] {
  const ordered = collapseRecommendationCandidates(selectorMode, [best, ...(candidates ?? [])]);
  const eligible = ordered.filter((candidate) => candidate.eligible);
  const pool = eligible.length > 0 ? eligible : ordered;
  if (selectorMode === "auto_participation" && priorityLever === "duration") {
    return shapeDurationPriorityRecommendations(pool, best, targetProtectionBps, limit);
  }
  if (selectorMode === "auto_protection" && priorityLever === "duration") {
    return shapeAutoProtectionDurationPriorityRecommendations(pool, best, targetParticipationBps ?? 0, limit);
  }
  if (selectorMode === "auto_protection" && priorityLever === "participation") {
    return shapeAutoProtectionParticipationPriorityRecommendations(pool, targetParticipationBps ?? 0, limit);
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

function shapeAutoProtectionDurationPriorityRecommendations(
  candidates: PppCandidate[],
  best: PppCandidate | null,
  targetParticipationBps: number,
  limit: number
): PppCandidate[] {
  const anchorKey = best ? getPppCandidateKey(best) : null;
  const anchor = (anchorKey ? candidates.find((candidate) => getPppCandidateKey(candidate) === anchorKey) : null) ?? candidates[0];
  if (!anchor) return [];

  const sameExpiry = candidates.filter((candidate) => candidate.expirationTimestamp === anchor.expirationTimestamp);
  const selected: PppCandidate[] = [];
  const selectedKeys = new Set<string>();

  for (const participationBps of buildDisplayParticipationSlots(targetParticipationBps)) {
    const next = nearestParticipationCandidate(sameExpiry, participationBps, targetParticipationBps, selectedKeys);
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

function shapeAutoProtectionParticipationPriorityRecommendations(
  candidates: PppCandidate[],
  targetParticipationBps: number,
  limit: number
): PppCandidate[] {
  const perExpiry = new Map<number, PppCandidate>();
  for (const candidate of candidates) {
    const existing = perExpiry.get(candidate.expirationTimestamp);
    if (
      !existing ||
      compareParticipationFit(candidate, existing, targetParticipationBps) < 0
    ) {
      perExpiry.set(candidate.expirationTimestamp, candidate);
    }
  }
  return [...perExpiry.values()]
    .sort((a, b) => compareParticipationFit(a, b, targetParticipationBps))
    .slice(0, limit);
}

function nearestParticipationCandidate(
  candidates: PppCandidate[],
  participationBps: number,
  targetParticipationBps: number,
  selectedKeys: Set<string>
): PppCandidate | null {
  let best: PppCandidate | null = null;
  let bestScore = Infinity;
  candidates.forEach((candidate, index) => {
    const key = getPppCandidateKey(candidate);
    if (selectedKeys.has(key)) return;
    const candidateParticipationBps = normalizeBps(candidate.quotedParticipationBps, candidate.quotedParticipation);
    const score =
      Math.abs(candidateParticipationBps - participationBps) * 1_000_000 +
      Math.abs(candidateParticipationBps - targetParticipationBps) * 1_000 +
      index;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return best;
}

function compareParticipationFit(a: PppCandidate, b: PppCandidate, targetParticipationBps: number): number {
  const aGap = Math.abs(normalizeBps(a.quotedParticipationBps, a.quotedParticipation) - targetParticipationBps);
  const bGap = Math.abs(normalizeBps(b.quotedParticipationBps, b.quotedParticipation) - targetParticipationBps);
  if (aGap !== bGap) return aGap - bGap;
  if (a.dayCount !== b.dayCount) return a.dayCount - b.dayCount;
  return normalizeBps(b.quotedProtectionBps, b.quotedProtection) - normalizeBps(a.quotedProtectionBps, a.quotedProtection);
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

function buildDisplayParticipationSlots(targetParticipationBps: number): number[] {
  const target = clamp(Math.round(targetParticipationBps), 0, 10000);
  const slots = new Set<number>([target]);
  for (let offset = DISPLAY_PARTICIPATION_STEP_BPS; offset <= 10000; offset += DISPLAY_PARTICIPATION_STEP_BPS) {
    slots.add(clamp(target - offset, 0, 10000));
    slots.add(clamp(target + offset, 0, 10000));
  }
  return [...slots];
}

function collapseRecommendationCandidates(
  selectorMode: PppSelectorMode,
  candidates: Array<PppCandidate | null>
): PppCandidate[] {
  if (selectorMode !== "auto_protection") return uniqueByCandidateKey(candidates);

  const byFixedInputs = new Map<string, PppCandidate>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = [
      candidate.expirationTimestamp,
      normalizeBps(candidate.quotedParticipationBps, candidate.quotedParticipation)
    ].join(":");
    const existing = byFixedInputs.get(key);
    if (!existing || compareProtectionQuote(candidate, existing) < 0) {
      byFixedInputs.set(key, candidate);
    }
  }
  return [...byFixedInputs.values()];
}

function compareProtectionQuote(a: PppCandidate, b: PppCandidate): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  return normalizeBps(b.quotedProtectionBps, b.quotedProtection) - normalizeBps(a.quotedProtectionBps, a.quotedProtection);
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
