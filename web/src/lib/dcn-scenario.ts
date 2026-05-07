import type { DcnCandidate, DcnScenarioResult, FormulaTraceRow } from "@/types";

interface ScenarioRangeOptions {
  min?: number;
  max?: number;
  step?: number;
}

export function getScenarioRange(candidate: DcnCandidate, options: ScenarioRangeOptions = {}) {
  const step = options.step ?? 1000;
  const min = options.min ?? roundToStep(candidate.strike * 0.6, step);
  const max = options.max ?? roundToStep(Math.max(candidate.strike * 1.55, candidate.spotPrice * 1.35), step);
  const defaultPrice = clamp(roundToStep(candidate.strike, step), min, max);
  return { min, max, step, defaultPrice };
}

export function calculateScenario(candidate: DcnCandidate, expiryPrice: number): DcnScenarioResult {
  if (candidate.productType === "sell_call") {
    return calculateCallScenario(candidate, expiryPrice);
  }

  const side = expiryPrice < candidate.strike ? "downside" : "upside";
  const clientPrincipalInterestUsdt =
    candidate.clientYield === null
      ? null
      : candidate.investmentUsdt * (1 + candidate.clientYield * (candidate.dayCount / 365));
  const clientPrincipalInterestBtc =
    candidate.clientYield === null
      ? null
      : (candidate.investmentUsdt / candidate.strike) * (1 + candidate.clientYield * (candidate.dayCount / 365));
  const clientPayoutBtc = side === "downside" ? clientPrincipalInterestBtc : null;
  const clientPayoutUsdt = side === "upside" ? clientPrincipalInterestUsdt : null;
  const clientPayoutAsset = side === "downside" ? "BTC" : "USDT";
  const clientPayoutAmount = side === "downside" ? clientPayoutBtc : clientPayoutUsdt;
  const optionSettlementBtc =
    side === "downside" && expiryPrice > 0
      ? -((candidate.strike - expiryPrice) / expiryPrice) * candidate.requiredContracts
      : side === "downside"
        ? null
        : 0;
  const netHedgeBtc =
    candidate.netOptionProceedsBtc === null || optionSettlementBtc === null
      ? null
      : candidate.netOptionProceedsBtc + optionSettlementBtc;
  const btcToPurchase =
    side === "downside" && netHedgeBtc !== null && clientPrincipalInterestBtc !== null
      ? clientPrincipalInterestBtc - netHedgeBtc
      : null;
  const sellBtcProceedsUsdt =
    side === "upside" && candidate.netOptionProceedsBtc !== null
      ? candidate.netOptionProceedsBtc * expiryPrice
      : null;
  const firmProfitUsdt =
    side === "downside"
      ? btcToPurchase === null
        ? null
        : candidate.investmentUsdt - btcToPurchase * expiryPrice
      : sellBtcProceedsUsdt === null || clientPrincipalInterestUsdt === null
        ? null
        : candidate.investmentUsdt + sellBtcProceedsUsdt - clientPrincipalInterestUsdt;
  const annualizedFirmProfit =
    firmProfitUsdt === null ? null : (firmProfitUsdt / candidate.investmentUsdt / candidate.dayCount) * 365;
  const formulaTrace = buildScenarioTrace(
    side,
    expiryPrice,
    optionSettlementBtc,
    netHedgeBtc,
    clientPayoutBtc,
    clientPayoutUsdt,
    btcToPurchase,
    sellBtcProceedsUsdt,
    firmProfitUsdt
  );

  return {
    expiryPrice,
    side,
    clientPayoutAsset,
    clientPayoutAmount,
    clientPayoutBtc,
    clientPayoutUsdt,
    clientPrincipalInterestBtc,
    clientPrincipalInterestUsdt,
    optionSettlementBtc,
    netHedgeBtc,
    btcToPurchase,
    sellBtcProceedsUsdt,
    firmProfitUsdt,
    annualizedFirmProfit,
    formulaTrace
  };
}

