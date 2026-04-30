import type { DcnCandidate, DcnScenarioResult, FormulaTraceRow } from "@/types";

export function getScenarioRange(candidate: DcnCandidate) {
  const min = roundToStep(candidate.strike * 0.6, 1000);
  const max = roundToStep(Math.max(candidate.strike * 1.55, candidate.spotPrice * 1.35), 1000);
  const defaultPrice = clamp(roundToStep(candidate.strike, 1000), min, max);
  return { min, max, step: 1000, defaultPrice };
}

export function calculateScenario(candidate: DcnCandidate, expiryPrice: number): DcnScenarioResult {
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
    side === "downside"
      ? -((candidate.strike - expiryPrice) / expiryPrice) * candidate.requiredContracts
      : 0;
  const netHedgeBtc =
    candidate.netOptionProceedsBtc === null ? null : candidate.netOptionProceedsBtc + optionSettlementBtc;
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

function buildScenarioTrace(
  side: "downside" | "upside",
  expiryPrice: number,
  optionSettlementBtc: number,
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

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
