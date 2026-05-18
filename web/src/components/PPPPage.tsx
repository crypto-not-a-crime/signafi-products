"use client";

import { useEffect, useMemo, useState } from "react";
import type { PppCandidate, PppPricingRequest, PppPricingResponse, PppSelectorMode } from "@/types";
import { formatNumber, formatPct, formatUsd } from "@/lib/format";
import { SiteNav } from "./Logo";

const durationOptions = [
  { id: "1m", label: "1 month", days: 30 },
  { id: "3m", label: "3 months", days: 92 },
  { id: "6m", label: "6 months", days: 180 },
  { id: "12m", label: "12 months", days: 365 }
];

const investmentOptions = [50000, 100000, 250000, 500000, 1000000, 2000000, 5000000, 10000000];
const protectionOptions = [70, 75, 80, 85, 90, 95, 100];
const participationOptions = [15, 20, 25, 30, 35, 40, 50];

export function PPPPage() {
  const [investmentUsdt, setInvestmentUsdt] = useState(1000000);
  const [duration, setDuration] = useState("3m");
  const [selectorMode, setSelectorMode] = useState<PppSelectorMode>("auto_participation");
  const [protectionPct, setProtectionPct] = useState(80);
  const [participationPct, setParticipationPct] = useState(30);
  const [data, setData] = useState<PppPricingResponse | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runwayDays = useMemo(() => durationOptions.find((item) => item.id === duration)?.days ?? 92, [duration]);
  const best = data?.bestCandidate ?? null;
  const candidates = useMemo(() => getUniqueCandidates(best, data?.candidates), [best, data?.candidates]);
  const selectedCandidate = selectedExpiry
    ? candidates.find((candidate) => candidate.expirationTimestamp === selectedExpiry) ?? best
    : best;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchPricing();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [investmentUsdt, runwayDays, protectionPct, participationPct, selectorMode]);

  useEffect(() => {
    if (!data) {
      setSelectedExpiry(null);
      return;
    }
    setSelectedExpiry((current) =>
      current && candidates.some((candidate) => candidate.expirationTimestamp === current)
        ? current
        : data.bestCandidate?.expirationTimestamp ?? null
    );
  }, [candidates, data]);

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
              <h2 className="lever-title">Set your PPP terms</h2>
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
                    <strong>{selectorMode === "auto_protection" ? "Engine output" : "Minimum principal return"}</strong>
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
                    <strong>{selectorMode === "auto_participation" ? "Engine output" : "Client upside participation"}</strong>
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
                  <h2 className="rail-title">PPP recommendations</h2>
                </div>
                <div className="rail-actions">
                  <button className="rail-refresh-btn" disabled={loading} onClick={() => void fetchPricing()} type="button">
                    {loading ? "Refreshing..." : "Refresh quotes"}
                  </button>
                  <span className={`status-badge ${data?.mock || !data ? "status-warn" : "status-live"}`}>
                    {data?.mock ? "Mock" : data ? "Live" : "Checking"}
                  </span>
                </div>
              </div>
              {loading ? <div className="rail-state">Refreshing Deribit depth and pricing...</div> : null}
              {error ? <div className="rail-state rail-error">{error}</div> : null}
              {data && !loading && candidates.length === 0 ? (
                <div className="rail-state">No eligible PPP package passed the current checks.</div>
              ) : null}
              <div className="rail-list">
                {candidates.slice(0, 3).map((candidate) => (
                  <PppRecommendationCard
                    best={candidate.expirationTimestamp === best?.expirationTimestamp}
                    candidate={candidate}
                    key={candidate.expirationTimestamp}
                    onSelect={() => setSelectedExpiry(candidate.expirationTimestamp)}
                    selected={candidate.expirationTimestamp === selectedCandidate?.expirationTimestamp}
                  />
                ))}
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
              {selectedCandidate ? <PppDetailCard candidate={selectedCandidate} /> : null}
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
      <h3 className="recommendation-name">PPP {formatDate(candidate.expirationTimestamp)}</h3>
      <div className="recommendation-yield-row">
        <span>Participation</span>
        <strong>{formatPct(candidate.quotedParticipation, 2)}</strong>
      </div>
      <dl className="recommendation-terms">
        <div>
          <dt>Protection</dt>
          <dd>
            {formatPct(candidate.quotedProtection, 2)}
            <span>floor strike {formatUsd(candidate.floorPutStrike)}</span>
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>
            {candidate.dayCount} days
            <span>min PnL {formatUsd(candidate.minScenarioPnlUsdt)}</span>
          </dd>
        </div>
      </dl>
    </button>
  );
}

