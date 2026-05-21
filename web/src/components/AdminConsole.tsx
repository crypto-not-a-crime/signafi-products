"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DcnCandidate,
  DeribitMarginCheck,
  MarketExpirySummary,
  MarketOption,
  PppCandidate,
  PppPricingDiagnostics,
  PppSelectorMode,
  PricingConfig,
  SellPutPricingMethod
} from "@/types";
import { formatNumber, formatPct, formatUsd } from "@/lib/format";
import { calculateScenario, getScenarioRange } from "@/lib/dcn-scenario";
import { calculatePppScenario, getPppScenarioRange, type PppAdminScenarioResult } from "@/lib/ppp-scenario";
import {
  buildDcnVerificationGuide,
  buildPppVerificationGuide,
  type VerificationStep,
  type VerificationStepStatus
} from "@/lib/admin-verification-guide";
import { AdminYieldSurface } from "@/components/AdminYieldSurface";
import { AdminPppOfferSurface } from "@/components/AdminPppOfferSurface";

interface Health {
  marketDataMode?: PricingConfig["marketDataMode"];
  activeInstrumentCount?: number;
  quoteCount?: number;
  staleQuoteCount?: number;
  summaryStaleCount?: number;
  liveTickerFreshCount?: number;
  subscribedStreamCount?: number;
  depthCacheCount?: number;
  freshDepthCacheCount?: number;
  catalogSyncAgeSeconds?: number | null;
  summarySyncAgeSeconds?: number | null;
  instrumentSyncAgeSeconds?: number | null;
  summaryFreshnessSeconds?: number;
  liveFreshnessSeconds?: number;
  latestQuoteAt?: number;
  latestSyncAt?: number;
  streamStatus?: unknown;
  mock?: boolean;
}

type AdminProductType = "sell_put" | "sell_call" | "ppp";
type MarketDataMode = PricingConfig["marketDataMode"];

