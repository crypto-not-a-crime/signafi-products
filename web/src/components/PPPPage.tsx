"use client";

import { useEffect, useMemo, useState } from "react";
import type { PppCandidate, PppPricingRequest, PppPricingResponse, PppPriorityLever, PppSelectorMode } from "@/types";
import { formatPct, formatUsd } from "@/lib/format";
import { getPppCandidateKey, getPppRecommendations } from "@/lib/ppp-recommendations";
import { SiteNav } from "./Logo";

const durationOptions = [
  { id: "1m", label: "1 month", days: 30 },
  { id: "3m", label: "3 months", days: 92 },
  { id: "6m", label: "6 months", days: 180 },
  { id: "12m", label: "12 months", days: 365 }
];

const investmentOptions = [50000, 100000, 250000, 500000, 1000000, 2000000, 5000000, 10000000];
const protectionOptions = [70, 75, 80, 85, 90, 95, 100];
const participationOptions = [15, 20, 25, 30, 35, 40, 50, 60, 70, 80];

export function PPPPage() {
  const [investmentUsdt, setInvestmentUsdt] = useState(1000000);
  const [duration, setDuration] = useState("3m");
  const [selectorMode, setSelectorMode] = useState<PppSelectorMode>("auto_participation");
  const [priorityLever, setPriorityLever] = useState<PppPriorityLever>("protection");
  const [protectionPct, setProtectionPct] = useState(80);
  const [participationPct, setParticipationPct] = useState(30);
  const [data, setData] = useState<PppPricingResponse | null>(null);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);
  const [simulatorExpiryPrice, setSimulatorExpiryPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runwayDays = useMemo(() => durationOptions.find((item) => item.id === duration)?.days ?? 92, [duration]);
  const priorityOptions = useMemo(() => getPppPriorityOptions(selectorMode), [selectorMode]);
  const effectivePriorityLever = priorityOptions.some((option) => option.id === priorityLever)
    ? priorityLever
    : priorityOptions[0]?.id;
  const best = data?.bestCandidate ?? null;
  const targetProtectionBps = Math.round(protectionPct * 100);
  const targetParticipationBps = Math.round(participationPct * 100);
  const candidates = useMemo(
    () =>
      getPppRecommendations({
        best,
        candidates: data?.candidates,
        selectorMode,
        priorityLever: effectivePriorityLever,
        targetProtectionBps,
        targetParticipationBps,
        limit: 3
      }),
    [best, data?.candidates, effectivePriorityLever, selectorMode, targetParticipationBps, targetProtectionBps]
  );
  const selectedCandidate = selectedCandidateKey
    ? candidates.find((candidate) => getPppCandidateKey(candidate) === selectedCandidateKey) ?? best
    : best;
  const simulatorRange = useMemo(
    () => (selectedCandidate ? getPppScenarioRange(selectedCandidate) : null),
    [selectedCandidate]
  );
  const selectedExpiryPrice = simulatorExpiryPrice ?? simulatorRange?.defaultPrice ?? null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchPricing();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [investmentUsdt, runwayDays, protectionPct, participationPct, selectorMode, effectivePriorityLever]);

  useEffect(() => {
    if (effectivePriorityLever && effectivePriorityLever !== priorityLever) {
      setPriorityLever(effectivePriorityLever);
    }
  }, [effectivePriorityLever, priorityLever]);

  useEffect(() => {
    if (!data) {
      setSelectedCandidateKey(null);
      return;
    }
    setSelectedCandidateKey(data.bestCandidate ? getPppCandidateKey(data.bestCandidate) : null);
  }, [data]);

  useEffect(() => {
    setSimulatorExpiryPrice(simulatorRange?.defaultPrice ?? null);
  }, [simulatorRange]);

  async function fetchPricing() {
    setLoading(true);
    setError(null);
    try {
      const pricingRequest: PppPricingRequest = {
        investmentUsdt,
        runwayDays,
        protectionLevelBps: Math.round(protectionPct * 100),
        participationLevelBps: Math.round(participationPct * 100),
        selectorMode,
        priorityLever: effectivePriorityLever,
        maxSlippageBps: 500,
        quoteFreshnessSeconds: 10,
        orderBookDepth: 100
      };
      const response = await fetch("/api/products/ppp/price", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pricingRequest)
      });
      if (!response.ok) throw new Error(`Pricing failed with ${response.status}`);
      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pricing failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <SiteNav active="ppp" />
      <main className="levers-page levers-page-rail">
        <section className="hero" style={{ minHeight: "auto", paddingBottom: 46 }}>
          <div className="hero-inner" style={{ maxWidth: 760 }}>
            <div className="hero-tag">Yield Platform - Interactive</div>
            <h1>
              Protected downside.
              <br />
              <em>Quoted upside.</em>
            </h1>
            <p className="hero-sub">
              Select the investment size, target duration, and solver mode. The PPP engine checks live executable
              Deribit depth before quoting client participation or protection.
            </p>
          </div>
        </section>

        <section className="page-shell">
          <div className="levers-rail-wrap">
            <div className="lever-panel">
              <h2 className="lever-title">Set your terms</h2>
              <p className="card-copy">
                Select the solve mode, then set the terms the engine should hold fixed for the live hedge quote.
              </p>

              <div className="control-block">
                <div className="row-between">
                  <div>
                    <div className="field-label">Selector</div>
                    <strong>What should the engine solve for?</strong>
                  </div>
                </div>
                <div className="pill-row">
                  {[
                    ["closest", "Closest Match"],
                    ["auto_participation", "Auto Participation"],
                    ["auto_protection", "Auto Protection"]
                  ].map(([id, label]) => (
                    <button
                      className={`choice-pill ${selectorMode === id ? "active" : ""}`}
                      key={id}
                      onClick={() => setSelectorMode(id as PppSelectorMode)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {priorityOptions.length > 0 ? (
                  <div className="priority-control">
                    <div>
                      <div className="field-label">Priority</div>
                      <strong>When fixed inputs conflict, which should win?</strong>
                    </div>
                    <div className="pill-row">
                      {priorityOptions.map((option) => (
                        <button
                          className={`choice-pill ${effectivePriorityLever === option.id ? "active" : ""}`}
                          key={option.id}
                          onClick={() => setPriorityLever(option.id)}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="control-block">
                <div className="row-between">
                  <div>
                    <div className="field-label">Investable amount</div>
                    <strong>How much are you investing?</strong>
                  </div>
                  <strong className="mono">{formatUsd(investmentUsdt)}</strong>
                </div>
                <input
                  type="range"
                  min={50000}
                  max={10000000}
                  step={50000}
                  value={investmentUsdt}
                  onChange={(event) => setInvestmentUsdt(Number(event.target.value))}
                />
                <div className="quick-btns">
                  {investmentOptions.map((amount) => (
                    <button
                      className={`quick-btn ${amount === investmentUsdt ? "active" : ""}`}
                      key={amount}
                      onClick={() => setInvestmentUsdt(amount)}
                    >
                      {amount >= 1000000 ? `$${amount / 1000000}M` : `$${amount / 1000}k`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="control-block">
                <div className="row-between">
                  <div>
                    <div className="field-label">Duration</div>
                    <strong>How long should the product run?</strong>
                  </div>
                  <strong className="mono">{durationOptions.find((item) => item.id === duration)?.label}</strong>
                </div>
                <div className="pill-row">
                  {durationOptions.map((item) => (
                    <button
                      className={`choice-pill ${duration === item.id ? "active" : ""}`}
                      key={item.id}
                      onClick={() => setDuration(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="control-block">
                <div className="row-between">
                  <div>
                    <div className="field-label">Protection level</div>
                    <strong>Minimum principal return</strong>
                  </div>
                  <strong className="mono">
                    {selectorMode === "auto_protection" && selectedCandidate
                      ? formatPct(selectedCandidate.quotedProtection, 2)
                      : `${protectionPct}%`}
                  </strong>
                </div>
                <input
                  type="range"
                  min={60}
                  max={100}
                  step={1}
                  value={protectionPct}
                  disabled={selectorMode === "auto_protection"}
                  onChange={(event) => setProtectionPct(Number(event.target.value))}
                />
                <div className="pill-row">
                  {protectionOptions.map((pct) => (
                    <button
                      className={`choice-pill ${protectionPct === pct ? "active" : ""}`}
                      disabled={selectorMode === "auto_protection"}
                      key={pct}
                      onClick={() => setProtectionPct(pct)}
                      type="button"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="control-block">
                <div className="row-between">
                  <div>
                    <div className="field-label">Participation level</div>
                    <strong>Client upside participation</strong>
                  </div>
                  <strong className="mono">
                    {selectorMode === "auto_participation" && selectedCandidate
                      ? formatPct(selectedCandidate.quotedParticipation, 2)
                      : `${participationPct}%`}
                  </strong>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={participationPct}
                  disabled={selectorMode === "auto_participation"}
                  onChange={(event) => setParticipationPct(Number(event.target.value))}
                />
                <div className="pill-row">
                  {participationOptions.map((pct) => (
                    <button
                      className={`choice-pill ${participationPct === pct ? "active" : ""}`}
                      disabled={selectorMode === "auto_participation"}
                      key={pct}
                      onClick={() => setParticipationPct(pct)}
                      type="button"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <aside className="recommendation-rail" aria-label="PPP recommendations">
              <div className="rail-header">
                <div>
                  <div className="pc-label">Top matches</div>
                  <h2 className="rail-title">Product recommendations</h2>
                </div>
                <div className="rail-actions">
                  <button
                    aria-busy={loading}
                    aria-label={loading ? "Refreshing quotes" : "Refresh quotes"}
                    className="rail-refresh-btn"
                    disabled={loading}
                    onClick={() => void fetchPricing()}
                    type="button"
                  >
                    {loading ? <span className="loading-spinner" aria-hidden="true" /> : "Refresh quotes"}
                  </button>
                  <span className={`status-badge ${data?.mock || !data ? "status-warn" : "status-live"}`}>
                    {data?.mock ? "Mock" : data ? "Live" : "Checking"}
                  </span>
                </div>
              </div>
              {error ? <div className="rail-state rail-error">{error}</div> : null}
              {data && !loading && candidates.length === 0 ? (
                <div className="rail-state">No eligible PPP package passed the current checks.</div>
              ) : null}
              <div className="rail-list">
                {candidates.map((candidate) => {
                  const candidateKey = getPppCandidateKey(candidate);
                  return (
                    <PppRecommendationCard
                      best={candidateKey === (best ? getPppCandidateKey(best) : null)}
                      candidate={candidate}
                      key={candidateKey}
                      onSelect={() => setSelectedCandidateKey(candidateKey)}
                      selected={candidateKey === (selectedCandidate ? getPppCandidateKey(selectedCandidate) : null)}
                    />
                  );
                })}
              </div>
            </aside>
          </div>

          <div className="rail-detail-grid">
            <aside className="result-panel rail-summary-panel">
              <div className="result-card">
                <div className="sum-lbl">
                  {selectorMode === "auto_protection" ? "Quoted client protection" : "Quoted client participation"}
                </div>
                <div className="result-figure">
                  {selectorMode === "auto_protection"
                    ? formatPct(selectedCandidate?.quotedProtection, 2)
                    : formatPct(selectedCandidate?.quotedParticipation, 2)}
                </div>
                <p className="small-muted">
                  on {formatUsd(investmentUsdt)} with{" "}
                  {selectorMode === "auto_protection" ? `${participationPct}% participation` : `${protectionPct}% protection`}
                </p>
                <div className="metric-grid">
                  <Metric label="Duration" value={`${selectedCandidate?.dayCount ?? runwayDays} days`} />
                  <Metric label="BTC spot" value={formatUsd(selectedCandidate?.spotPrice)} />
                  <Metric label="Target margin" value={formatPct((selectedCandidate?.targetFirmMarginBps ?? 500) / 10000, 1)} />
                  <Metric label="Quote status" value={selectedCandidate?.checks.quoteFresh ? "Live" : "Checking"} />
                </div>
              </div>
              {data?.mock ? (
                <div className="candidate-card">
                  <span className="status-badge status-warn">Local mock mode</span>
                  <p className="card-copy">Configure `WORKER_API_BASE_URL` to use Cloudflare D1 and live Deribit data.</p>
                </div>
              ) : null}
            </aside>

            <section className="rail-detail-panel" aria-label="PPP product details">
              {selectedCandidate && simulatorRange && selectedExpiryPrice !== null ? (
                <PppClientPayoutSimulator
                  candidate={selectedCandidate}
                  expiryPrice={selectedExpiryPrice}
                  range={simulatorRange}
                  onChange={setSimulatorExpiryPrice}
                />
              ) : null}
            </section>
          </div>
        </section>
      </main>
    </>
  );
}

function PppRecommendationCard({
  candidate,
  best,
  selected,
  onSelect
}: {
  candidate: PppCandidate;
  best: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      aria-label={`Select PPP expiring ${formatDate(candidate.expirationTimestamp)}`}
      aria-pressed={selected}
      className={`recommendation-card ${best ? "best" : ""} ${selected ? "selected" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <div className="recommendation-card-top">
        <span className={`status-badge ${best ? "status-live" : "status-warn"}`}>{best ? "Best match" : "Alternative"}</span>
        {selected ? <span className="status-badge status-live">Selected</span> : null}
      </div>
      <h3 className="recommendation-name">Partial Principal Protection & Upside Participation</h3>
      <div className="recommendation-yield-row">
        <span>Participation</span>
        <strong>{formatPct(candidate.quotedParticipation, 2)}</strong>
      </div>
      <dl className="recommendation-terms">
        <div>
          <dt>Protection</dt>
          <dd>
            {formatPct(candidate.quotedProtection, 2)}
            <span>floor strike {formatUsd(getProductFloorPrice(candidate))}</span>
          </dd>
        </div>
        <div>
          <dt>Expiry</dt>
          <dd>
            {formatDate(candidate.expirationTimestamp)}
            <span>{candidate.dayCount} days</span>
          </dd>
        </div>
      </dl>
    </button>
  );
}

function PppClientPayoutSimulator({
  candidate,
  expiryPrice,
  range,
  onChange
}: {
  candidate: PppCandidate;
  expiryPrice: number;
  range: ReturnType<typeof getPppScenarioRange>;
  onChange: (value: number) => void;
}) {
  const protection = candidate.quotedProtection ?? candidate.protectionLevel;
  const participation = candidate.quotedParticipation ?? 0;
  const expiryRatio = candidate.spotPrice > 0 ? expiryPrice / candidate.spotPrice : 0;
  const payout =
    expiryPrice > candidate.spotPrice
      ? candidate.investmentUsdt * (1 + participation * (expiryRatio - 1))
      : candidate.investmentUsdt * Math.max(expiryRatio, protection);
  const scenario =
    expiryPrice > candidate.spotPrice
      ? "Upside participation"
      : expiryRatio < protection
        ? "Below protection floor"
        : "Principal floor";

  return (
    <div className="candidate-card payout-simulator">
      <div className="row-between">
        <div>
          <div className="pc-label">Client payout simulator</div>
          <h3 className="card-title">USDT redemption</h3>
        </div>
        <span className="status-badge status-live">USDT</span>
      </div>
      <div className="control-block compact-control">
        <div className="row-between">
          <span className="field-label">BTC expiry price</span>
          <strong className="mono">{formatUsd(expiryPrice)}</strong>
        </div>
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={expiryPrice}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <div className="range-labels">
          <span>{formatUsd(range.min)}</span>
          <span>Spot {formatUsd(candidate.spotPrice)}</span>
          <span>{formatUsd(range.max)}</span>
        </div>
      </div>
      <dl className="product-terms">
        <Term label="Expiry" value={formatDate(candidate.expirationTimestamp)} detail={`${candidate.dayCount} days`} />
      </dl>
      <div className="metric-grid">
        <Metric label="Client receives" value={formatUsd(payout, 2)} tone="ok" />
        <Metric label="Scenario" value={scenario} />
        <Metric label="Participation rate" value={formatPct(participation, 2)} tone="ok" />
        <Metric label="Protection rate" value={formatPct(protection, 2)} />
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "fail" }) {
  return (
    <div className="metric-card">
      <div className="sum-lbl">{label}</div>
      <div className={`metric-value ${tone === "ok" ? "green" : tone === "fail" ? "red" : ""}`}>{value}</div>
    </div>
  );
}

function Term({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        {detail ? <span>{detail}</span> : null}
      </dd>
    </div>
  );
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp));
}

function getProductFloorPrice(candidate: PppCandidate) {
  return candidate.spotPrice * (candidate.quotedProtection ?? candidate.protectionLevel);
}

function getPppPriorityOptions(selectorMode: PppSelectorMode): Array<{ id: PppPriorityLever; label: string }> {
  if (selectorMode === "auto_participation") {
    return [
      { id: "protection", label: "Prioritize Protection" },
      { id: "duration", label: "Prioritize Duration" }
    ];
  }
  if (selectorMode === "auto_protection") {
    return [
      { id: "duration", label: "Prioritize Duration" },
      { id: "participation", label: "Prioritize Participation" }
    ];
  }
  return [];
}

function getPppScenarioRange(candidate: PppCandidate) {
  const step = 1000;
  const min = roundToStep(candidate.spotPrice * 0.5, step);
  const max = roundToStep(candidate.spotPrice * 1.6, step);
  const defaultPrice = clamp(roundToStep(candidate.spotPrice, step), min, max);
  return { min, max, step, defaultPrice };
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
