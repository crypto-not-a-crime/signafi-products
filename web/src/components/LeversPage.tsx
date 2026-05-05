"use client";

import { useEffect, useMemo, useState } from "react";
import type { DcnCandidate, DcnPricingResponse, DcnRecommendation, DcnSelectorMode } from "@/types";
import { formatNumber, formatPct, formatUsd } from "@/lib/format";
import { calculateScenario, getScenarioRange } from "@/lib/dcn-scenario";
import { SiteNav } from "./Logo";

const runwayOptions = [
  { id: "1m", label: "1 month", days: 30 },
  { id: "3m", label: "3 months", days: 92 },
  { id: "6m", label: "6 months", days: 180 },
  { id: "12m", label: "12 months", days: 365 }
];

export function LeversPage() {
  const [investmentUsdt, setInvestmentUsdt] = useState(500000);
  const [runway, setRunway] = useState("3m");
  const [targetYieldPct, setTargetYieldPct] = useState(10);
  const [strikePreference, setStrikePreference] = useState<"any" | "five_otm" | "ten_otm">("five_otm");
  const [selectorMode, setSelectorMode] = useState<DcnSelectorMode>("closest");
  const [data, setData] = useState<DcnPricingResponse | null>(null);
  const [expiryPrice, setExpiryPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runwayDays = useMemo(() => runwayOptions.find((item) => item.id === runway)?.days ?? 92, [runway]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchPricing();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [investmentUsdt, runwayDays, targetYieldPct, strikePreference, selectorMode]);

  useEffect(() => {
    if (!data?.bestCandidate) return;
    const range = getScenarioRange(data.bestCandidate);
    setExpiryPrice((current) =>
      current === null || current < range.min || current > range.max ? range.defaultPrice : current
    );
  }, [data?.bestCandidate?.instrumentName, data?.bestCandidate?.strike]);

  async function fetchPricing() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/products/dcn/sell-put/price", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          investmentUsdt,
          targetYieldBps: Math.round(targetYieldPct * 100),
          runwayDays,
          strikePreference,
          selectorMode,
          maxSlippageBps: 500,
          quoteFreshnessSeconds: 10,
          orderBookDepth: 100
        })
      });
      if (!response.ok) throw new Error(`Pricing failed with ${response.status}`);
      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pricing failed");
    } finally {
      setLoading(false);
    }
  }

  const best = data?.bestCandidate ?? null;
  const scenarioRange = best ? getScenarioRange(best) : null;
  const selectedExpiryPrice = scenarioRange ? expiryPrice ?? scenarioRange.defaultPrice : null;
  const monthly = investmentUsdt * (targetYieldPct / 100) / 12;
  const riskPct = best?.depth.slippagePct ? Math.min(25, 6 + best.depth.slippagePct * 100) : 8;
  const displayedRunwayDays = best?.dayCount ?? runwayDays;

  return (
    <>
      <SiteNav active="levers" />
      <main className="levers-page">
        <section className="hero" style={{ minHeight: "auto", paddingBottom: 46 }}>
          <div className="hero-inner" style={{ maxWidth: 720 }}>
            <div className="hero-tag">Yield Platform - Interactive</div>
            <h1>
              You set the terms.
              <br />
              <em>We find the product.</em>
            </h1>
            <p className="hero-sub">
              Choose how long your capital can run, what return you want, and how far below spot you are willing to buy
              BTC. The DCN engine checks Deribit depth before proposing a yield.
            </p>
          </div>
        </section>

        <section className="page-shell">
          <div className="levers-wrap">
            <div className="lever-panel">
              <h2 className="lever-title">Set your 3 levers</h2>
              <p className="card-copy">
                The matching engine uses live BTC put options, depth-weighted executable bids, and Signafi's configured
                firm margin.
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
                    ["closest", "Closest match"],
                    ["auto_yield", "Auto return"],
                    ["auto_runway", "Auto runway"],
                    ["auto_strike", "Auto strike"]
                  ].map(([id, label]) => (
                    <button
                      className={`choice-pill ${selectorMode === id ? "active" : ""}`}
                      key={id}
                      onClick={() => setSelectorMode(id as DcnSelectorMode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="control-block">
                <div className="row-between">
                  <div>
                    <div className="field-label">Investment</div>
                    <strong>How much are you investing?</strong>
                  </div>
                  <strong className="mono">{formatUsd(investmentUsdt)}</strong>
                </div>
                <input
                  type="range"
                  min={50000}
                  max={2000000}
                  step={50000}
                  value={investmentUsdt}
                  onChange={(event) => setInvestmentUsdt(Number(event.target.value))}
                />
                <div className="quick-btns">
                  {[50000, 100000, 250000, 500000, 1000000, 2000000].map((amount) => (
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
                    <div className="field-label">Lever 1 - Runway</div>
                    <strong>How long can the product run?</strong>
                  </div>
                  <strong className="mono">{runwayOptions.find((item) => item.id === runway)?.label}</strong>
                </div>
                <div className="pill-row">
                  {runwayOptions.map((item) => (
                    <button
                      className={`choice-pill ${runway === item.id ? "active" : ""}`}
                      key={item.id}
                      onClick={() => setRunway(item.id)}
                      disabled={selectorMode === "auto_runway"}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="control-block">
                <div className="row-between">
                  <div>
                    <div className="field-label">Lever 2 - Returns</div>
                    <strong>What annual return are you targeting?</strong>
                  </div>
                  <strong className="mono">{targetYieldPct}% p.a.</strong>
                </div>
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={targetYieldPct}
                  onChange={(event) => setTargetYieldPct(Number(event.target.value))}
                  disabled={selectorMode === "auto_yield"}
                />
              </div>

              <div className="control-block">
                <div className="row-between">
                  <div>
                    <div className="field-label">Lever 3 - Strike buffer</div>
                    <strong>How far below spot should the put strike sit?</strong>
                  </div>
                </div>
                <div className="pill-row">
                  {[
                    ["five_otm", "Around 5% below"],
                    ["ten_otm", "Around 10% below"],
                    ["any", "Best available"]
                  ].map(([id, label]) => (
                    <button
                      className={`choice-pill ${strikePreference === id ? "active" : ""}`}
                      key={id}
                      onClick={() => setStrikePreference(id as typeof strikePreference)}
                      disabled={selectorMode === "auto_strike"}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <aside className="result-panel">
              <div className="result-card">
                <div className="sum-lbl">Your projected monthly yield</div>
                <div className="result-figure">{formatUsd(best?.clientInterestUsdt ? best.clientInterestUsdt / (best.dayCount / 30) : monthly)}</div>
                <p className="small-muted">
                  on {formatUsd(investmentUsdt)} - target {targetYieldPct}% p.a.
                </p>
                <div className="metric-grid">
                  <div className="metric-card">
                    <div className="sum-lbl">Client yield</div>
                    <div className="metric-value green">{formatPct(best?.clientYield, 1)}</div>
                  </div>
                  <div className="metric-card">
                    <div className="sum-lbl">Runway</div>
                    <div className="metric-value">{displayedRunwayDays} days</div>
                  </div>
                  <div className="metric-card">
                    <div className="sum-lbl">Risk signal</div>
                    <div className="metric-value">{riskPct.toFixed(1)}%</div>
                  </div>
                  <div className="metric-card">
                    <div className="sum-lbl">Quote status</div>
                    <div className="metric-value">{best?.checks.quoteFresh ? "Live" : "Checking"}</div>
                  </div>
                </div>
              </div>

              {loading ? <div className="candidate-card">Refreshing Deribit depth and pricing...</div> : null}
              {error ? <div className="candidate-card"><span className="status-badge status-fail">{error}</span></div> : null}
              {data?.mock ? (
                <div className="candidate-card">
                  <span className="status-badge status-warn">Local mock mode</span>
                  <p className="card-copy">Configure `WORKER_API_BASE_URL` to use Cloudflare D1 and live Deribit data.</p>
                </div>
              ) : null}

              {data && !loading && !best ? (
                <div className="candidate-card">
                  <span className="status-badge status-warn">No eligible match</span>
                  <p className="card-copy">
                    No live put passed the depth, freshness, below-spot strike, slippage, and profitability checks for
                    this combination.
                  </p>
                </div>
              ) : null}

              {best && scenarioRange && selectedExpiryPrice !== null ? (
                <ClientPayoutSimulator
                  candidate={best}
                  expiryPrice={selectedExpiryPrice}
                  range={scenarioRange}
                  onChange={setExpiryPrice}
                />
              ) : null}

              {best && data?.recommendation ? <RecommendationCard recommendation={data.recommendation} candidate={best} /> : null}
              {best ? <CandidateCard candidate={best} best /> : null}
              {data?.candidates?.slice(1, 3).map((candidate) => (
                <CandidateCard candidate={candidate} key={candidate.instrumentName} />
              ))}
            </aside>
          </div>
        </section>
      </main>
    </>
  );
}

function ClientPayoutSimulator({
  candidate,
  expiryPrice,
  range,
  onChange
}: {
  candidate: DcnCandidate;
  expiryPrice: number;
  range: ReturnType<typeof getScenarioRange>;
  onChange: (value: number) => void;
}) {
  const scenario = calculateScenario(candidate, expiryPrice);
  const payout =
    scenario.clientPayoutAsset === "BTC"
      ? `${formatNumber(scenario.clientPayoutAmount, 6)} BTC`
      : formatUsd(scenario.clientPayoutAmount, 2);

  return (
    <div className="candidate-card payout-simulator">
      <div className="row-between">
        <div>
          <div className="pc-label">Client payout simulator</div>
          <h3 className="card-title">{scenario.side === "downside" ? "BTC delivery" : "USDT redemption"}</h3>
        </div>
        <span className="status-badge status-live">{scenario.clientPayoutAsset}</span>
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
          <span>Strike {formatUsd(candidate.strike)}</span>
          <span>{formatUsd(range.max)}</span>
        </div>
      </div>
      <div className="metric-grid">
        <Metric label="Client receives" value={payout} tone="ok" />
        <Metric label="Scenario" value={scenario.side === "downside" ? "Below strike" : "At/above strike"} />
        <Metric label="Client yield" value={formatPct(candidate.clientYield, 1)} tone="ok" />
        <Metric label="Strike" value={formatUsd(candidate.strike)} />
      </div>
      <p className="card-copy">
        Below strike, payout is BTC. At or above strike, payout is USDT principal plus fixed product interest.
      </p>
    </div>
  );
}

function RecommendationCard({
  recommendation,
  candidate
}: {
  recommendation: DcnRecommendation;
  candidate: DcnCandidate;
}) {
  const gap =
    recommendation.targetYieldGapBps === null
      ? "-"
      : `${recommendation.targetYieldGapBps >= 0 ? "+" : ""}${formatNumber(recommendation.targetYieldGapBps, 0)} bps`;
  const runwayGap = recommendation.runwayGapDays === null ? "-" : `${formatNumber(recommendation.runwayGapDays, 0)} days`;
  const strikeGap =
    recommendation.strikeMoneynessGapBps === null
      ? "-"
      : `${formatNumber(recommendation.strikeMoneynessGapBps, 0)} bps`;
  const recommendationValue = formatRecommendationValue(recommendation, candidate);

  return (
    <div className="candidate-card">
      <div className="row-between">
        <div>
          <div className="pc-label">Recommendation</div>
          <h3 className="card-title">{recommendation.recommendedLever === "none" ? "Closest product" : `Recommended ${recommendation.recommendedLever}`}</h3>
        </div>
        <span className="status-badge status-live">{recommendationValue}</span>
      </div>
      <p className="card-copy">{recommendation.reason}</p>
      <div className="metric-grid">
        <Metric label="Yield gap" value={gap} />
        <Metric label="Runway gap" value={runwayGap} />
        <Metric label="Strike gap" value={strikeGap} />
        <Metric label="Mode" value={recommendation.selectorMode.replace("_", " ")} />
      </div>
    </div>
  );
}

function formatRecommendationValue(recommendation: DcnRecommendation, candidate: DcnCandidate) {
  if (recommendation.recommendedLever === "runway") return `${formatNumber(candidate.dayCount, 0)} days`;
  if (recommendation.recommendedLever === "strike") return formatUsd(candidate.strike);
  return formatPct(candidate.clientYield, 1);
}

const DERIBIT_MONTHS: Record<string, string> = {
  JAN: "Jan",
  FEB: "Feb",
  MAR: "Mar",
  APR: "Apr",
  MAY: "May",
  JUN: "Jun",
  JUL: "Jul",
  AUG: "Aug",
  SEP: "Sep",
  OCT: "Oct",
  NOV: "Nov",
  DEC: "Dec"
};

function getInstrumentTerms(candidate: DcnCandidate) {
  const [underlying = "BTC", expiryCode = "", , optionCode = "P"] = candidate.instrumentName.split("-");
  const optionType = optionCode === "C" ? "Call" : "Put";
  return {
    underlying,
    optionType,
    expiryDate: formatDeribitExpiry(expiryCode)
  };
}

function formatDeribitExpiry(expiryCode: string) {
  const match = expiryCode.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!match) return expiryCode || "-";
  const [, day, monthCode, year] = match;
  return `${Number(day)} ${DERIBIT_MONTHS[monthCode] ?? monthCode} 20${year}`;
}

function CandidateCard({ candidate, best = false }: { candidate: DcnCandidate; best?: boolean }) {
  const terms = getInstrumentTerms(candidate);

  return (
    <div className={`candidate-card ${best ? "best" : ""}`}>
      <div className="row-between">
        <div>
          <div className="pc-label">{best ? "Best match" : "Alternative"}</div>
          <h3 className="card-title">
            {terms.underlying} {terms.optionType} Dual Currency Note
          </h3>
        </div>
      </div>
      <dl className="product-terms">
        <div>
          <dt>Underlying</dt>
          <dd>{terms.underlying}</dd>
        </div>
        <div>
          <dt>Expiry Date</dt>
          <dd>{terms.expiryDate}</dd>
        </div>
        <div>
          <dt>Strike Price</dt>
          <dd>{formatUsd(candidate.strike)}</dd>
        </div>
      </dl>
      <div className="metric-grid product-yield">
        <Metric label="Client yield" value={formatPct(candidate.clientYield, 1)} tone="ok" />
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