export function AdminConsole() {
  const [activeTab, setActiveTab] = useState<"audit" | "yield-surface" | "ppp-matrix">("audit");
  const [selectedProductType, setSelectedProductType] = useState<AdminProductType>("sell_put");
  const [health, setHealth] = useState<Health | null>(null);
  const [marketDataMode, setMarketDataMode] = useState<MarketDataMode>("legacy_rest");
  const [savedMarketDataMode, setSavedMarketDataMode] = useState<MarketDataMode>("legacy_rest");
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
  const [pppSelectorMode, setPppSelectorMode] = useState<PppSelectorMode>("auto_participation");
  const [pppProtectionPct, setPppProtectionPct] = useState(80);
  const [pppParticipationPct, setPppParticipationPct] = useState(30);
  const [sellPutPricingMethod, setSellPutPricingMethod] = useState<SellPutPricingMethod>("firm_margin");
  const [savedSellPutPricingMethod, setSavedSellPutPricingMethod] = useState<SellPutPricingMethod>("firm_margin");
  const [firmMarginPct, setFirmMarginPct] = useState(2);
  const [savedFirmMarginPct, setSavedFirmMarginPct] = useState(2);
  const [sellPutTargetFirmProfitPct, setSellPutTargetFirmProfitPct] = useState(5);
  const [savedSellPutTargetFirmProfitPct, setSavedSellPutTargetFirmProfitPct] = useState(5);
  const [sellCallTargetFirmProfitPct, setSellCallTargetFirmProfitPct] = useState(5);
  const [savedSellCallTargetFirmProfitPct, setSavedSellCallTargetFirmProfitPct] = useState(5);
  const [pppTargetFirmMarginPct, setPppTargetFirmMarginPct] = useState(5);
  const [savedPppTargetFirmMarginPct, setSavedPppTargetFirmMarginPct] = useState(5);
  const [pppIncludeDeliveryFees, setPppIncludeDeliveryFees] = useState(true);
  const [savedPppIncludeDeliveryFees, setSavedPppIncludeDeliveryFees] = useState(true);
  const [pppParticipationRoundDownPct, setPppParticipationRoundDownPct] = useState(0);
  const [savedPppParticipationRoundDownPct, setSavedPppParticipationRoundDownPct] = useState(0);
  const [expiryPrice, setExpiryPrice] = useState<number | null>(null);
  const [audit, setAudit] = useState<DcnCandidate | null>(null);
  const [pppAudit, setPppAudit] = useState<PppCandidate | null>(null);
  const [pppDiagnostics, setPppDiagnostics] = useState<PppPricingDiagnostics | null>(null);
  const [marginCheck, setMarginCheck] = useState<DeribitMarginCheck | null>(null);
  const [quoteVerification, setQuoteVerification] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [marginLoading, setMarginLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [verificationRunId, setVerificationRunId] = useState(0);

  useEffect(() => {
    void refreshHealth();
    void loadPricingConfig();
    void loadExpiryOptions();
  }, []);

  useEffect(() => {
    if (selectedProductType === "ppp") {
      setSelectedOptionType("put");
      setOptions([]);
      setSelectedStrike("");
      return;
    }
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

  const pppExpiryOptions = useMemo(() => {
    const optionTypesByExpiry = new Map<number, Set<MarketExpirySummary["option_type"]>>();
    for (const item of expirySummaries) {
      if (!item.expiration_timestamp) continue;
      const optionTypes = optionTypesByExpiry.get(item.expiration_timestamp) ?? new Set<MarketExpirySummary["option_type"]>();
      optionTypes.add(item.option_type);
      optionTypesByExpiry.set(item.expiration_timestamp, optionTypes);
    }
    return Array.from(optionTypesByExpiry.entries())
      .filter(([, optionTypes]) => optionTypes.has("call") && optionTypes.has("put"))
      .map(([expiry]) => expiry)
      .sort((a, b) => a - b);
  }, [expirySummaries]);

  const activeExpiryOptions = selectedProductType === "ppp" ? pppExpiryOptions : expiryOptions;
  const selectedPppExpirationTimestamp = Number(selectedExpiry);
  const selectedPppRunwayDays =
    Number.isFinite(selectedPppExpirationTimestamp) && selectedPppExpirationTimestamp > 0
      ? dayCountFromExpiryTimestamp(selectedPppExpirationTimestamp)
      : 92;

  useEffect(() => {
    if (activeExpiryOptions.length === 0) return;
    if (!activeExpiryOptions.some((expiry) => String(expiry) === selectedExpiry)) {
      setSelectedExpiry(String(activeExpiryOptions[0]));
    }
  }, [activeExpiryOptions, selectedExpiry]);

  useEffect(() => {
    if (!selectedExpiry || selectedProductType === "ppp") return;
    void loadOptions(selectedOptionType, selectedExpiry);
  }, [selectedExpiry, selectedOptionType, selectedProductType]);

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
    setPppAudit(null);
    setPppDiagnostics(null);
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
    pppTargetFirmMarginPct,
    pppSelectorMode,
    selectedExpiry,
    pppProtectionPct,
    pppParticipationPct,
    pppIncludeDeliveryFees,
    selectedProductType
  ]);

  useEffect(() => {
    if (!audit) return;
    const range = getAdminScenarioRange(audit);
    setExpiryPrice((current) =>
      current === null || current < range.min || current > range.max ? range.defaultPrice : current
    );
  }, [audit?.instrumentName, audit?.strike]);

  useEffect(() => {
    if (!pppAudit) return;
    const range = getPppScenarioRange(pppAudit);
    setExpiryPrice((current) =>
      current === null || current < range.min || current > range.max ? range.defaultPrice : current
    );
  }, [pppAudit?.expirationTimestamp, pppAudit?.spotPrice]);

  async function refreshHealth() {
    const response = await fetch("/api/admin/market-health", { cache: "no-store" });
    setHealth(await response.json());
  }

  async function loadPricingConfig() {
    const response = await fetch("/api/admin/pricing-config", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { pricingConfig?: PricingConfig };
    const mode = payload.pricingConfig?.marketDataMode;
    if (mode === "legacy_rest" || mode === "hybrid_cache") {
      setMarketDataMode(mode);
      setSavedMarketDataMode(mode);
    }
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
    const pppTargetBps = payload.pricingConfig?.pppTargetFirmMarginBps;
    if (typeof pppTargetBps === "number" && Number.isFinite(pppTargetBps)) {
      const pppTarget = pppTargetBps / 100;
      setPppTargetFirmMarginPct(pppTarget);
      setSavedPppTargetFirmMarginPct(pppTarget);
    }
    if (typeof payload.pricingConfig?.pppIncludeDeliveryFees === "boolean") {
      setPppIncludeDeliveryFees(payload.pricingConfig.pppIncludeDeliveryFees);
      setSavedPppIncludeDeliveryFees(payload.pricingConfig.pppIncludeDeliveryFees);
    }
    const pppRoundDownBps = payload.pricingConfig?.pppParticipationRoundDownBps;
    if (typeof pppRoundDownBps === "number" && Number.isFinite(pppRoundDownBps)) {
      const pppRoundDown = pppRoundDownBps / 100;
      setPppParticipationRoundDownPct(pppRoundDown);
      setSavedPppParticipationRoundDownPct(pppRoundDown);
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
  const pppTargetFirmMarginBps = Math.max(0, Math.round(pppTargetFirmMarginPct * 100));
  const savedPppTargetFirmMarginBps = Math.max(0, Math.round(savedPppTargetFirmMarginPct * 100));
  const pppParticipationRoundDownBps = Math.max(0, Math.round(pppParticipationRoundDownPct * 100));
  const savedPppParticipationRoundDownBps = Math.max(0, Math.round(savedPppParticipationRoundDownPct * 100));
  const pricingConfigChanged =
    marketDataMode !== savedMarketDataMode ||
    sellPutPricingMethod !== savedSellPutPricingMethod ||
    firmMarginBps !== savedFirmMarginBps ||
    sellPutTargetFirmProfitBps !== savedSellPutTargetFirmProfitBps ||
    sellCallTargetFirmProfitBps !== savedSellCallTargetFirmProfitBps ||
    pppTargetFirmMarginBps !== savedPppTargetFirmMarginBps ||
    pppIncludeDeliveryFees !== savedPppIncludeDeliveryFees ||
    pppParticipationRoundDownBps !== savedPppParticipationRoundDownBps;

  async function savePricingConfig() {
    setSavingConfig(true);
    setConfigMessage(null);
    try {
      const response = await fetch("/api/admin/pricing-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketDataMode,
          sellPutPricingMethod,
          firmMarginBps,
          sellPutTargetFirmProfitBps,
          sellCallTargetFirmProfitBps,
          pppTargetFirmMarginBps,
          pppIncludeDeliveryFees,
          pppParticipationRoundDownBps
        })
      });
      const payload = (await response.json()) as { pricingConfig?: PricingConfig; error?: string };
      if (!response.ok) {
        setConfigMessage(payload.error ?? `Save failed with HTTP ${response.status}`);
        return;
      }
      const nextMarketDataMode = payload.pricingConfig?.marketDataMode ?? marketDataMode;
      setMarketDataMode(nextMarketDataMode);
      setSavedMarketDataMode(nextMarketDataMode);
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
      const nextPppTargetBps = payload.pricingConfig?.pppTargetFirmMarginBps ?? pppTargetFirmMarginBps;
      const nextPppTargetPct = nextPppTargetBps / 100;
      setPppTargetFirmMarginPct(nextPppTargetPct);
      setSavedPppTargetFirmMarginPct(nextPppTargetPct);
      const nextPppIncludeDeliveryFees = payload.pricingConfig?.pppIncludeDeliveryFees ?? pppIncludeDeliveryFees;
      setPppIncludeDeliveryFees(nextPppIncludeDeliveryFees);
      setSavedPppIncludeDeliveryFees(nextPppIncludeDeliveryFees);
      const nextPppRoundDownBps = payload.pricingConfig?.pppParticipationRoundDownBps ?? pppParticipationRoundDownBps;
      const nextPppRoundDownPct = nextPppRoundDownBps / 100;
      setPppParticipationRoundDownPct(nextPppRoundDownPct);
      setSavedPppParticipationRoundDownPct(nextPppRoundDownPct);
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
      if (selectedProductType === "ppp") {
        await requestPppAuditCalculation();
        await refreshHealth();
        return;
      }
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
        setVerificationRunId((current) => current + 1);
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
    setVerificationRunId((current) => current + 1);
    return calculation;
  }

  async function requestPppAuditCalculation(): Promise<PppCandidate | null> {
    const response = await fetch("/api/admin/ppp-audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        investmentUsdt,
        runwayDays: selectedPppRunwayDays,
        expirationTimestamp:
          Number.isFinite(selectedPppExpirationTimestamp) && selectedPppExpirationTimestamp > 0
            ? selectedPppExpirationTimestamp
            : undefined,
        selectorMode: pppSelectorMode,
        protectionLevelBps: Math.round(pppProtectionPct * 100),
        participationLevelBps: Math.round(pppParticipationPct * 100),
        targetFirmMarginBps: pppTargetFirmMarginBps,
        includeDeliveryFees: pppIncludeDeliveryFees,
        orderBookDepth: 100
      })
    });
    const payload = (await response.json()) as {
      calculation?: PppCandidate;
      bestCandidate?: PppCandidate;
      diagnostics?: PppPricingDiagnostics;
      error?: string;
    };
    const calculation = payload.calculation ?? payload.bestCandidate ?? null;
    setPppAudit(calculation);
    setPppDiagnostics(payload.diagnostics ?? null);
    setExpiryPrice(null);
    setVerificationRunId((current) => current + 1);
    return calculation;
  }

  async function runAudit() {
    setLoading(true);
    setMarginCheck(null);
    try {
      if (selectedProductType === "ppp") await requestPppAuditCalculation();
      else await requestAuditCalculation();
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
  const selectedScenario = useMemo(
    () => (audit && selectedExpiryPrice !== null ? calculateScenario(audit, selectedExpiryPrice) : null),
    [audit, selectedExpiryPrice]
  );
  const pppScenarioRange = pppAudit ? getPppScenarioRange(pppAudit) : null;
  const selectedPppExpiryPrice = pppScenarioRange ? expiryPrice ?? pppScenarioRange.defaultPrice : null;
  const selectedPppScenario = useMemo(
    () => (pppAudit && selectedPppExpiryPrice !== null ? calculatePppScenario(pppAudit, selectedPppExpiryPrice) : null),
    [pppAudit, selectedPppExpiryPrice]
  );
  const dcnVerificationSteps = useMemo(
    () => (audit ? buildDcnVerificationGuide(audit, selectedScenario) : []),
    [audit, selectedScenario]
  );
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
          <Metric
            label="Market data mode"
            value={formatMarketDataMode(health?.marketDataMode ?? savedMarketDataMode)}
            tone={(health?.marketDataMode ?? savedMarketDataMode) === "legacy_rest" ? "ok" : "warn"}
          />
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
          <Metric label="Stream subscribed" value={health?.subscribedStreamCount ?? "-"} />
          <Metric label="Fresh depth cache" value={`${health?.freshDepthCacheCount ?? "-"}/${health?.depthCacheCount ?? "-"}`} />
          <Metric label="Summary sync age" value={formatAge(health?.summarySyncAgeSeconds)} tone={(health?.summarySyncAgeSeconds ?? 0) > 900 ? "warn" : "ok"} />
          <Metric label="Catalog age" value={formatAge(health?.catalogSyncAgeSeconds)} tone={(health?.catalogSyncAgeSeconds ?? 0) > 3600 ? "warn" : "ok"} />
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
          <button
            className={activeTab === "ppp-matrix" ? "active" : ""}
            onClick={() => setActiveTab("ppp-matrix")}
            type="button"
          >
            PPP Matrix
          </button>
        </div>

        {activeTab === "audit" ? (
        <div className="audit-grid" style={{ marginTop: 24 }}>
          <div className="admin-card">
            <h2 className="card-title">Run verification</h2>
            <div className="form-grid">
              <label>
                <span className="field-label">Market data mode</span>
                <select
                  className="admin-input"
                  value={marketDataMode}
                  onChange={(event) => setMarketDataMode(event.target.value as MarketDataMode)}
                >
                  <option value="legacy_rest">On-demand REST</option>
                  <option value="hybrid_cache">Hybrid cache</option>
                </select>
              </label>
              <label>
                <span className="field-label">Product</span>
                <select
                  className="admin-input"
                  value={selectedProductType}
                  onChange={(event) => setSelectedProductType(event.target.value as AdminProductType)}
                  disabled={optionsLoading}
                >
                  <option value="sell_put">DCN Put</option>
                  <option value="sell_call">DCN Call</option>
                  <option value="ppp">PPP</option>
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
              {selectedProductType === "ppp" ? (
                <>
                  <label>
                    <span className="field-label">PPP solver mode</span>
                    <select
                      className="admin-input"
                      value={pppSelectorMode}
                      onChange={(event) => setPppSelectorMode(event.target.value as PppSelectorMode)}
                    >
                      <option value="closest">Closest Match</option>
                      <option value="auto_participation">Auto Participation</option>
                      <option value="auto_protection">Auto Protection</option>
                    </select>
                  </label>
                  <label>
                    <span className="field-label">Expiry date</span>
                    <select
                      className="admin-input"
                      value={selectedExpiry}
                      onChange={(event) => setSelectedExpiry(event.target.value)}
                      disabled={optionsLoading || pppExpiryOptions.length === 0}
                    >
                      {pppExpiryOptions.map((expiry) => (
                        <option key={expiry} value={expiry}>
                          {formatExpiry(expiry)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="field-label">Protection level</span>
                    <input
                      className="admin-input"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={pppProtectionPct}
                      disabled={pppSelectorMode === "auto_protection"}
                      onChange={(event) => setPppProtectionPct(Number(event.target.value))}
                    />
                  </label>
                  <label>
                    <span className="field-label">Participation level</span>
                    <input
                      className="admin-input"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={pppParticipationPct}
                      disabled={pppSelectorMode === "auto_participation"}
                      onChange={(event) => setPppParticipationPct(Number(event.target.value))}
                    />
                  </label>
                </>
              ) : (
                <>
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
                </>
              )}
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
                  {selectedProductType === "ppp"
                    ? "PPP target firm margin % p.a."
                    : selectedProductType === "sell_call"
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
                    selectedProductType === "ppp"
                      ? pppTargetFirmMarginPct
                      : selectedProductType === "sell_call"
                      ? sellCallTargetFirmProfitPct
                      : sellPutPricingMethod === "target_firm_profit"
                      ? sellPutTargetFirmProfitPct
                      : firmMarginPct
                  }
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (selectedProductType === "ppp") setPppTargetFirmMarginPct(Number.isFinite(next) ? next : 0);
                    else if (selectedProductType === "sell_call") setSellCallTargetFirmProfitPct(Number.isFinite(next) ? next : 0);
                    else if (sellPutPricingMethod === "target_firm_profit") {
                      setSellPutTargetFirmProfitPct(Number.isFinite(next) ? next : 0);
                    } else setFirmMarginPct(Number.isFinite(next) ? next : 0);
                  }}
                />
              </label>
              {selectedProductType === "ppp" ? (
                <label>
                  <span className="field-label">PPP participation rounding increment %</span>
                  <input
                    className="admin-input"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={pppParticipationRoundDownPct}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setPppParticipationRoundDownPct(Number.isFinite(next) ? next : 0);
                    }}
                  />
                </label>
              ) : null}
              {selectedProductType === "ppp" ? (
                <label>
                  <span className="field-label">Include delivery fees</span>
                  <div className="soft-row">
                    <span>Deribit delivery-fee stress</span>
                    <input
                      type="checkbox"
                      checked={pppIncludeDeliveryFees}
                      onChange={(event) => setPppIncludeDeliveryFees(event.target.checked)}
                    />
                  </div>
                </label>
              ) : null}
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
              <span>Saved market data mode</span>
              <strong className="mono">{formatMarketDataMode(savedMarketDataMode)}</strong>
            </div>
            <div className="soft-row" style={{ marginTop: 12 }}>
              <span>
                {selectedProductType === "ppp"
                  ? "Saved PPP target firm margin"
                  : selectedProductType === "sell_call"
                  ? "Saved call target firm profit"
                  : sellPutPricingMethod === "target_firm_profit"
                    ? "Saved put target firm profit"
                    : "Saved firm margin"}
              </span>
              <strong className="mono">
                {selectedProductType === "ppp"
                  ? savedPppTargetFirmMarginPct.toFixed(1)
                  : selectedProductType === "sell_call"
                  ? savedSellCallTargetFirmProfitPct.toFixed(1)
                  : sellPutPricingMethod === "target_firm_profit"
                    ? savedSellPutTargetFirmProfitPct.toFixed(1)
                    : savedFirmMarginPct.toFixed(1)}
                % p.a.
              </strong>
            </div>
            {selectedProductType === "ppp" ? (
              <div className="soft-row" style={{ marginTop: 12 }}>
                <span>Saved PPP delivery-fee stress</span>
                <strong className="mono">{savedPppIncludeDeliveryFees ? "On" : "Off"}</strong>
              </div>
            ) : null}
            {selectedProductType === "ppp" ? (
              <div className="soft-row" style={{ marginTop: 12 }}>
                <span>Saved PPP participation rounding</span>
                <strong className="mono">
                  {savedPppParticipationRoundDownBps > 0
                    ? `${savedPppParticipationRoundDownPct.toFixed(1)}% increments`
                    : "Off"}
                </strong>
              </div>
            ) : null}
            <div className="soft-row" style={{ marginTop: 12 }}>
              <span>{selectedProductType === "ppp" ? "Selected package" : "Selected instrument"}</span>
              <strong className="mono">
                {selectedProductType === "ppp"
                  ? selectedExpiry
                    ? formatExpiry(Number(selectedExpiry))
                    : "-"
                  : optionsLoading
                    ? "Loading..."
                    : instrumentName || "-"}
              </strong>
            </div>
            <div className="quick-btns">
              <button
                className="admin-button"
                onClick={runAudit}
                disabled={
                  busy ||
                  savingConfig ||
                  (selectedProductType === "ppp"
                    ? !selectedExpiry || pppExpiryOptions.length === 0
                    : !instrumentName)
                }
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
                disabled={busy || savingConfig || selectedProductType === "ppp" || !instrumentName}
              >
                {marginLoading ? "Checking..." : "Check margins"}
              </button>
              <button className="btn-ghost" onClick={verifyQuote} disabled={busy || savingConfig || selectedProductType === "ppp" || !instrumentName}>
                Verify Deribit quote
              </button>
              <button
                className="btn-ghost"
                onClick={() => void refreshMarket()}
                disabled={
                  busy ||
                  savingConfig ||
                  optionsLoading ||
                  syncingMarket ||
                  (selectedProductType === "ppp"
                    ? !selectedExpiry || pppExpiryOptions.length === 0
                    : !instrumentName)
                }
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

            {pppAudit ? (
              <PppAdminAuditPanel
                audit={pppAudit}
                diagnostics={pppDiagnostics}
                verificationRunId={verificationRunId}
                scenarioRange={pppScenarioRange}
                selectedExpiryPrice={selectedPppExpiryPrice}
                selectedScenario={selectedPppScenario}
                onExpiryPriceChange={setExpiryPrice}
              />
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

                <DcnAdminHedgePackage audit={audit} />

                <CalculationVerificationGuide
                  resetKey={`dcn-${verificationRunId}`}
                  steps={dcnVerificationSteps}
                  subject={audit.productType === "sell_call" ? "Sell call DCN" : "Sell put DCN"}
                />

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
              {pppAudit ? (
                <p className="card-copy">
                  PPP hedge depth, executable prices, quote age, and slippage are shown in the PPP Hedge Package.
                </p>
              ) : audit ? (
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
              {pppAudit?.formulaTemplate ? (
                <>
                  <div className="soft-row">
                    <span>Template</span>
                    <strong>{pppAudit.formulaTemplate.label}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Version</span>
                    <strong className="mono">{pppAudit.formulaTemplate.version}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Workbook</span>
                    <strong>{pppAudit.formulaTemplate.sourceWorkbook}</strong>
                  </div>
                </>
              ) : audit?.formulaTemplate ? (
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
              {pppAudit ? (
                <>
                  <CheckRow label="Quote fresh" ok={pppAudit.checks.quoteFresh} />
                  <CheckRow label="Sufficient hedge depth" ok={pppAudit.checks.sufficientDepth} />
                  <CheckRow label="Slippage within limit" ok={pppAudit.checks.slippageWithinLimit} />
                  <CheckRow label="Participation positive" ok={pppAudit.checks.participationPositive} />
                  <CheckRow label="Call hedge covers participation" ok={pppAudit.checks.callHedgeAtOrAboveParticipation ?? true} />
                  <CheckRow label="Target firm margin met" ok={pppAudit.checks.targetProfitMet} />
                  {selectedPppScenario ? (
                    <CheckRow label="Selected firm P&L positive" ok={selectedPppScenario.issuerPnlUsdt > 0} />
                  ) : null}
                </>
              ) : audit && selectedScenario ? (
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
        ) : activeTab === "yield-surface" ? (
          <div style={{ marginTop: 24 }}>
            <AdminYieldSurface />
          </div>
        ) : (
          <div style={{ marginTop: 24 }}>
            <AdminPppOfferSurface />
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

function dayCountFromExpiryTimestamp(expirationTimestamp: number): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const now = new Date();
  const expiry = new Date(expirationTimestamp);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryUtc = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  return Math.max(0, Math.round((expiryUtc - todayUtc) / msPerDay));
}

function getAdminScenarioRange(candidate: DcnCandidate) {
  return getScenarioRange(candidate, {
    min: 0,
    max: candidate.strike * 3,
    step: 1000
  });
}

function CalculationVerificationGuide({
  resetKey,
  steps,
  subject
}: {
  resetKey: string;
  steps: VerificationStep[];
  subject: string;
}) {
  const [reviewedStepIds, setReviewedStepIds] = useState<Set<string>>(() => new Set());
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    setReviewedStepIds(new Set());
    setCopyState("idle");
  }, [resetKey]);

  if (steps.length === 0) return null;

  const reviewedCount = reviewedStepIds.size;

  function toggleReviewed(stepId: string, checked: boolean) {
    setReviewedStepIds((current) => {
      const next = new Set(current);
      if (checked) next.add(stepId);
      else next.delete(stepId);
      return next;
    });
  }

  async function copySummary() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(buildVerificationSummary(subject, steps, reviewedCount));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className="verification-guide" aria-label={`${subject} verification walkthrough`}>
      <div className="verification-head">
        <div>
          <h3 className="card-title">Verification walkthrough</h3>
          <p className="card-copy">Step through the audit in workbook order, then use the raw trace below for cell-level backup.</p>
        </div>
        <div className="verification-actions">
          <span className="small-muted">
            Reviewed {reviewedCount}/{steps.length}
          </span>
          <button className="btn-ghost" type="button" onClick={() => void copySummary()}>
            Copy verification summary
          </button>
          {copyState !== "idle" ? (
            <span className={`status-badge ${copyState === "copied" ? "status-live" : "status-fail"}`}>
              {copyState === "copied" ? "Copied" : "Copy failed"}
            </span>
          ) : null}
        </div>
      </div>

      <ol className="verification-flow" aria-label="Verification step flow">
        {steps.map((step, index) => (
          <li className={`verification-node ${step.status}`} key={step.id}>
            <span>{index + 1}</span>
            <strong>{step.title}</strong>
          </li>
        ))}
      </ol>

      <div className="verification-step-list">
        {steps.map((step, index) => (
          <article className="verification-step" key={step.id}>
            <div className="verification-step-head">
              <div>
                <div className="field-label">Step {index + 1}</div>
                <h4>{step.title}</h4>
              </div>
              <span className={`status-badge ${statusClass(step.status)}`}>{statusLabel(step.status)}</span>
            </div>

            <div className="verification-output">
              <span>{step.outputLabel}</span>
              <strong className="mono">{step.outputValue}</strong>
            </div>

            <div className="verification-copy-block">
              <span className="field-label">Verify this</span>
              <p>{step.purpose}</p>
            </div>

            <div className="verification-copy-block">
              <span className="field-label">Formula</span>
              <p className="verification-formula">{step.formulaText}</p>
            </div>

            <div className="verification-meta">
              {step.workbookRefs.length > 0 ? (
                <div className="verification-chip-row">
                  {step.workbookRefs.map((ref) => (
                    <span className="verification-chip mono" key={ref}>
                      {ref}
                    </span>
                  ))}
                </div>
              ) : null}
              {step.checkKeys.length > 0 ? (
                <div className="verification-checks">
                  {step.checkKeys.map((key) => (
                    <span className="verification-check" key={key}>
                      {formatCheckKey(key)}
                    </span>
                  ))}
                </div>
              ) : null}
              {step.dependsOn.length > 0 ? (
                <p className="small-muted">Depends on {step.dependsOn.map(formatStepId).join(", ")}</p>
              ) : null}
            </div>

            <details className="verification-source">
              <summary>Source rows ({step.traceRows.length})</summary>
              {step.traceRows.length > 0 ? (
                <table className="trace-table verification-source-table">
                  <thead>
                    <tr>
                      <th>Cell</th>
                      <th>Label</th>
                      <th>Formula</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {step.traceRows.map((row, rowIndex) => (
                      <tr key={`${row.cell}-${row.label}-${rowIndex}`}>
                        <td className="mono">{row.cell}</td>
                        <td>{row.label}</td>
                        <td>{row.formula}</td>
                        <td className="mono">{formatTraceValue(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="card-copy">No matching trace rows for this grouped step.</p>
              )}
            </details>

            <label className="verification-review">
              <input
                checked={reviewedStepIds.has(step.id)}
                onChange={(event) => toggleReviewed(step.id, event.currentTarget.checked)}
                type="checkbox"
              />
              Reviewed
            </label>
          </article>
        ))}
      </div>
    </section>
  );
}

function DcnAdminHedgePackage({ audit }: { audit: DcnCandidate }) {
  const requiredContracts = Number.isFinite(audit.depth.requiredContracts)
    ? audit.depth.requiredContracts
    : audit.requiredContracts;
  const averagePrice =
    audit.depth.effectiveOptionBidPrice ?? audit.effectiveOptionBidPrice ?? audit.effectivePutBidPrice;

  return (
    <div className="scenario-panel">
      <div className="row-between">
        <div>
          <div className="field-label">DCN hedge package</div>
          <strong>{formatDcnHedgeRole(audit.productType)}</strong>
        </div>
        <strong className="mono">{audit.dayCount} days</strong>
      </div>
      <table className="trace-table">
        <thead>
          <tr>
            <th>Hedge</th>
            <th>Side</th>
            <th>Instrument</th>
            <th>Strike</th>
            <th>Contracts</th>
            <th>Avg price</th>
            <th>Slippage</th>
            <th>Quote age</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{formatDcnHedgeRole(audit.productType)}</td>
            <td>Sell</td>
            <td className="mono">{audit.instrumentName}</td>
            <td className="mono">{formatUsd(audit.strike)}</td>
            <td className="mono">{formatNumber(requiredContracts, 1)}</td>
            <td className="mono">{formatNumber(averagePrice, 5)}</td>
            <td className="mono">{formatPct(audit.depth.slippagePct, 3)}</td>
            <td className="mono">{formatAge(audit.quoteAgeSeconds)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PppAdminAuditPanel({
  audit,
  diagnostics,
  verificationRunId,
  scenarioRange,
  selectedExpiryPrice,
  selectedScenario,
  onExpiryPriceChange
}: {
  audit: PppCandidate;
  diagnostics: PppPricingDiagnostics | null;
  verificationRunId: number;
  scenarioRange: ReturnType<typeof getPppScenarioRange> | null;
  selectedExpiryPrice: number | null;
  selectedScenario: PppAdminScenarioResult | null;
  onExpiryPriceChange: (value: number) => void;
}) {
  const verificationSteps = useMemo(() => buildPppVerificationGuide(audit), [audit]);
  const traceRows = useMemo(() => {
    if (!selectedScenario) return audit.formulaTrace;
    const baseTrace = audit.formulaTrace.filter((row) => !row.cell.startsWith("Scenario PnL!"));
    return [...baseTrace, ...selectedScenario.formulaTrace];
  }, [audit.formulaTrace, selectedScenario]);

  return (
    <>
      <div className="metric-grid">
        <Metric
          label="Participation quote"
          value={formatPct(audit.quotedParticipation, 2)}
          tone={audit.eligible ? "ok" : "warn"}
        />
        <Metric label="Engine max participation" value={formatPct(audit.optimizedParticipation, 2)} />
        <Metric
          label={audit.recommendedLever === "protection" ? "Max protection" : "Protection"}
          value={formatPct(audit.quotedProtection, 2)}
          tone={audit.eligible ? "ok" : "warn"}
        />
        <Metric
          label="Selected firm P&L"
          value={formatUsd(selectedScenario?.issuerPnlUsdt)}
          tone={(selectedScenario?.issuerPnlUsdt ?? 0) > 0 ? "ok" : "fail"}
        />
        <Metric label="Client payout" value={formatUsd(selectedScenario?.clientPayoutUsdt, 2)} />
        <Metric label="BTC_USDC spot" value={formatUsd(audit.spotPrice)} />
        <Metric
          label="Minimum scenario P&L"
          value={formatUsd(audit.minScenarioPnlUsdt)}
          tone={(audit.minScenarioPnlUsdt ?? 0) >= audit.targetProfitUsdt ? "ok" : "fail"}
        />
        <Metric label="Target firm margin" value={formatPct(audit.targetFirmMarginBps / 10000, 1)} />
      </div>

      {scenarioRange && selectedExpiryPrice !== null && selectedScenario ? (
        <div className="scenario-panel">
          <div className="row-between">
            <div>
              <div className="field-label">BTC expiry price</div>
              <strong>{selectedScenario.scenarioLabel}</strong>
            </div>
            <strong className="mono">{formatUsd(selectedExpiryPrice)}</strong>
          </div>
          <input
            type="range"
            min={scenarioRange.min}
            max={scenarioRange.max}
            step={scenarioRange.step}
            value={selectedExpiryPrice}
            onChange={(event) => onExpiryPriceChange(Number(event.target.value))}
          />
          <div className="range-labels">
            <span>{formatUsd(scenarioRange.min)}</span>
            <span>Spot {formatUsd(audit.spotPrice)}</span>
            <span>{formatUsd(scenarioRange.max)}</span>
          </div>
          <div className="metric-grid">
            <Metric label="Annualized firm P&L" value={formatPct(selectedScenario.annualizedFirmPnl)} />
            <Metric label="Net hedge payoff" value={formatUsd(selectedScenario.netHedgePayoffUsdt, 2)} />
            <Metric label="Delivery fees" value={formatUsd(selectedScenario.deliveryFeesUsdt, 2)} />
            <Metric label="Client payout" value={formatUsd(selectedScenario.clientPayoutUsdt, 2)} />
          </div>
        </div>
      ) : null}

      <div className="scenario-panel">
        <div className="row-between">
          <div>
            <div className="field-label">PPP hedge package</div>
            <strong>{formatExpiry(audit.expirationTimestamp)}</strong>
          </div>
          <strong className="mono">{audit.dayCount} days</strong>
        </div>
        <div className="metric-grid">
          <Metric label="Protection level" value={formatPct(audit.protectionLevel, 0)} />
          <Metric label="Implied hedge floor" value={formatPct(audit.putSpreadImpliedFloor, 2)} />
          <Metric label="Call contracts" value={formatNumber(audit.optimalCallContracts, 1)} />
          <Metric label="Put spread contracts" value={formatNumber(audit.putSpreadContracts, 1)} />
          <Metric label="Solver mode" value={audit.selectorMode.replace("_", " ")} />
          <Metric label="Delivery fees" value={audit.includeDeliveryFees ? "On" : "Off"} />
          <Metric
            label="Participation rounding"
            value={audit.participationRoundDownBps > 0 ? `${(audit.participationRoundDownBps / 100).toFixed(1)}%` : "Off"}
          />
        </div>
        <table className="trace-table">
          <thead>
            <tr>
              <th>Hedge</th>
              <th>Side</th>
              <th>Instrument</th>
              <th>Strike</th>
              <th>Contracts</th>
              <th>Avg price</th>
              <th>Slippage</th>
              <th>Quote age</th>
            </tr>
          </thead>
          <tbody>
            {audit.legs.map((leg) => (
              <tr key={leg.role}>
                <td>{formatPppLegRole(leg.role)}</td>
                <td>{leg.side === "buy" ? "Buy" : "Sell"}</td>
                <td className="mono">{leg.instrumentName}</td>
                <td className="mono">{formatUsd(leg.strike)}</td>
                <td className="mono">{formatNumber(leg.requiredContracts, 1)}</td>
                <td className="mono">{formatNumber(leg.averagePrice, 5)}</td>
                <td className="mono">{formatPct(leg.depth.slippagePct, 3)}</td>
                <td className="mono">{formatAge(leg.quoteAgeSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {diagnostics ? (
        <div className="scenario-panel">
          <div>
            <div className="field-label">PPP pricing coverage</div>
            <strong>Shortlist diagnostics</strong>
          </div>
          <div className="metric-grid">
            <Metric label="Expiries scanned" value={formatNumber(diagnostics.totalExpiriesScanned, 0)} />
            <Metric label="Rough packages" value={formatNumber(diagnostics.totalRoughPackages, 0)} />
            <Metric label="Shortlisted packages" value={formatNumber(diagnostics.shortlistedPackages, 0)} />
            <Metric label="Live priced packages" value={formatNumber(diagnostics.livePricedPackages, 0)} />
            <Metric label="Unique order books" value={formatNumber(diagnostics.uniqueOrderBooksFetched, 0)} />
            <Metric label="Depth cap" value={formatNumber(diagnostics.depthCandidateCap, 0)} />
            <Metric label="Duration guardrail" value={`${formatNumber(diagnostics.durationGuardrailDays, 0)} days`} />
            <Metric label="In-window packages" value={formatNumber(diagnostics.inWindowPackages, 0)} />
            <Metric label="Out-of-window packages" value={formatNumber(diagnostics.outOfWindowPackages, 0)} />
            <Metric label="Duration fallback" value={diagnostics.durationFallbackUsed ? "Used" : "No"} />
            <Metric label="Pricing time" value={`${formatNumber(diagnostics.pricingElapsedMs, 0)} ms`} />
          </div>
        </div>
      ) : null}

      <CalculationVerificationGuide
        resetKey={`ppp-${verificationRunId}`}
        steps={verificationSteps}
        subject="PPP"
      />

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
          {traceRows.map((row, index) => (
            <tr key={`${row.cell}-${row.label}-${index}`}>
              <td className="mono">{row.cell}</td>
              <td>{row.label}</td>
              <td>{row.formula}</td>
              <td className="mono">{String(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function formatPppLegRole(role: PppCandidate["legs"][number]["role"]): string {
  if (role === "long_call") return "Buy ATM call";
  if (role === "short_put") return "Sell ATM put";
  return "Buy floor put";
}

function formatDcnHedgeRole(productType: DcnCandidate["productType"]): string {
  return productType === "sell_call" ? "Sell call" : "Sell put";
}

function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "-";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

function formatMarketDataMode(mode: PricingConfig["marketDataMode"] | undefined): string {
  return mode === "hybrid_cache" ? "Hybrid cache" : "On-demand REST";
}

function CheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="soft-row">
      <span>{label}</span>
      <span className={`status-badge ${ok ? "status-live" : "status-fail"}`}>{ok ? "Pass" : "Fail"}</span>
    </div>
  );
}

function statusClass(status: VerificationStepStatus): string {
  if (status === "pass") return "status-live";
  if (status === "fail") return "status-fail";
  if (status === "warn") return "status-warn";
  return "status-info";
}

function statusLabel(status: VerificationStepStatus): string {
  if (status === "pass") return "Pass";
  if (status === "fail") return "Fail";
  if (status === "warn") return "Review";
  return "Info";
}

function formatTraceValue(value: VerificationStep["traceRows"][number]["value"]): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function formatCheckKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\bpnl\b/i, "P&L")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatStepId(id: string): string {
  return id.replace(/-/g, " ");
}

function buildVerificationSummary(subject: string, steps: VerificationStep[], reviewedCount: number): string {
  const lines = [
    `${subject} verification summary`,
    `Reviewed ${reviewedCount}/${steps.length}`,
    ""
  ];

  for (const [index, step] of steps.entries()) {
    lines.push(`${index + 1}. [${statusLabel(step.status)}] ${step.title}`);
    lines.push(`   ${step.outputLabel}: ${step.outputValue}`);
    lines.push(`   Verify: ${step.purpose}`);
    lines.push(`   Formula: ${step.formulaText}`);
    if (step.workbookRefs.length > 0) lines.push(`   Workbook refs: ${step.workbookRefs.join(", ")}`);
    if (step.checkKeys.length > 0) lines.push(`   Checks: ${step.checkKeys.map(formatCheckKey).join(", ")}`);
    lines.push("");
  }

  return lines.join("\n").trim();
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
