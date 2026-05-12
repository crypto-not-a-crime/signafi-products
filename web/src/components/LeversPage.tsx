"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DcnCandidate,
  DcnPricingRequest,
  DcnPricingResponse,
  DcnPriorityLever,
  DcnRecommendation,
  DcnSelectorMode
} from "@/types";
import { formatNumber, formatPct, formatUsd } from "@/lib/format";
import { calculateScenario, getScenarioRange } from "@/lib/dcn-scenario";
import { SiteNav } from "./Logo";

const runwayOptions = [
  { id: "1m", label: "1 month", days: 30 },
  { id: "3m", label: "3 months", days: 92 },
  { id: "6m", label: "6 months", days: 180 },
  { id: "12m", label: "12 months", days: 365 }
];

const investmentOptions = [50000, 100000, 250000, 500000, 1000000, 2000000, 5000000, 10000000];
const btcInvestmentOptions = [1, 2, 5, 10, 25, 50, 100];
type LeversLayoutVariant = "classic" | "rail";
type DcnProductType = "sell_put" | "sell_call";
const putStrikeBufferOptions = [5, 10, 15, 20, 25, 30];
const callStrikeBufferOptions = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
const strikeBufferMaxByProduct: Record<DcnProductType, number> = {
  sell_put: 30,
  sell_call: 200
};

const putCopy = {
  navActive: "dcn-put" as const,
  engineDescription:
    "The matching engine uses live BTC put options, depth-weighted executable bids, and Signafi's configured Put pricing basis.",
  investmentLabel: "Investment",
  investmentPrompt: "How much are you investing?",
  returnPrompt: "What annual return are you targeting?",
  strikePrompt: "How far below spot should the put strike sit?",
  strikeSummary: (pct: number) => `Around ${pct}% below`,
  heroBody:
    "Choose how long your capital can run, what return you want, and how far below spot you are willing to buy BTC. The DCN engine checks Deribit depth before proposing a yield.",
  noMatch:
    "No live put passed the depth, freshness, below-spot strike, slippage, and profitability checks for this combination."
};

const callCopy = {
  navActive: "dcn-call" as const,
  engineDescription:
    "The matching engine uses live BTC call options, depth-weighted executable bids, and the Sell Call workbook yield formula.",
  investmentLabel: "Investment BTC",
  investmentPrompt: "How much BTC are you investing?",
  returnPrompt: "What annual return are you targeting?",
  strikePrompt: "How far above spot should the call strike sit?",
  strikeSummary: (pct: number) => `Around ${pct}% above`,
  heroBody:
    "Choose how long your BTC can run, what return you want, and how far above spot you are willing to sell. The DCN engine checks Deribit depth before proposing a yield.",
  noMatch:
    "No live call passed the depth, freshness, above-spot strike, slippage, and profitability checks for this combination."
};

