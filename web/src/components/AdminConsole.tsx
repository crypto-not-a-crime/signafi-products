"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DcnCandidate,
  DeribitMarginCheck,
  MarketExpirySummary,
  MarketOption,
  PricingConfig,
  SellPutPricingMethod
} from "@/types";
import { formatNumber, formatPct, formatUsd } from "@/lib/format";
import { calculateScenario, getScenarioRange } from "@/lib/dcn-scenario";
import { AdminYieldSurface } from "@/components/AdminYieldSurface";

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
  const [activeTab, setActiveTab] = useState<"audit" | "yield-surface">("audit");
  const [selectedProductType, setSelectedProductType] = useState<"sell_put" | "sell_call">("sell_put");
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
  const [investmentBtc, setInvestmentBtc] = useState(10);
  const [sellPutPricingMethod, setSellPutPricingMethod] = useState<SellPutPricingMethod>("firm_margin");
  const [savedSellPutPricingMethod, setSavedSellPutPricingMethod] = useState<SellPutPricingMethod>("firm_margin");
  const [firmMarginPct, setFirmMarginPct] = useState(2);
  const [savedFirmMarginPct, setSavedFirmMarginPct] = useState(2);
  const [sellPutTargetFirmProfitPct, setSellPutTargetFirmProfitPct] = useState(5);
  const [savedSellPutTargetFirmProfitPct, setSavedSellPutTargetFirmProfitPct] = useState(5);
  const [sellCallTargetFirmProfitPct, setSellCallTargetFirmProfitPct] = useState(5);
  const [savedSellCallTargetFirmProfitPct, setSavedSellCallTargetFirmProfitPct] = useState(5);
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
    setSelectedOptionType(selectedProductType === "sell_call" ? "call" : "put");
    setSelectedExpiry("");
    setSelectedStrike("");
    setOptions([]);
  }, [selectedProductType]);

  useEffect(() => {
    if (options.length === 0 || selectedExpiry) return;
    const preferred =
      options.find((option) => option.instrument_name === instrumentName) ??
      options.find((option) => option.option_type === selectedOptionType && (option.bid_price ?? 0) > 0) ??
      options.find((option) => option.option_type === selectedOptionType) ??
      options[0];
    if (!preferred) return;
    setSelectedOptionType(preferred.option_type);
    setSelectedExpiry(String(preferred.expiration_timestamp));
    setSelectedStrike(String(preferred.strike));
  }, [instrumentName, options, selectedExpiry, selectedOptionType]);

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
  }, [
    instrumentName,
    investmentUsdt,
    investmentBtc,
    sellPutPricingMethod,
    firmMarginPct,
    sellPutTargetFirmProfitPct,
    sellCallTargetFirmProfitPct,
    selectedProductType
  ]);

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
    const putMethod = payload.pricingConfig?.sellPutPricingMethod;
    if (putMethod === "firm_margin" || putMethod === "target_firm_profit") {
      setSellPutPricingMethod(putMethod);
      setSavedSellPutPricingMethod(putMethod);
    }
    const firmMarginBps = payload.pricingConfig?.firmMarginBps;
    if (typeof firmMarginBps === "number" && Number.isFinite(firmMarginBps)) {
      const firmMargin = firmMarginBps / 100;
      setFirmMarginPct(firmMargin);
      setSavedFirmMarginPct(firmMargin);
    }
    const putTargetBps = payload.pricingConfig?.sellPutTargetFirmProfitBps;
    if (typeof putTargetBps === "number" && Number.isFinite(putTargetBps)) {
      const putTarget = putTargetBps / 100;
      setSellPutTargetFirmProfitPct(putTarget);
      setSavedSellPutTargetFirmProfitPct(putTarget);
    }
    const callTargetBps = payload.pricingConfig?.sellCallTargetFirmProfitBps;
    if (typeof callTargetBps === "number" && Number.isFinite(callTargetBps)) {
      const callTarget = callTargetBps / 100;
      setSellCallTargetFirmProfitPct(callTarget);
      setSavedSellCallTargetFirmProfitPct(callTarget);
    }
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
  const sellPutTargetFirmProfitBps = Math.max(0, Math.round(sellPutTargetFirmProfitPct * 100));
  const savedSellPutTargetFirmProfitBps = Math.max(0, Math.round(savedSellPutTargetFirmProfitPct * 100));
  const sellCallTargetFirmProfitBps = Math.max(0, Math.round(sellCallTargetFirmProfitPct * 100));
  const savedSellCallTargetFirmProfitBps = Math.max(0, Math.round(savedSellCallTargetFirmProfitPct * 100));
  const pricingConfigChanged =
    sellPutPricingMethod !== savedSellPutPricingMethod ||
    firmMarginBps !== savedFirmMarginBps ||
    sellPutTargetFirmProfitBps !== savedSellPutTargetFirmProfitBps ||
    sellCallTargetFirmProfitBps !== savedSellCallTargetFirmProfitBps;

  async function savePricingConfig() {
    setSavingConfig(true);
    setConfigMessage(null);
    try {
      const response = await fetch("/api/admin/pricing-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sellPutPricingMethod,
          firmMarginBps,
          sellPutTargetFirmProfitBps,
          sellCallTargetFirmProfitBps
        })
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
      const nextPutMethod = payload.pricingConfig?.sellPutPricingMethod ?? sellPutPricingMethod;
      setSellPutPricingMethod(nextPutMethod);
      setSavedSellPutPricingMethod(nextPutMethod);
      const nextPutTargetBps = payload.pricingConfig?.sellPutTargetFirmProfitBps ?? sellPutTargetFirmProfitBps;
      const nextPutTargetPct = nextPutTargetBps / 100;
      setSellPutTargetFirmProfitPct(nextPutTargetPct);
      setSavedSellPutTargetFirmProfitPct(nextPutTargetPct);
      const nextCallTargetBps = payload.pricingConfig?.sellCallTargetFirmProfitBps ?? sellCallTargetFirmProfitBps;
      const nextCallTargetPct = nextCallTargetBps / 100;
      setSellCallTargetFirmProfitPct(nextCallTargetPct);
      setSavedSellCallTargetFirmProfitPct(nextCallTargetPct);
      setConfigMessage("Pricing configuration saved.");
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
          productType: selectedProductType,
          instrumentName,
          investmentUsdt: selectedProductType === "sell_put" ? investmentUsdt : undefined,
          investmentBtc: selectedProductType === "sell_call" ? investmentBtc : undefined,
          targetYieldBps: 1000,
          runwayDays: 92,
          sellPutPricingMethod,
          firmMarginBps,
          sellPutTargetFirmProfitBps,
          sellCallTargetFirmProfitBps,
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
        productType: selectedProductType,
        instrumentName,
        investmentUsdt: selectedProductType === "sell_put" ? investmentUsdt : undefined,
        investmentBtc: selectedProductType === "sell_call" ? investmentBtc : undefined,
        targetYieldBps: 1000,
        runwayDays: 92,
        sellPutPricingMethod,
        firmMarginBps,
        sellPutTargetFirmProfitBps,
        sellCallTargetFirmProfitBps,
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
      const price = calculation?.effectiveOptionBidPrice ?? calculation?.effectivePutBidPrice ?? 0;
      if (!calculation || amount <= 0 || price <= 0) {
        setMarginCheck({
          instrumentName,
          amount,
          price,
          error: "Calculation audit did not produce positive contract amount and option bid price values."
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
          Check that Deribit quotes are fresh, depth is sufficient, and Signafi pricing/profit checks pass before a
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

        <div className="admin-tabs" role="tablist" aria-label="Admin sections">
          <button
            className={activeTab === "audit" ? "active" : ""}
            onClick={() => setActiveTab("audit")}
            type="button"
          >
            Pricing audit
          </button>
          <button
            className={activeTab === "yield-surface" ? "active" : ""}
            onClick={() => setActiveTab("yield-surface")}
            type="button"
          >
            Yield Surface
          </button>
        </div>

        {activeTab === "audit" ? (
        <div className="audit-grid" style={{ marginTop: 24 }}>
          <div className="admin-card">
            <h2 className="card-title">Run verification</h2>
            <div className="form-grid">
              <label>
                <span className="field-label">Product</span>
                <select
                  className="admin-input"
                  value={selectedProductType}
                  onChange={(event) => setSelectedProductType(event.target.value as "sell_put" | "sell_call")}
                  disabled={optionsLoading}
                >
                  <option value="sell_put">DCN Put</option>
                  <option value="sell_call">DCN Call</option>
                </select>
              </label>
              {selectedProductType === "sell_put" ? (
                <label>
                  <span className="field-label">Put pricing basis</span>
                  <select
                    className="admin-input"
                    value={sellPutPricingMethod}
                    onChange={(event) => setSellPutPricingMethod(event.target.value as SellPutPricingMethod)}
                  >
                    <option value="firm_margin">Firm margin % p.a.</option>
                    <option value="target_firm_profit">PUT TARGET FIRM PROFIT % P.A.</option>
                  </select>
                </label>
              ) : null}
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
                <span className="field-label">{selectedProductType === "sell_call" ? "Investment BTC" : "Investment USDT"}</span>
                <input
                  className="admin-input"
                  type="number"
                  min={0}
                  step={selectedProductType === "sell_call" ? 0.1 : 1000}
                  value={selectedProductType === "sell_call" ? investmentBtc : investmentUsdt}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (selectedProductType === "sell_call") setInvestmentBtc(next);
                    else setInvestmentUsdt(next);
                  }}
                />
              </label>
              <label>
                <span className="field-label">
                  {selectedProductType === "sell_call"
                    ? "Call target firm profit % p.a."
                    : sellPutPricingMethod === "target_firm_profit"
                      ? "PUT TARGET FIRM PROFIT % P.A."
                      : "Firm margin % p.a."}
                </span>
                <input
                  className="admin-input"
                  type="number"
                  min={0}
                  step={0.1}
                  value={
                    selectedProductType === "sell_call"
                      ? sellCallTargetFirmProfitPct
                      : sellPutPricingMethod === "target_firm_profit"
                        ? sellPutTargetFirmProfitPct
                        : firmMarginPct
                  }
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (selectedProductType === "sell_call") setSellCallTargetFirmProfitPct(Number.isFinite(next) ? next : 0);
                    else if (sellPutPricingMethod === "target_firm_profit") {
                      setSellPutTargetFirmProfitPct(Number.isFinite(next) ? next : 0);
                    }
                    else setFirmMarginPct(Number.isFinite(next) ? next : 0);
                  }}
                />
              </label>
            </div>
            {selectedProductType === "sell_put" ? (
              <div className="soft-row" style={{ marginTop: 12 }}>
                <span>Saved put pricing basis</span>
                <strong className="mono">
                  {savedSellPutPricingMethod === "target_firm_profit" ? "Target firm profit" : "Firm margin"}
                </strong>
              </div>
            ) : null}
            <div className="soft-row" style={{ marginTop: 12 }}>
              <span>
                {selectedProductType === "sell_call"
                  ? "Saved call target firm profit"
                  : sellPutPricingMethod === "target_firm_profit"
                    ? "Saved put target firm profit"
                    : "Saved firm margin"}
              </span>
              <strong className="mono">
                {selectedProductType === "sell_call"
                  ? savedSellCallTargetFirmProfitPct.toFixed(1)
                  : sellPutPricingMethod === "target_firm_profit"
                    ? savedSellPutTargetFirmProfitPct.toFixed(1)
                    : savedFirmMarginPct.toFixed(1)}
                % p.a.
              </strong>
            </div>
            <div className="soft-row" style={{ marginTop: 12 }}>
              <span>Selected instrument</span>
              <strong className="mono">{optionsLoading ? "Loading..." : instrumentName || "-"}</strong>
            </div>
            <div className="quick-btns">
              <button
                className="admin-button"
                onClick={runAudit}
                disabled={busy || savingConfig || !instrumentName}
              >
                Verify calculations
              </button>
              <button
                className="btn-ghost"
                onClick={() => void savePricingConfig()}
                disabled={busy || savingConfig || !pricingConfigChanged}
              >
                {savingConfig ? "Saving..." : "Save config"}
              </button>
              <button
                className="btn-ghost"
                onClick={checkMargins}
                disabled={busy || savingConfig || !instrumentName}
              >
                {marginLoading ? "Checking..." : "Check margins"}
              </button>
              <button className="btn-ghost" onClick={verifyQuote} disabled={busy || savingConfig || !instrumentName}>
                Verify Deribit quote
              </button>
              <button
                className="btn-ghost"
                onClick={() => void refreshMarket()}
                disabled={busy || savingConfig || optionsLoading || syncingMarket || !instrumentName}
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
                  <Metric label="Effective bid" value={formatNumber(audit.effectiveOptionBidPrice ?? audit.effectivePutBidPrice, 5)} />
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
                      <Metric
                        label={selectedProductType === "sell_call" ? "Client interest BTC" : "BTC to purchase"}
                        value={
                          selectedProductType === "sell_call"
                            ? formatNumber(audit.clientInterestBtc, 6)
                            : formatNumber(selectedScenario.btcToPurchase, 6)
                        }
                      />
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
                    <strong className="mono">
                      {formatNumber(audit.depth.effectiveOptionBidPrice ?? audit.depth.effectivePutBidPrice, 5)}
                    </strong>
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
                  <CheckRow
                    label={
                      selectedProductType === "sell_call"
                        ? "Call C9 yield valid"
                        : audit.sellPutPricingMethod === "target_firm_profit"
                          ? "Put C9 yield valid"
                          : "Premium covers interest"
                    }
                    ok={
                      selectedProductType === "sell_call"
                        ? audit.checks.clientYieldFormulaValid ?? false
                        : audit.sellPutPricingMethod === "target_firm_profit"
                          ? audit.checks.clientYieldFormulaValid ?? false
                        : audit.checks.premiumCoversInterest
                    }
                  />
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
                      <span>Contract amount</span>
                      <strong className="mono">{formatNumber(marginCheck.amount, 1)}</strong>
                    </div>
                    <div className="soft-row">
                      <span>Bid price</span>
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
        ) : (
          <div style={{ marginTop: 24 }}>
            <AdminYieldSurface />
          </div>
        )}
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
