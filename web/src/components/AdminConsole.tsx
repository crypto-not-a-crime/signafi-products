"use client";

import { useEffect, useMemo, useState } from "react";
import type { DcnCandidate, DeribitMarginCheck, MarketExpirySummary, MarketOption, PricingConfig } from "@/types";
import { formatNumber, formatPct, formatUsd } from "@/lib/format";
import { calculateScenario, getScenarioRange } from "@/lib/dcn-scenario";

interface Health {
  activeInstrumentCount?: number;
  quoteCount?: number;
  staleQuoteCount?: number;
  summaryStaleCount?: number;
  liveTickerFreshCount?: number;
  catalogSyncAgeSeconds?: number | null;
  summaryFreshnessSeconds?: number;
  liveFreshnessSeconds?: number;
  latestQuoteAt?: number;
  latestSyncAt?: number;
  streamStatus?: unknown;
  mock?: boolean;
}

export function AdminConsole() {
  const [health, setHealth] = useState<Health | null>(null);
  const [options, setOptions] = useState<MarketOption[]>([]);
  const [expirySummaries, setExpirySummaries] = useState<MarketExpirySummary[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [syncingMarket, setSyncingMarket] = useState(false);
  const [instrumentName, setInstrumentName] = useState("BTC-31JUL26-75000-P");
  const [selectedOptionType, setSelectedOptionType] = useState<"call" | "put">("put");
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [selectedStrike, setSelectedStrike] = useState("");
  const [investmentUsdt, setInvestmentUsdt] = useState(1000000);
  const [firmMarginPct, setFirmMarginPct] = useState(2);
  const [savedFirmMarginPct, setSavedFirmMarginPct] = useState(2);
  const [expiryPrice, setExpiryPrice] = useState<number | null>(null);
  const [audit, setAudit] = useState<DcnCandidate | null>(null);
  const [marginCheck, setMarginCheck] = useState<DeribitMarginCheck | null>(null);
  const [quoteVerification, setQuoteVerification] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [marginLoading, setMarginLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    void refreshHealth();
    void loadPricingConfig();
    void loadExpiryOptions();
  }, []);

  useEffect(() => {
    if (options.length === 0 || selectedExpiry) return;
    const preferred =
      options.find((option) => option.instrument_name === instrumentName) ??
      options.find((option) => option.option_type === "put" && (option.bid_price ?? 0) > 0) ??
      options.find((option) => option.option_type === "put") ??
      options[0];
    if (!preferred) return;
    setSelectedOptionType(preferred.option_type);
    setSelectedExpiry(String(preferred.expiration_timestamp));
    setSelectedStrike(String(preferred.strike));
  }, [instrumentName, options, selectedExpiry]);

  const expiryOptions = useMemo(
    () =>
      expirySummaries
        .filter((item) => item.option_type === selectedOptionType && item.expiration_timestamp)
        .map((item) => item.expiration_timestamp)
        .sort((a, b) => a - b),
    [expirySummaries, selectedOptionType]
  );

  useEffect(() => {
    if (expiryOptions.length === 0) return;
    if (!expiryOptions.some((expiry) => String(expiry) === selectedExpiry)) {
      setSelectedExpiry(String(expiryOptions[0]));
    }
  }, [expiryOptions, selectedExpiry]);

  useEffect(() => {
    if (!selectedExpiry) return;
    void loadOptions(selectedOptionType, selectedExpiry);
  }, [selectedExpiry, selectedOptionType]);

  const strikeOptions = useMemo(() => {
    const expiry = Number(selectedExpiry);
    const strikes = new Set<number>();
    for (const option of options) {
      if (option.option_type === selectedOptionType && option.expiration_timestamp === expiry) {
        strikes.add(option.strike);
      }
    }
    return Array.from(strikes).sort((a, b) => a - b);
  }, [options, selectedExpiry, selectedOptionType]);

  useEffect(() => {
    if (strikeOptions.length === 0) return;
    if (!strikeOptions.some((strike) => String(strike) === selectedStrike)) {
      setSelectedStrike(String(strikeOptions[0]));
    }
  }, [selectedStrike, strikeOptions]);

  const selectedOption = useMemo(() => {
    const expiry = Number(selectedExpiry);
    const strike = Number(selectedStrike);
    return (
      options.find(
        (option) =>
          option.option_type === selectedOptionType &&
          option.expiration_timestamp === expiry &&
          option.strike === strike
      ) ?? null
    );
  }, [options, selectedExpiry, selectedOptionType, selectedStrike]);

  useEffect(() => {
    if (selectedOption) setInstrumentName(selectedOption.instrument_name);
  }, [selectedOption]);

  useEffect(() => {
    setAudit(null);
    setMarginCheck(null);
    setQuoteVerification(null);
    setConfigMessage(null);
    setRefreshError(null);
    setExpiryPrice(null);
  }, [instrumentName, investmentUsdt, firmMarginPct]);

  useEffect(() => {
    if (!audit) return;
    const range = getAdminScenarioRange(audit);
    setExpiryPrice((current) =>
      current === null || current < range.min || current > range.max ? range.defaultPrice : current
    );
  }, [audit?.instrumentName, audit?.strike]);

  async function refreshHealth() {
    const response = await fetch("/api/admin/market-health", { cache: "no-store" });
    setHealth(await response.json());
  }

  async function loadPricingConfig() {
    const response = await fetch("/api/admin/pricing-config", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { pricingConfig?: PricingConfig };
    const firmMarginBps = payload.pricingConfig?.firmMarginBps;
    if (typeof firmMarginBps !== "number" || !Number.isFinite(firmMarginBps)) return;
    const firmMargin = firmMarginBps / 100;
    setFirmMarginPct(firmMargin);
    setSavedFirmMarginPct(firmMargin);
  }

  async function loadExpiryOptions() {
    setOptionsLoading(true);
    try {
      const response = await fetch("/api/market/options?summary=expiries&limit=5000", {
        cache: "no-store"
      });
      const payload = (await response.json()) as { expiries?: MarketExpirySummary[] };
      setExpirySummaries(payload.expiries ?? []);
    } finally {
      setOptionsLoading(false);
    }
  }

  async function loadOptions(optionType = selectedOptionType, expiry = selectedExpiry) {
    if (!expiry) return;
    setOptionsLoading(true);
    try {
      const params = new URLSearchParams({ type: optionType, expiry, limit: "5000" });
      const response = await fetch(`/api/market/options?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as { options?: MarketOption[] };
      setOptions((payload.options ?? []).filter((option) => option.expiration_timestamp && option.strike));
    } finally {
      setOptionsLoading(false);
    }
  }

  const firmMarginBps = Math.max(0, Math.round(firmMarginPct * 100));
  const savedFirmMarginBps = Math.max(0, Math.round(savedFirmMarginPct * 100));
  const firmMarginChanged = firmMarginBps !== savedFirmMarginBps;

  async function savePricingConfig() {
    setSavingConfig(true);
    setConfigMessage(null);
    try {
      const response = await fetch("/api/admin/pricing-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firmMarginBps })
      });
      const payload = (await response.json()) as { pricingConfig?: PricingConfig; error?: string };
      if (!response.ok) {
        setConfigMessage(payload.error ?? `Save failed with HTTP ${response.status}`);
        return;
      }
      const nextMarginBps = payload.pricingConfig?.firmMarginBps ?? firmMarginBps;
      const nextMarginPct = nextMarginBps / 100;
      setFirmMarginPct(nextMarginPct);
      setSavedFirmMarginPct(nextMarginPct);
      setConfigMessage("Firm margin saved.");
    } finally {
      setSavingConfig(false);
    }
  }

  async function refreshMarket() {
    setSyncingMarket(true);
    setMarginCheck(null);
    setQuoteVerification(null);
    setRefreshError(null);
    try {
      const response = await fetch("/api/admin/refresh-selected-market", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instrumentName,
          investmentUsdt,
          targetYieldBps: 1000,
          runwayDays: 92,
          firmMarginBps,
          orderBookDepth: 100,
          scenarioExpiryPrice: expiryPrice ?? undefined
        }),
        cache: "no-store"
      });
      const payload = (await response.json()) as { calculation?: DcnCandidate; error?: string };
      if (response.ok) {
        setAudit(payload.calculation ?? null);
      } else {
        setRefreshError(payload.error ?? `Selected market refresh failed with HTTP ${response.status}`);
      }
      await refreshHealth();
    } finally {
      setSyncingMarket(false);
    }
  }

  async function requestAuditCalculation(): Promise<DcnCandidate | null> {
    const response = await fetch("/api/admin/dcn-audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instrumentName,
        investmentUsdt,
        targetYieldBps: 1000,
        runwayDays: 92,
        firmMarginBps,
        orderBookDepth: 100,
        scenarioExpiryPrice: expiryPrice ?? undefined
      })
    });
    const payload = (await response.json()) as { calculation?: DcnCandidate; error?: string };
    const calculation = payload.calculation ?? null;
    setAudit(calculation);
    return calculation;
  }

  async function runAudit() {
    setLoading(true);
    setMarginCheck(null);
    try {
      await requestAuditCalculation();
    } finally {
      setLoading(false);
    }
  }

  async function checkMargins() {
    setMarginLoading(true);
    setMarginCheck(null);
    try {
      const calculation = audit ?? (await requestAuditCalculation());
      const amount = calculation?.requiredContracts ?? 0;
      const price = calculation?.effectivePutBidPrice ?? 0;
      if (!calculation || amount <= 0 || price <= 0) {
        setMarginCheck({
          instrumentName,
          amount,
          price,
          error: "Calculation audit did not produce positive C14 contracts and C15 price values."
        });
        return;
      }

      const response = await fetch("/api/admin/deribit-margins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instrumentName: calculation.instrumentName,
          amount,
          price
        })
      });
      const payload = (await response.json()) as DeribitMarginCheck;
      setMarginCheck(
        response.ok
          ? payload
          : {
              instrumentName: calculation.instrumentName,
              amount,
              price,
              error: payload.error ?? `Margin check failed with HTTP ${response.status}`
            }
      );
    } finally {
      setMarginLoading(false);
    }
  }

  async function verifyQuote() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/verify-quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instrumentName, depth: 100 })
      });
      setQuoteVerification(await response.json());
    } finally {
      setLoading(false);
    }
  }

  const scenarioRange = audit ? getAdminScenarioRange(audit) : null;
  const selectedExpiryPrice = scenarioRange ? expiryPrice ?? scenarioRange.defaultPrice : null;
  const selectedScenario = audit && selectedExpiryPrice !== null ? calculateScenario(audit, selectedExpiryPrice) : null;
  const busy = loading || marginLoading;

  return (
    <main className="admin-page">
      <section className="admin-header">
        <div className="pill">Backend verification</div>
        <h1>DCN pricing audit</h1>
        <p className="small-muted">
          Check that Deribit quotes are fresh, depth is sufficient, and Signafi margin/profit checks pass before a
          client-facing yield is shown.
        </p>
      </section>

      <section className="admin-shell">
        <div className="admin-grid">
          <Metric label="Active instruments" value={health?.activeInstrumentCount ?? "-"} />
          <Metric label="Stored quotes" value={health?.quoteCount ?? "-"} />
          <Metric
            label={`Summary stale >${health?.summaryFreshnessSeconds ?? 180}s`}
            value={health?.summaryStaleCount ?? health?.staleQuoteCount ?? "-"}
            tone={health?.summaryStaleCount || health?.staleQuoteCount ? "warn" : "ok"}
          />
          <Metric
            label={`Live fresh <${health?.liveFreshnessSeconds ?? 10}s`}
            value={health?.liveTickerFreshCount ?? "-"}
            tone={health?.liveTickerFreshCount ? "ok" : "warn"}
          />
          <Metric label="Catalog age" value={formatAge(health?.catalogSyncAgeSeconds)} tone={(health?.catalogSyncAgeSeconds ?? 0) > 180 ? "warn" : "ok"} />
        </div>

        <div className="audit-grid" style={{ marginTop: 24 }}>
          <div className="admin-card">
            <h2 className="card-title">Run verification</h2>
            <div className="form-grid">
              <label>
                <span className="field-label">Expiry date</span>
                <select
                  className="admin-input"
                  value={selectedExpiry}
                  onChange={(event) => setSelectedExpiry(event.target.value)}
                  disabled={optionsLoading || expiryOptions.length === 0}
                >
                  {expiryOptions.map((expiry) => (
                    <option key={expiry} value={expiry}>
                      {formatExpiry(expiry)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">Call / Put</span>
                <select
                  className="admin-input"
                  value={selectedOptionType}
                  onChange={(event) => setSelectedOptionType(event.target.value as "call" | "put")}
                  disabled={optionsLoading}
                >
                  <option value="put">Put</option>
                  <option value="call">Call</option>
                </select>
              </label>
              <label>
                <span className="field-label">Strike</span>
                <select
                  className="admin-input"
                  value={selectedStrike}
                  onChange={(event) => setSelectedStrike(event.target.value)}
                  disabled={optionsLoading || strikeOptions.length === 0}
                >
                  {strikeOptions.map((strike) => (
                    <option key={strike} value={strike}>
                      {formatUsd(strike)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">Investment USDT</span>
                <input
                  className="admin-input"
                  type="number"
                  value={investmentUsdt}
                  onChange={(event) => setInvestmentUsdt(Number(event.target.value))}
                />
              </label>
              <label>
                <span className="field-label">Firm margin % p.a.</span>
                <input
                  className="admin-input"
                  type="number"
                  min={0}
                  step={0.1}
                  value={firmMarginPct}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setFirmMarginPct(Number.isFinite(next) ? next : 0);
                  }}
                />
              </label>
            </div>
            <div className="soft-row" style={{ marginTop: 12 }}>
              <span>Saved firm margin</span>
              <strong className="mono">{savedFirmMarginPct.toFixed(1)}% p.a.</strong>
            </div>
            <div className="soft-row" style={{ marginTop: 12 }}>
              <span>Selected instrument</span>
              <strong className="mono">{optionsLoading ? "Loading..." : instrumentName || "-"}</strong>
            </div>
            {selectedOptionType === "call" ? (
              <p className="card-copy" style={{ marginTop: 10 }}>
                Quote verification works for calls. DCN sell-put calculation audit is available for put instruments only.
              </p>
            ) : null}
            <div className="quick-btns">
              <button
                className="admin-button"
                onClick={runAudit}
                disabled={busy || savingConfig || selectedOptionType !== "put" || !instrumentName}
              >
                Verify calculations
              </button>
              <button
                className="btn-ghost"
                onClick={() => void savePricingConfig()}
                disabled={busy || savingConfig || !firmMarginChanged}
              >
                {savingConfig ? "Saving..." : "Save margin"}
              </button>
              <button
                className="btn-ghost"
                onClick={checkMargins}
                disabled={busy || savingConfig || selectedOptionType !== "put" || !instrumentName}
              >
                {marginLoading ? "Checking..." : "Check margins"}
              </button>
              <button className="btn-ghost" onClick={verifyQuote} disabled={busy || savingConfig || !instrumentName}>
                Verify Deribit quote
              </button>
              <button
                className="btn-ghost"
                onClick={() => void refreshMarket()}
                disabled={busy || savingConfig || optionsLoading || syncingMarket || selectedOptionType !== "put" || !instrumentName}
              >
                {syncingMarket ? "Refreshing..." : "Refresh market"}
              </button>
            </div>
            {configMessage ? (
              <p className="card-copy" style={{ marginTop: 10 }}>
                {configMessage}
              </p>
            ) : null}
            {refreshError ? (
              <p className="card-copy" style={{ marginTop: 10 }}>
                {refreshError}
              </p>
            ) : null}

            {audit ? (
              <>
                <div className="metric-grid">
                  <Metric label="Client yield" value={formatPct(audit.clientYield, 1)} tone={audit.eligible ? "ok" : "warn"} />
                  <Metric label="Effective C15 bid" value={formatNumber(audit.effectivePutBidPrice, 5)} />
                  <Metric
                    label="Selected firm P&L"
                    value={formatUsd(selectedScenario?.firmProfitUsdt)}
                    tone={(selectedScenario?.firmProfitUsdt ?? 0) > 0 ? "ok" : "fail"}
                  />
                  <Metric
                    label="Client payout"
                    value={
                      selectedScenario?.clientPayoutAsset === "BTC"
                        ? `${formatNumber(selectedScenario.clientPayoutAmount, 6)} BTC`
                        : formatUsd(selectedScenario?.clientPayoutAmount, 2)
                    }
                  />
                </div>

                {scenarioRange && selectedExpiryPrice !== null && selectedScenario ? (
                  <div className="scenario-panel">
                    <div className="row-between">
                      <div>
                        <div className="field-label">BTC expiry price</div>
                        <strong>{selectedScenario.side === "downside" ? "Downside BTC payout" : "Upside USDT payout"}</strong>
                      </div>
                      <strong className="mono">{formatUsd(selectedExpiryPrice)}</strong>
                    </div>
                    <input
                      type="range"
                      min={scenarioRange.min}
                      max={scenarioRange.max}
                      step={scenarioRange.step}
                      value={selectedExpiryPrice}
                      onChange={(event) => setExpiryPrice(Number(event.target.value))}
                    />
                    <div className="range-labels">
                      <span>{formatUsd(scenarioRange.min)}</span>
                      <span>Strike {formatUsd(audit.strike)}</span>
                      <span>{formatUsd(scenarioRange.max)}</span>
                    </div>
                    <div className="metric-grid">
                      <Metric label="Annualized firm P&L" value={formatPct(selectedScenario.annualizedFirmProfit)} />
                      <Metric label="Option settlement BTC" value={formatNumber(selectedScenario.optionSettlementBtc, 6)} />
                      <Metric label="Net hedge BTC" value={formatNumber(selectedScenario.netHedgeBtc, 6)} />
                      <Metric label="BTC to purchase" value={formatNumber(selectedScenario.btcToPurchase, 6)} />
                    </div>
                  </div>
                ) : null}

                <h3 className="card-title" style={{ marginTop: 24 }}>Workbook formula trace</h3>
                <table className="trace-table">
                  <thead>
                    <tr>
                      <th>Cell</th>
                      <th>Label</th>
                      <th>Formula</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...audit.formulaTrace, ...(selectedScenario?.formulaTrace ?? [])].map((row) => (
                      <tr key={`${row.cell}-${row.label}`}>
                        <td className="mono">{row.cell}</td>
                        <td>{row.label}</td>
                        <td>{row.formula}</td>
                        <td className="mono">{String(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </div>

          <div className="stack">
            <div className="admin-card">
              <h2 className="card-title">Depth and slippage</h2>
              {audit ? (
                <>
                  <div className="soft-row">
                    <span>Required contracts</span>
                    <strong className="mono">{formatNumber(audit.depth.requiredContracts, 1)}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Filled contracts</span>
                    <strong className="mono">{formatNumber(audit.depth.filledContracts, 1)}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Top bid</span>
                    <strong className="mono">{formatNumber(audit.depth.bestBidPrice, 5)}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Avg executable bid</span>
                    <strong className="mono">{formatNumber(audit.depth.effectivePutBidPrice, 5)}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Slippage</span>
                    <strong className="mono">{formatPct(audit.depth.slippagePct, 3)}</strong>
                  </div>
                </>
              ) : (
                <p className="card-copy">Run a calculation audit to view consumed bid levels and slippage.</p>
              )}
            </div>

            <div className="admin-card">
              <h2 className="card-title">Formula template</h2>
              {audit?.formulaTemplate ? (
                <>
                  <div className="soft-row">
                    <span>Template</span>
                    <strong>{audit.formulaTemplate.label}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Version</span>
                    <strong className="mono">{audit.formulaTemplate.version}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Workbook</span>
                    <strong>{audit.formulaTemplate.sourceWorkbook}</strong>
                  </div>
                </>
              ) : (
                <p className="card-copy">Run a calculation audit to view the active formula template.</p>
              )}
            </div>

            <div className="admin-card">
              <h2 className="card-title">Pass/fail checks</h2>
              {audit && selectedScenario ? (
                <>
                  <CheckRow label="Quote fresh" ok={audit.checks.quoteFresh} />
                  <CheckRow label="Sufficient depth" ok={audit.checks.sufficientDepth} />
                  <CheckRow label="Slippage within limit" ok={audit.checks.slippageWithinLimit ?? true} />
                  <CheckRow label="Premium covers interest" ok={audit.checks.premiumCoversInterest} />
                  <CheckRow label="Selected firm P&L positive" ok={(selectedScenario.firmProfitUsdt ?? 0) > 0} />
                </>
              ) : (
                <p className="card-copy">Run a calculation audit to view pass/fail checks.</p>
              )}
            </div>

            <div className="admin-card">
              <h2 className="card-title">Deribit margin requirement</h2>
              {marginCheck ? (
                marginCheck.error ? (
                  <p className="card-copy">{marginCheck.error}</p>
                ) : (
                  <>
                    <div className="soft-row">
                      <span>Instrument</span>
                      <strong className="mono">{marginCheck.instrumentName}</strong>
                    </div>
                    <div className="soft-row">
                      <span>C14 amount</span>
                      <strong className="mono">{formatNumber(marginCheck.amount, 1)}</strong>
                    </div>
                    <div className="soft-row">
                      <span>C15 price</span>
                      <strong className="mono">{formatNumber(marginCheck.price, 5)}</strong>
                    </div>
                    <div className="metric-grid">
                      <Metric label="Sell margin" value={formatNumber(marginCheck.result?.sell, 8)} />
                      <Metric label="Buy margin" value={formatNumber(marginCheck.result?.buy, 8)} />
                      <Metric label="Min price" value={formatNumber(marginCheck.result?.min_price, 5)} />
                      <Metric label="Max price" value={formatNumber(marginCheck.result?.max_price, 5)} />
                    </div>
                  </>
                )
              ) : (
                <p className="card-copy">No margin check run yet.</p>
              )}
            </div>

            <div className="admin-card">
              <h2 className="card-title">Quote verification payload</h2>
              <pre className="json-box">{quoteVerification ? JSON.stringify(quoteVerification, null, 2) : "No quote verification run yet."}</pre>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function formatExpiry(timestamp: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "2-digit"
  })
    .format(new Date(timestamp))
    .replace(",", "")
    .toUpperCase();
}

function getAdminScenarioRange(candidate: DcnCandidate) {
  return getScenarioRange(candidate, {
    min: 0,
    max: candidate.strike * 3,
    step: 1000
  });
}

function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "-";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

function CheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="soft-row">
      <span>{label}</span>
      <span className={`status-badge ${ok ? "status-live" : "status-fail"}`}>{ok ? "Pass" : "Fail"}</span>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "fail" }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${tone === "ok" ? "green" : tone === "fail" ? "red" : tone === "warn" ? "purple" : ""}`}>
        {value}
      </div>
    </div>
  );
}