export function LeversPage({
  productType = "sell_put",
  variant = "rail"
}: { productType?: DcnProductType; variant?: LeversLayoutVariant } = {}) {
  const [investmentUsdt, setInvestmentUsdt] = useState(1000000);
  const [investmentBtc, setInvestmentBtc] = useState(10);
  const [runway, setRunway] = useState("3m");
  const [targetYieldPct, setTargetYieldPct] = useState(10);
  const [strikeBufferMode, setStrikeBufferMode] = useState<"target" | "any">("target");
  const [strikeBufferPct, setStrikeBufferPct] = useState(5);
  const [selectorMode, setSelectorMode] = useState<DcnSelectorMode>("auto_yield");
  const [priorityLever, setPriorityLever] = useState<DcnPriorityLever>("runway");
  const [data, setData] = useState<DcnPricingResponse | null>(null);
  const [selectedInstrumentName, setSelectedInstrumentName] = useState<string | null>(null);
  const [expiryPrice, setExpiryPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCall = productType === "sell_call";
  const copy = isCall ? callCopy : putCopy;
  const yieldDigits = isCall ? 2 : 1;
  const strikeBufferOptions = isCall ? callStrikeBufferOptions : putStrikeBufferOptions;
  const strikeBufferMax = strikeBufferMaxByProduct[productType];
  const runwayDays = useMemo(() => runwayOptions.find((item) => item.id === runway)?.days ?? 92, [runway]);
  const priorityOptions = useMemo(() => getPriorityOptions(selectorMode), [selectorMode]);
  const effectivePriorityLever = priorityOptions.some((option) => option.id === priorityLever)
    ? priorityLever
    : priorityOptions[0]?.id;
  const best = data?.bestCandidate ?? null;
  const allCandidates = useMemo(() => getUniqueCandidates(best, data?.candidates), [best, data?.candidates]);
  const selectedCandidate = useMemo(
    () =>
      selectedInstrumentName
        ? allCandidates.find((candidate) => candidate.instrumentName === selectedInstrumentName) ?? best
        : best,
    [allCandidates, best, selectedInstrumentName]
  );

  useEffect(() => {
    if (strikeBufferPct > strikeBufferMax) {
      setStrikeBufferPct(strikeBufferMax);
    }
  }, [strikeBufferPct, strikeBufferMax]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchPricing();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    investmentUsdt,
    investmentBtc,
    runwayDays,
    targetYieldPct,
    strikeBufferMode,
    strikeBufferPct,
    selectorMode,
    effectivePriorityLever,
    productType
  ]);

  useEffect(() => {
    if (effectivePriorityLever && effectivePriorityLever !== priorityLever) {
      setPriorityLever(effectivePriorityLever);
    }
  }, [effectivePriorityLever, priorityLever]);

  useEffect(() => {
    if (!data) {
      setSelectedInstrumentName(null);
      return;
    }

    setSelectedInstrumentName((current) => {
      if (current && allCandidates.some((candidate) => candidate.instrumentName === current)) return current;
      return data.bestCandidate?.instrumentName ?? null;
    });
  }, [allCandidates, data]);

  useEffect(() => {
    if (!selectedCandidate) return;
    const range = getScenarioRange(selectedCandidate);
    setExpiryPrice((current) =>
      current === null || current < range.min || current > range.max ? range.defaultPrice : current
    );
  }, [selectedCandidate?.instrumentName, selectedCandidate?.spotPrice, selectedCandidate?.strike]);

  async function fetchPricing() {
    setLoading(true);
    setError(null);
    try {
      const pricingRequest: DcnPricingRequest = {
        productType,
        investmentUsdt: isCall ? undefined : investmentUsdt,
        investmentBtc: isCall ? investmentBtc : undefined,
        targetYieldBps: Math.round(targetYieldPct * 100),
        runwayDays,
        strikePreference: strikeBufferMode === "any" ? "any" : undefined,
        strikeBufferPct: strikeBufferMode === "target" ? strikeBufferPct : undefined,
        selectorMode,
        priorityLever: effectivePriorityLever,
        maxSlippageBps: 500,
        quoteFreshnessSeconds: 10,
        orderBookDepth: 100
      };
      const endpoint = isCall ? "/api/products/dcn/sell-call/price" : "/api/products/dcn/sell-put/price";
      const response = await fetch(endpoint, {
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

  const scenarioRange = selectedCandidate ? getScenarioRange(selectedCandidate) : null;
  const selectedExpiryPrice = scenarioRange ? expiryPrice ?? scenarioRange.defaultPrice : null;
  const monthly = isCall ? investmentBtc * (targetYieldPct / 100) / 12 : investmentUsdt * (targetYieldPct / 100) / 12;
  const displayedRunwayDays = selectedCandidate?.dayCount ?? runwayDays;
  const selectedMonthlyYield =
    isCall
      ? selectedCandidate?.clientInterestBtc !== null &&
        selectedCandidate?.clientInterestBtc !== undefined &&
        selectedCandidate.dayCount > 0
        ? selectedCandidate.clientInterestBtc / (selectedCandidate.dayCount / 30)
        : monthly
      : selectedCandidate?.clientInterestUsdt !== null &&
          selectedCandidate?.clientInterestUsdt !== undefined &&
          selectedCandidate.dayCount > 0
        ? selectedCandidate.clientInterestUsdt / (selectedCandidate.dayCount / 30)
        : monthly;
  const projectedMonthlyYield = isCall ? `${formatNumber(selectedMonthlyYield, 6)} BTC` : formatUsd(selectedMonthlyYield);
  const recommendationCandidates = useMemo(
    () => getRecommendationCandidates(best, data?.candidates, selectedCandidate?.instrumentName ?? selectedInstrumentName),
    [best, data?.candidates, selectedCandidate?.instrumentName, selectedInstrumentName]
  );
  const selectedRecommendation = useMemo(
    () =>
      selectedCandidate
        ? buildSelectedRecommendation({
            baseRecommendation: data?.recommendation,
            candidate: selectedCandidate,
            bestInstrumentName: best?.instrumentName ?? null,
            runwayDays,
            selectorMode,
            priorityLever: effectivePriorityLever,
            strikeBufferMode,
            strikeBufferPct,
            targetYieldPct
          })
        : null,
    [
      best?.instrumentName,
      data?.recommendation,
      runwayDays,
      selectedCandidate,
      selectorMode,
      effectivePriorityLever,
      strikeBufferMode,
      strikeBufferPct,
      targetYieldPct
    ]
  );
  const selectedIsAlternative = Boolean(
    selectedCandidate && best && selectedCandidate.instrumentName !== best.instrumentName
  );

  const controlsPanel = (
    <div className="lever-panel">
      <h2 className="lever-title">Set your 3 levers</h2>
      <p className="card-copy">{copy.engineDescription}</p>

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
            ["auto_yield", "Auto Return"],
            ["auto_runway", "Auto Runway"],
            ["auto_strike", "Auto Strike"]
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
            <div className="field-label">Investment</div>
            <strong>{copy.investmentPrompt}</strong>
          </div>
          <strong className="mono">
            {isCall ? `${formatNumber(investmentBtc, 2)} BTC` : formatUsd(investmentUsdt)}
          </strong>
        </div>
        <input
          type="range"
          min={isCall ? 1 : 50000}
          max={isCall ? 100 : 10000000}
          step={isCall ? 0.1 : 50000}
          value={isCall ? investmentBtc : investmentUsdt}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (isCall) setInvestmentBtc(next);
            else setInvestmentUsdt(next);
          }}
        />
        <div className="quick-btns">
          {(isCall ? btcInvestmentOptions : investmentOptions).map((amount) => (
            <button
              className={`quick-btn ${amount === (isCall ? investmentBtc : investmentUsdt) ? "active" : ""}`}
              key={amount}
              onClick={() => {
                if (isCall) setInvestmentBtc(amount);
                else setInvestmentUsdt(amount);
              }}
            >
              {isCall ? `${amount} BTC` : amount >= 1000000 ? `$${amount / 1000000}M` : `$${amount / 1000}k`}
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
            <strong>{copy.returnPrompt}</strong>
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
            <strong>{copy.strikePrompt}</strong>
          </div>
          <strong className="mono">
            {strikeBufferMode === "any" ? "Best available" : copy.strikeSummary(strikeBufferPct)}
          </strong>
        </div>
        <input
          type="range"
          min={5}
          max={strikeBufferMax}
          step={1}
          value={strikeBufferPct}
          onChange={(event) => {
            setStrikeBufferMode("target");
            setStrikeBufferPct(Number(event.target.value));
          }}
          disabled={selectorMode === "auto_strike" || strikeBufferMode === "any"}
        />
        <div className="pill-row">
          {strikeBufferOptions.map((pct) => (
            <button
              className={`choice-pill ${strikeBufferMode === "target" && strikeBufferPct === pct ? "active" : ""}`}
              key={pct}
              onClick={() => {
                setStrikeBufferMode("target");
                setStrikeBufferPct(pct);
              }}
              disabled={selectorMode === "auto_strike"}
            >
              {pct}%
            </button>
          ))}
          <button
            className={`choice-pill ${strikeBufferMode === "any" ? "active" : ""}`}
            onClick={() => setStrikeBufferMode("any")}
            disabled={selectorMode === "auto_strike"}
          >
            Best available
          </button>
        </div>
      </div>
    </div>
  );

  const summaryCard = (
    <div className="result-card">
      <div className="sum-lbl">Your projected monthly yield</div>
      <div className="result-figure">{projectedMonthlyYield}</div>
      <p className="small-muted">
        on {isCall ? `${formatNumber(investmentBtc, 2)} BTC` : formatUsd(investmentUsdt)} - target {targetYieldPct}% p.a.
      </p>
      <div className="metric-grid">
        <div className="metric-card">
          <div className="sum-lbl">Client yield</div>
          <div className="metric-value green">{formatPct(selectedCandidate?.clientYield, yieldDigits)}</div>
        </div>
        <div className="metric-card">
          <div className="sum-lbl">Runway</div>
          <div className="metric-value">{displayedRunwayDays} days</div>
        </div>
        <div className="metric-card">
          <div className="sum-lbl">BTC spot</div>
          <div className="metric-value">{formatUsd(selectedCandidate?.spotPrice)}</div>
        </div>
        <div className="metric-card">
          <div className="sum-lbl">Quote status</div>
          <div className="metric-value">{selectedCandidate?.checks.quoteFresh ? "Live" : "Checking"}</div>
        </div>
      </div>
    </div>
  );

  const statusCards = (
    <>
      {loading ? <div className="candidate-card">Refreshing Deribit depth and pricing...</div> : null}
      {error ? (
        <div className="candidate-card">
          <span className="status-badge status-fail">{error}</span>
        </div>
      ) : null}
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
            {copy.noMatch}
          </p>
        </div>
      ) : null}
    </>
  );

  const guidanceCards = (
    <>
      {selectedCandidate && scenarioRange && selectedExpiryPrice !== null ? (
        <ClientPayoutSimulator
          candidate={selectedCandidate}
          expiryPrice={selectedExpiryPrice}
          range={scenarioRange}
          onChange={setExpiryPrice}
        />
      ) : null}

      {selectedCandidate && selectedRecommendation ? (
        <RecommendationCard
          candidate={selectedCandidate}
          recommendation={selectedRecommendation}
          selectedAlternative={selectedIsAlternative}
        />
      ) : null}
    </>
  );

  const productCards = (
    <>
      {best ? <CandidateCard candidate={best} best /> : null}
      {data?.candidates?.slice(1, 3).map((candidate) => (
        <CandidateCard candidate={candidate} key={candidate.instrumentName} />
      ))}
    </>
  );

  const detailCards = (
    <>
      {guidanceCards}
      {productCards}
    </>
  );

  return (
    <>
      <SiteNav active={copy.navActive} />
      <main className={`levers-page ${variant === "rail" ? "levers-page-rail" : ""}`}>
        <section className="hero" style={{ minHeight: "auto", paddingBottom: 46 }}>
          <div className="hero-inner" style={{ maxWidth: 720 }}>
            <div className="hero-tag">Yield Platform - Interactive</div>
            <h1>
              You set the terms.
              <br />
              <em>We find the product.</em>
            </h1>
            <p className="hero-sub">
              {copy.heroBody}
            </p>
          </div>
        </section>

        <section className="page-shell">
          {variant === "rail" ? (
            <>
              <div className="levers-rail-wrap">
                {controlsPanel}
                <RecommendationRail
                  bestInstrumentName={best?.instrumentName ?? null}
                  candidates={recommendationCandidates}
                  hasData={Boolean(data)}
                  loading={loading}
                  error={error}
                  mock={Boolean(data?.mock)}
                  onRefresh={() => void fetchPricing()}
                  onSelect={setSelectedInstrumentName}
                  selectedInstrumentName={selectedCandidate?.instrumentName ?? null}
                />
              </div>
              <div className="rail-detail-grid">
                <aside className="result-panel rail-summary-panel">
                  {summaryCard}
                  {statusCards}
                </aside>
                <section className="rail-detail-panel" aria-label="Product details">
                  {guidanceCards}
                </section>
              </div>
            </>
          ) : (
            <div className="levers-wrap">
              {controlsPanel}
              <aside className="result-panel">
                {summaryCard}
                {statusCards}
                {detailCards}
              </aside>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function getUniqueCandidates(best: DcnCandidate | null, candidates: DcnCandidate[] | undefined) {
  const seen = new Set<string>();
  return [best, ...(candidates ?? [])].filter((candidate): candidate is DcnCandidate => {
    if (!candidate || seen.has(candidate.instrumentName)) return false;
    seen.add(candidate.instrumentName);
    return true;
  });
}

function getRecommendationCandidates(
  best: DcnCandidate | null,
  candidates: DcnCandidate[] | undefined,
  selectedInstrumentName: string | null | undefined
) {
  return getUniqueCandidates(best, candidates).filter(
    (candidate, index) => index < 3 || candidate.instrumentName === selectedInstrumentName
  );
}

function RecommendationRail({
  bestInstrumentName,
  candidates,
  hasData,
  loading,
  error,
  mock,
  onRefresh,
  onSelect,
  selectedInstrumentName
}: {
  bestInstrumentName: string | null;
  candidates: DcnCandidate[];
  hasData: boolean;
  loading: boolean;
  error: string | null;
  mock: boolean;
  onRefresh: () => void;
  onSelect: (instrumentName: string) => void;
  selectedInstrumentName: string | null;
}) {
  const statusLabel = !hasData ? "Checking" : mock ? "Mock" : "Live";
  const statusClassName = !hasData || mock ? "status-warn" : "status-live";

  return (
    <aside className="recommendation-rail" aria-label="Top product recommendations">
      <div className="rail-header">
        <div>
          <div className="pc-label">Top matches</div>
          <h2 className="rail-title">Product recommendations</h2>
        </div>
        <div className="rail-actions">
          <button className="rail-refresh-btn" disabled={loading} onClick={onRefresh} type="button">
            {loading ? "Refreshing..." : "Refresh quotes"}
          </button>
          <span className={`status-badge ${statusClassName}`}>{statusLabel}</span>
        </div>
      </div>
      <p className="card-copy rail-copy">The best fit stays in view while you adjust the levers.</p>
      {loading ? <div className="rail-state">Refreshing Deribit depth and pricing...</div> : null}
      {error ? <div className="rail-state rail-error">{error}</div> : null}
      {!hasData && !loading && !error ? <div className="rail-state">Calculating recommendations...</div> : null}
      {hasData && !loading && candidates.length === 0 ? (
        <div className="rail-state">No eligible product passed the current checks.</div>
      ) : null}
      <div className="rail-list">
        {candidates.map((candidate) => (
          <RecommendationRailCard
            best={candidate.instrumentName === bestInstrumentName}
            candidate={candidate}
            key={candidate.instrumentName}
            onSelect={onSelect}
            selected={candidate.instrumentName === selectedInstrumentName}
          />
        ))}
      </div>
    </aside>
  );
}

function RecommendationRailCard({
  candidate,
  best = false,
  onSelect,
  selected
}: {
  candidate: DcnCandidate;
  best?: boolean;
  onSelect: (instrumentName: string) => void;
  selected: boolean;
}) {
  const terms = getInstrumentTerms(candidate);
  const strikeDistance = formatStrikeDistanceFromSpot(candidate);
  const expiryDistance = formatExpiryDistance(candidate.dayCount);

  return (
    <button
      aria-label={`Select ${terms.underlying} ${terms.optionType} Dual Currency Note expiring ${terms.expiryDate}`}
      aria-pressed={selected}
      className={`recommendation-card ${best ? "best" : ""} ${selected ? "selected" : ""}`}
      onClick={() => onSelect(candidate.instrumentName)}
      type="button"
    >
      <div className="recommendation-card-top">
        <span className={`status-badge ${best ? "status-live" : "status-warn"}`}>
          {best ? "Best match" : "Alternative"}
        </span>
        {selected ? <span className="status-badge status-live">Selected</span> : null}
      </div>
      <h3 className="recommendation-name">
        {terms.underlying} {terms.optionType} Dual Currency Note
      </h3>
      <div className="recommendation-yield-row">
        <span>Yield</span>
        <strong>{formatCandidateYield(candidate)}</strong>
      </div>
      <dl className="recommendation-terms">
        <div>
          <dt>Expiry</dt>
          <dd>
            {terms.expiryDate}
            <span>{expiryDistance}</span>
          </dd>
        </div>
        <div>
          <dt>Strike</dt>
          <dd>
            {formatUsd(candidate.strike)}
            <span>{strikeDistance}</span>
          </dd>
        </div>
      </dl>
    </button>
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
  const isCall = candidate.productType === "sell_call";
  const payout =
    scenario.clientPayoutAsset === "BTC"
      ? `${formatNumber(scenario.clientPayoutAmount, 6)} BTC`
      : formatUsd(scenario.clientPayoutAmount, 2);

  return (
    <div className="candidate-card payout-simulator">
      <div className="row-between">
        <div>
          <div className="pc-label">Client payout simulator</div>
          <h3 className="card-title">{scenario.clientPayoutAsset === "BTC" ? "BTC delivery" : "USDT redemption"}</h3>
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
        <Metric
          label="Scenario"
          value={
            isCall
              ? scenario.side === "upside"
                ? "Above strike"
                : "At/below strike"
              : scenario.side === "downside"
                ? "Below strike"
                : "At/above strike"
          }
        />
        <Metric label="Client yield" value={formatCandidateYield(candidate)} tone="ok" />
        <Metric label="Strike" value={formatUsd(candidate.strike)} />
      </div>
      <p className="card-copy">
        {isCall
          ? "At or below strike, payout is BTC. Above strike, payout is USDT principal plus fixed product interest."
          : "Below strike, payout is BTC. At or above strike, payout is USDT principal plus fixed product interest."}
      </p>
    </div>
  );
}

function RecommendationCard({
  recommendation,
  candidate,
  selectedAlternative = false
}: {
  recommendation: DcnRecommendation;
  candidate: DcnCandidate;
  selectedAlternative?: boolean;
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
  const priorityLabel = formatPriorityLever(recommendation.priorityLever);

  return (
    <div className="candidate-card">
      <div className="row-between">
        <div>
          <div className="pc-label">Recommendation</div>
          <h3 className="card-title">
            {selectedAlternative
              ? "Selected product"
              : recommendation.recommendedLever === "none"
                ? "Closest product"
                : `Recommended ${recommendation.recommendedLever}`}
          </h3>
        </div>
        <span className="status-badge status-live">{recommendationValue}</span>
      </div>
      <p className="card-copy">{recommendation.reason}</p>
      <div className="metric-grid">
        <Metric label="Yield gap" value={gap} />
        <Metric label="Runway gap" value={runwayGap} />
        <Metric label="Strike gap" value={strikeGap} />
        <Metric label={priorityLabel ? "Priority" : "Mode"} value={priorityLabel ?? recommendation.selectorMode.replace("_", " ")} />
      </div>
    </div>
  );
}

function buildSelectedRecommendation({
  baseRecommendation,
  candidate,
  bestInstrumentName,
  runwayDays,
  selectorMode,
  priorityLever,
  strikeBufferMode,
  strikeBufferPct,
  targetYieldPct
}: {
  baseRecommendation: DcnRecommendation | undefined;
  candidate: DcnCandidate;
  bestInstrumentName: string | null;
  runwayDays: number;
  selectorMode: DcnSelectorMode;
  priorityLever: DcnPriorityLever | undefined;
  strikeBufferMode: "target" | "any";
  strikeBufferPct: number;
  targetYieldPct: number;
}): DcnRecommendation {
  if (candidate.instrumentName === bestInstrumentName && baseRecommendation) return baseRecommendation;

  const targetYield = targetYieldPct / 100;
  const targetYieldGapBps = candidate.clientYield === null ? null : (candidate.clientYield - targetYield) * 10000;
  const runwayGapDays = Number.isFinite(candidate.dayCount) ? Math.abs(candidate.dayCount - runwayDays) : null;
  const preferredMoneyness =
    strikeBufferMode === "target"
      ? candidate.productType === "sell_call"
        ? 1 + strikeBufferPct / 100
        : 1 - strikeBufferPct / 100
      : null;
  const strikeMoneyness =
    candidate.spotPrice > 0 && Number.isFinite(candidate.strike) ? candidate.strike / candidate.spotPrice : null;
  const strikeMoneynessGapBps =
    preferredMoneyness === null || strikeMoneyness === null
      ? null
      : Math.abs(strikeMoneyness - preferredMoneyness) * 10000;

  return {
    selectorMode,
    recommendedLever: getRecommendedLever(selectorMode),
    priorityLever,
    reason: "This selected product is compared against your current levers.",
    targetYieldGapBps,
    runwayGapDays,
    strikeMoneynessGapBps
  };
}

function getRecommendedLever(selectorMode: DcnSelectorMode): DcnRecommendation["recommendedLever"] {
  if (selectorMode === "auto_yield") return "yield";
  if (selectorMode === "auto_runway") return "runway";
  if (selectorMode === "auto_strike") return "strike";
  return "none";
}

function getPriorityOptions(selectorMode: DcnSelectorMode): Array<{ id: DcnPriorityLever; label: string }> {
  if (selectorMode === "auto_yield") {
    return [
      { id: "runway", label: "Prioritize Runway" },
      { id: "strike", label: "Prioritize Strike buffer" }
    ];
  }
  if (selectorMode === "auto_runway") {
    return [
      { id: "yield", label: "Prioritize Return" },
      { id: "strike", label: "Prioritize Strike buffer" }
    ];
  }
  if (selectorMode === "auto_strike") {
    return [
      { id: "yield", label: "Prioritize Return" },
      { id: "runway", label: "Prioritize Runway" }
    ];
  }
  return [];
}

function formatPriorityLever(priorityLever: DcnPriorityLever | undefined) {
  if (priorityLever === "yield") return "Return";
  if (priorityLever === "runway") return "Runway";
  if (priorityLever === "strike") return "Strike buffer";
  return null;
}

function formatRecommendationValue(recommendation: DcnRecommendation, candidate: DcnCandidate) {
  if (recommendation.recommendedLever === "runway") return `${formatNumber(candidate.dayCount, 0)} days`;
  if (recommendation.recommendedLever === "strike") return formatUsd(candidate.strike);
  return formatCandidateYield(candidate);
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
  const strikeDistance = formatStrikeDistanceFromSpot(candidate);
  const expiryDistance = formatExpiryDistance(candidate.dayCount);

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
          <dd>
            {terms.expiryDate}
            <span>{expiryDistance}</span>
          </dd>
        </div>
        <div>
          <dt>Strike Price</dt>
          <dd>
            {formatUsd(candidate.strike)}
            <span>{strikeDistance}</span>
          </dd>
        </div>
      </dl>
      <div className="metric-grid product-yield">
        <Metric label="Client yield" value={formatCandidateYield(candidate)} tone="ok" />
      </div>
    </div>
  );
}

function formatCandidateYield(candidate: DcnCandidate) {
  return formatPct(candidate.clientYield, candidate.productType === "sell_call" ? 2 : 1);
}

function formatStrikeDistanceFromSpot(candidate: DcnCandidate) {
  if (!candidate.spotPrice || candidate.spotPrice <= 0) return "-";
  const distancePct = Math.round(Math.abs((candidate.strike / candidate.spotPrice - 1) * 100));
  if (distancePct === 0) return "At spot";
  return candidate.strike < candidate.spotPrice ? `${distancePct}% below spot` : `${distancePct}% above spot`;
}

function formatExpiryDistance(dayCount: number) {
  if (!Number.isFinite(dayCount) || dayCount < 0) return "-";
  if (dayCount >= 60) {
    const months = Math.max(1, Math.round(dayCount / 30));
    return `${months} ${months === 1 ? "month" : "months"} away`;
  }
  return `${dayCount} ${dayCount === 1 ? "day" : "days"} away`;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "fail" }) {
  return (
    <div className="metric-card">
      <div className="sum-lbl">{label}</div>
      <div className={`metric-value ${tone === "ok" ? "green" : tone === "fail" ? "red" : ""}`}>{value}</div>
    </div>
  );
}