function calculateCallScenario(candidate: DcnCandidate, expiryPrice: number): DcnScenarioResult {
  const side = expiryPrice > candidate.strike ? "upside" : "downside";
  const investmentBtc =
    typeof candidate.investmentBtc === "number" && Number.isFinite(candidate.investmentBtc)
      ? candidate.investmentBtc
      : candidate.spotPrice > 0
        ? candidate.investmentUsdt / candidate.spotPrice
        : 0;
  const investmentNotionalUsdt = candidate.spotPrice > 0 ? investmentBtc * candidate.spotPrice : candidate.investmentUsdt;
  const clientPrincipalInterestBtc =
    candidate.clientYield === null
      ? null
      : investmentBtc * (1 + candidate.clientYield * (candidate.dayCount / 365));
  const clientPrincipalInterestUsdt =
    clientPrincipalInterestBtc === null ? null : clientPrincipalInterestBtc * candidate.strike;
  const clientPayoutBtc = side === "downside" ? clientPrincipalInterestBtc : null;
  const clientPayoutUsdt = side === "upside" ? clientPrincipalInterestUsdt : null;
  const clientPayoutAsset = side === "downside" ? "BTC" : "USDT";
  const clientPayoutAmount = side === "downside" ? clientPayoutBtc : clientPayoutUsdt;
  const optionSettlementBtc =
    side === "upside" && expiryPrice > 0
      ? -((expiryPrice - candidate.strike) / expiryPrice) * candidate.requiredContracts
      : 0;
  const netHedgeBtc =
    candidate.netOptionProceedsBtc === null
      ? null
      : investmentBtc + candidate.netOptionProceedsBtc + optionSettlementBtc;
  const sellBtcProceedsUsdt =
    side === "upside" && netHedgeBtc !== null ? (investmentBtc + optionSettlementBtc) * expiryPrice : null;
  const firmProfitUsdt =
    netHedgeBtc === null || clientPrincipalInterestBtc === null || clientPrincipalInterestUsdt === null
      ? null
      : side === "downside"
        ? (candidate.netOptionProceedsBtc ?? 0) * candidate.spotPrice +
          (investmentBtc - clientPrincipalInterestBtc) * expiryPrice
        : (candidate.netOptionProceedsBtc ?? 0) * candidate.spotPrice +
          (investmentBtc + optionSettlementBtc) * expiryPrice -
          clientPrincipalInterestUsdt;
  const annualizedFirmProfit =
    firmProfitUsdt === null || investmentNotionalUsdt <= 0
      ? null
      : (firmProfitUsdt / investmentNotionalUsdt / candidate.dayCount) * 365;
  const formulaTrace = buildCallScenarioTrace(side, expiryPrice, optionSettlementBtc, clientPayoutBtc, clientPayoutUsdt, firmProfitUsdt);

  return {
    expiryPrice,
    side,
    clientPayoutAsset,
    clientPayoutAmount,
    clientPayoutBtc,
    clientPayoutUsdt,
    clientPrincipalInterestBtc,
    clientPrincipalInterestUsdt,
    optionSettlementBtc,
    netHedgeBtc,
    btcToPurchase: null,
    sellBtcProceedsUsdt,
    firmProfitUsdt,
    annualizedFirmProfit,
    formulaTrace
  };
}

function buildScenarioTrace(
  side: "downside" | "upside",
  expiryPrice: number,
  optionSettlementBtc: number | null,
  netHedgeBtc: number | null,
  clientPayoutBtc: number | null,
  clientPayoutUsdt: number | null,
  btcToPurchase: number | null,
  sellBtcProceedsUsdt: number | null,
  firmProfitUsdt: number | null
): FormulaTraceRow[] {
  if (side === "downside") {
    return [
      { cell: "C28", label: "Final BTC level", formula: "scenario expiry price", value: expiryPrice },
      {
        cell: "C32",
        label: "Option settlement BTC",
        formula: "IF(expiryPrice < strike, -((strike - expiryPrice) / expiryPrice * contracts), 0)",
        value: optionSettlementBtc
      },
      { cell: "C33", label: "Net hedge BTC", formula: "netOptionProceedsBTC + optionSettlementBTC", value: netHedgeBtc },
      {
        cell: "C37",
        label: "Client payout BTC",
        formula: "investmentUSDT / strike * (1 + clientYield * days / 365)",
        value: clientPayoutBtc
      },
      { cell: "C39", label: "BTC to purchase", formula: "clientPayoutBTC - netHedgeBTC", value: btcToPurchase },
      {
        cell: "C42",
        label: "Downside firm profit USDT",
        formula: "investmentUSDT - btcToPurchase * expiryPrice",
        value: firmProfitUsdt
      }
    ];
  }

  return [
    { cell: "C59", label: "Final BTC level", formula: "scenario expiry price", value: expiryPrice },
    {
      cell: "C66",
      label: "Sell BTC proceeds USDT",
      formula: "netOptionProceedsBTC * expiryPrice",
      value: sellBtcProceedsUsdt
    },
    {
      cell: "C70",
      label: "Client payout USDT",
      formula: "investmentUSDT * (1 + clientYield * days / 365)",
      value: clientPayoutUsdt
    },
    {
      cell: "C72",
      label: "Upside firm profit USDT",
      formula: "investmentUSDT + sellBTCProceedsUSDT - clientPayoutUSDT",
      value: firmProfitUsdt
    }
  ];
}

function buildCallScenarioTrace(
  side: "downside" | "upside",
  expiryPrice: number,
  optionSettlementBtc: number | null,
  clientPayoutBtc: number | null,
  clientPayoutUsdt: number | null,
  firmProfitUsdt: number | null
): FormulaTraceRow[] {
  if (side === "downside") {
    return [
      { cell: "C28", label: "Final BTC level", formula: "scenario expiry price", value: expiryPrice },
      {
        cell: "C12",
        label: "Client payout BTC",
        formula: "initialBTC * (1 + clientYield * days / 365)",
        value: clientPayoutBtc
      },
      {
        cell: "C35",
        label: "Downside firm profit USDT",
        formula: "netPremiumUSDT + (initialBTC - clientPayoutBTC) * expiryPrice",
        value: firmProfitUsdt
      }
    ];
  }

  return [
    { cell: "C55", label: "Final BTC level", formula: "scenario expiry price", value: expiryPrice },
    {
      cell: "Call Settlement",
      label: "Option settlement BTC",
      formula: "IF(expiryPrice > strike, -((expiryPrice - strike) / expiryPrice * contracts), 0)",
      value: optionSettlementBtc
    },
    {
      cell: "C60",
      label: "Client payout USDT",
      formula: "clientPayoutBTC * strike",
      value: clientPayoutUsdt
    },
    {
      cell: "C63",
      label: "Upside firm profit USDT",
      formula: "netPremiumUSDT + (initialBTC - callSettlementBTC) * expiryPrice - clientPayoutUSDT",
      value: firmProfitUsdt
    }
  ];
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
