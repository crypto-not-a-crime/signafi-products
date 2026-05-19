import type { FormulaTraceRow, PppCandidate, PppScenarioResult } from "@/types";

const DELIVERY_FEE_CAP_BTC = 0.00015;
const FEE_CAP_RATIO = 0.125;

interface ScenarioRangeOptions {
  min?: number;
  max?: number;
  step?: number;
}

export interface PppAdminScenarioResult extends PppScenarioResult {
  scenarioLabel: "Upside participation" | "Principal floor" | "Below spot";
  annualizedFirmPnl: number | null;
  netHedgePayoffUsdt: number;
  formulaTrace: FormulaTraceRow[];
}

export function getPppScenarioRange(candidate: PppCandidate, options: ScenarioRangeOptions = {}) {
  const step = options.step ?? 1000;
  const min = options.min ?? 0;
  const max = options.max ?? roundUpToStep(Math.max(candidate.spotPrice * 3, step), step);
  const defaultPrice = clamp(roundToStep(candidate.spotPrice, step), min, max);
  return { min, max, step, defaultPrice };
}

export function calculatePppScenario(candidate: PppCandidate, expiryPrice: number): PppAdminScenarioResult {
  const participation = candidate.quotedParticipation ?? candidate.optimizedParticipation ?? 0;
  const protection = candidate.quotedProtection ?? candidate.protectionLevel;
  const netOptionCashUsdt = finiteOrZero(candidate.netOptionCashUsdt);
  const spotRatio = candidate.spotPrice > 0 ? expiryPrice / candidate.spotPrice : 0;
  const clientPayoutUsdt =
    expiryPrice > candidate.spotPrice
      ? candidate.investmentUsdt * (1 + participation * (spotRatio - 1))
      : candidate.investmentUsdt * Math.max(spotRatio, protection);
  const callPayoffUsdt = candidate.optimalCallContracts * Math.max(expiryPrice - candidate.atmCallStrike, 0);
  const shortPutPayoffUsdt = -candidate.putSpreadContracts * Math.max(candidate.atmPutStrike - expiryPrice, 0);
  const floorPutPayoffUsdt = candidate.putSpreadContracts * Math.max(candidate.floorPutStrike - expiryPrice, 0);
  const grossHedgePayoffUsdt = callPayoffUsdt + shortPutPayoffUsdt + floorPutPayoffUsdt;
  const deliveryFeesUsdt = candidate.includeDeliveryFees
    ? deliveryFeeUsdt("call", expiryPrice, candidate.atmCallStrike, candidate.optimalCallContracts) +
      deliveryFeeUsdt("put", expiryPrice, candidate.atmPutStrike, candidate.putSpreadContracts) +
      deliveryFeeUsdt("put", expiryPrice, candidate.floorPutStrike, candidate.putSpreadContracts)
    : 0;
  const netHedgePayoffUsdt = grossHedgePayoffUsdt - deliveryFeesUsdt;
  const issuerPnlUsdt =
    candidate.investmentUsdt + netOptionCashUsdt + grossHedgePayoffUsdt - deliveryFeesUsdt - clientPayoutUsdt;
  const annualizedFirmPnl =
    candidate.investmentUsdt > 0 && candidate.dayCount > 0
      ? (issuerPnlUsdt / candidate.investmentUsdt / candidate.dayCount) * 365
      : null;
  const scenarioLabel = getScenarioLabel(expiryPrice, candidate.spotPrice, protection);
  const formulaTrace = buildPppScenarioTrace({
    expiryPrice,
    participation,
    protection,
    clientPayoutUsdt,
    callPayoffUsdt,
    shortPutPayoffUsdt,
    floorPutPayoffUsdt,
    grossHedgePayoffUsdt,
    deliveryFeesUsdt,
    netHedgePayoffUsdt,
    netOptionCashUsdt,
    issuerPnlUsdt,
    annualizedFirmPnl
  });

  return {
    expiryPrice,
    clientPayoutUsdt,
    callPayoffUsdt,
    shortPutPayoffUsdt,
    floorPutPayoffUsdt,
    grossHedgePayoffUsdt,
    deliveryFeesUsdt,
    issuerPnlUsdt,
    scenarioLabel,
    annualizedFirmPnl,
    netHedgePayoffUsdt,
    formulaTrace
  };
}