function PppDetailCard({ candidate }: { candidate: PppCandidate }) {
  return (
    <div className="candidate-card best">
      <div className="row-between">
        <div>
          <div className="pc-label">Selected package</div>
          <h3 className="card-title">Partial Principal Protected Upside Participation</h3>
        </div>
        <span className={`status-badge ${candidate.eligible ? "status-live" : "status-warn"}`}>
          {candidate.eligible ? "Eligible" : "Review"}
        </span>
      </div>
      <div className="metric-grid">
        <Metric label={candidate.recommendedLever === "protection" ? "Max protection" : "Protection"} value={formatPct(candidate.quotedProtection, 2)} tone={candidate.recommendedLever === "protection" ? "ok" : undefined} />
        <Metric label={candidate.recommendedLever === "participation" ? "Max participation" : "Participation"} value={formatPct(candidate.quotedParticipation, 2)} tone={candidate.recommendedLever === "participation" ? "ok" : undefined} />
        <Metric label="Min scenario P&L" value={formatUsd(candidate.minScenarioPnlUsdt)} tone={(candidate.minScenarioPnlUsdt ?? 0) >= candidate.targetProfitUsdt ? "ok" : "fail"} />
        <Metric label="Stress price" value={formatUsd(candidate.stressPrice)} />
      </div>
      <dl className="product-terms">
        <Term label="Expiry" value={formatDate(candidate.expirationTimestamp)} detail={`${candidate.dayCount} days`} />
        <Term label="Spot S0" value={formatUsd(candidate.spotPrice)} detail="BTC_USDC mid" />
        <Term label="ATM call" value={formatUsd(candidate.atmCallStrike)} detail={`${formatNumber(candidate.optimalCallContracts, 1)} contracts`} />
        <Term label="ATM put" value={formatUsd(candidate.atmPutStrike)} detail={`${formatNumber(candidate.putSpreadContracts, 1)} contracts`} />
        <Term label="Floor put" value={formatUsd(candidate.floorPutStrike)} detail={`implied floor ${formatPct(candidate.putSpreadImpliedFloor, 2)}`} />
      </dl>
      <h3 className="card-title" style={{ marginTop: 22 }}>Executable hedge prices</h3>
      <table className="trace-table">
        <thead>
          <tr>
            <th>Leg</th>
            <th>Instrument</th>
            <th>Avg price</th>
            <th>Contracts</th>
            <th>Slippage</th>
          </tr>
        </thead>
        <tbody>
          {candidate.legs.map((leg) => (
            <tr key={leg.role}>
              <td>{formatLegRole(leg.role)}</td>
              <td className="mono">{leg.instrumentName}</td>
              <td className="mono">{formatNumber(leg.averagePrice, 5)}</td>
              <td className="mono">{formatNumber(leg.requiredContracts, 1)}</td>
              <td className="mono">{formatPct(leg.depth.slippagePct, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

function getUniqueCandidates(best: PppCandidate | null, candidates: PppCandidate[] | undefined) {
  const seen = new Set<number>();
  return [best, ...(candidates ?? [])].filter((candidate): candidate is PppCandidate => {
    if (!candidate || seen.has(candidate.expirationTimestamp)) return false;
    seen.add(candidate.expirationTimestamp);
    return true;
  });
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp));
}

function formatLegRole(role: PppCandidate["legs"][number]["role"]) {
  if (role === "long_call") return "Buy ATM call";
  if (role === "short_put") return "Sell ATM put";
  return "Buy floor put";
}