function buildPppScenarioTrace(input: {
  expiryPrice: number;
  participation: number;
  protection: number;
  clientPayoutUsdt: number;
  callPayoffUsdt: number;
  shortPutPayoffUsdt: number;
  floorPutPayoffUsdt: number;
  grossHedgePayoffUsdt: number;
  deliveryFeesUsdt: number;
  netHedgePayoffUsdt: number;
  netOptionCashUsdt: number;
  issuerPnlUsdt: number;
  annualizedFirmPnl: number | null;
}): FormulaTraceRow[] {
  return [
    { cell: "Scenario PnL!C59", label: "Selected BTC expiry price", formula: "admin slider selected expiry price", value: input.expiryPrice },
    {
      cell: "Robust Model!B8",
      label: "Client participation quote",
      formula: "quoted participation used in selected scenario",
      value: input.participation
    },
    {
      cell: "Robust Model!B7",
      label: "Product floor return",
      formula: "quoted protection used in selected scenario",
      value: input.protection
    },
    {
      cell: "Scenario PnL!C70",
      label: "Client payout USDT",
      formula: "IF(expiryPrice > S0, notional * (1 + participation * (expiryPrice / S0 - 1)), notional * MAX(expiryPrice / S0, protection))",
      value: input.clientPayoutUsdt
    },
    {
      cell: "Scenario PnL!C62",
      label: "ATM call payoff USDT",
      formula: "callContracts * MAX(expiryPrice - atmCallStrike, 0)",
      value: input.callPayoffUsdt
    },
    {
      cell: "Scenario PnL!C64",
      label: "Short ATM put payoff USDT",
      formula: "-putContracts * MAX(atmPutStrike - expiryPrice, 0)",
      value: input.shortPutPayoffUsdt
    },
    {
      cell: "Scenario PnL!C65",
      label: "Long floor put payoff USDT",
      formula: "putContracts * MAX(floorPutStrike - expiryPrice, 0)",
      value: input.floorPutPayoffUsdt
    },
    {
      cell: "Scenario PnL!C66",
      label: "Gross hedge payoff USDT",
      formula: "call payoff + short put payoff + floor put payoff",
      value: input.grossHedgePayoffUsdt
    },
    {
      cell: "Scenario PnL!C69",
      label: "Delivery fees USDT",
      formula: "Deribit delivery fee cap on exercised options",
      value: input.deliveryFeesUsdt
    },
    {
      cell: "Scenario PnL!C69:C66",
      label: "Net hedge payoff USDT",
      formula: "gross hedge payoff - delivery fees",
      value: input.netHedgePayoffUsdt
    },
    {
      cell: "Robust Model!B36",
      label: "Net inception option cash",
      formula: "netOptionCashBTC * BTC_USDC spot mid",
      value: input.netOptionCashUsdt
    },
    {
      cell: "Scenario PnL!C72",
      label: "Issuer PnL USDT",
      formula: "notional + net option cash + hedge payoff - delivery fees - client payout",
      value: input.issuerPnlUsdt
    },
    {
      cell: "Scenario PnL!C73",
      label: "Annualized firm P&L",
      formula: "issuerPnlUSDT / notional / dayCount * 365",
      value: input.annualizedFirmPnl
    }
  ];
}

function getScenarioLabel(
  expiryPrice: number,
  spotPrice: number,
  protection: number
): PppAdminScenarioResult["scenarioLabel"] {
  if (expiryPrice > spotPrice) return "Upside participation";
  if (spotPrice > 0 && expiryPrice / spotPrice <= protection) return "Principal floor";
  return "Below spot";
}

function deliveryFeeUsdt(optionType: "call" | "put", expiryPrice: number, strike: number, contracts: number): number {
  if (expiryPrice <= 0 || contracts <= 0) return 0;
  const intrinsicBtc =
    optionType === "call"
      ? Math.max(expiryPrice - strike, 0) / expiryPrice
      : Math.max(strike - expiryPrice, 0) / expiryPrice;
  return Math.min(DELIVERY_FEE_CAP_BTC, FEE_CAP_RATIO * intrinsicBtc) * contracts * expiryPrice;
}

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function roundUpToStep(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
