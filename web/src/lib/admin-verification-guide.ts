import type { DcnCandidate, DcnScenarioResult, FormulaTraceRow, PppCandidate } from "@/types";
import { formatNumber, formatPct, formatUsd } from "@/lib/format";

export type VerificationStepStatus = "pass" | "warn" | "fail" | "info";

export interface VerificationStep {
  id: string;
  title: string;
  status: VerificationStepStatus;
  purpose: string;
  formulaText: string;
  outputLabel: string;
  outputValue: string;
  workbookRefs: string[];
  traceRows: FormulaTraceRow[];
  checkKeys: string[];
  dependsOn: string[];
}

const NOT_AVAILABLE = "Not available";

export function buildDcnVerificationGuide(
  audit: DcnCandidate,
  selectedScenario: DcnScenarioResult | null
): VerificationStep[] {
  const isSellCall = audit.productType === "sell_call";
  const traceRows = [...audit.formulaTrace, ...(selectedScenario?.formulaTrace ?? [])];
  const effectiveBid = audit.effectiveOptionBidPrice ?? audit.effectivePutBidPrice;
  const scenarioRefs =
    selectedScenario?.side === "downside"
      ? isSellCall
        ? ["C28", "C12", "C35"]
        : ["C28", "C32", "C33", "C37", "C39", "C42"]
      : isSellCall
        ? ["C55", "Call Settlement", "C60", "C63"]
        : ["C59", "C66", "C70", "C72"];

  if (isSellCall) {
    return [
      {
        id: "inputs",
        title: "BTC notional and terms",
        status: statusFromChecks(audit.checks, ["spotPricePositive", "strikePositive", "strikeAboveSpot"], [
          audit.investmentBtc,
          audit.spotPrice,
          audit.strike,
          audit.dayCount
        ]),
        purpose: "Confirm the workbook starts from the selected BTC notional, live BTC spot, call strike, and day count.",
        formulaText: `${fmtNumber(audit.investmentBtc, 6)} BTC * ${fmtUsd(audit.spotPrice, 2)} spot = ${fmtUsd(
          audit.investmentUsdt,
          2
        )} notional; strike ${fmtUsd(audit.strike, 2)} over ${fmtNumber(audit.dayCount, 0)} days.`,
        outputLabel: "Notional",
        outputValue: fmtUsd(audit.investmentUsdt, 2),
        workbookRefs: ["C4", "C5", "C7", "C11"],
        traceRows: selectTraceRows(traceRows, ["C4", "C5", "C7", "C11"]),
        checkKeys: ["spotPricePositive", "strikePositive", "strikeAboveSpot"],
        dependsOn: []
      },
      {
        id: "depth",
        title: "Contracts and executable bid",
        status: statusFromChecks(audit.checks, ["usableBid", "sufficientDepth", "slippageWithinLimit"], [
          audit.requiredContracts,
          effectiveBid
        ]),
        purpose: "Check that the required call contracts can be sold into available bid depth at the displayed average price.",
        formulaText: `${fmtNumber(audit.requiredContracts, 1)} contracts sold into depth; average bid = weighted filled premium / required contracts = ${fmtNumber(
          effectiveBid,
          5
        )}.`,
        outputLabel: "Average executable bid",
        outputValue: fmtNumber(effectiveBid, 5),
        workbookRefs: ["C16", "C17"],
        traceRows: selectTraceRows(traceRows, ["C16", "C17"]),
        checkKeys: ["usableBid", "sufficientDepth", "slippageWithinLimit"],
        dependsOn: ["inputs"]
      },
      {
        id: "net-premium",
        title: "Fees and net call proceeds",
        status: statusFromChecks(audit.checks, [], [audit.tradingFeesBtc, audit.netOptionProceedsBtc, audit.netOptionProceedsUsdt]),
        purpose: "Verify that trading fees are deducted before the premium is converted to USDT.",
        formulaText: `Net premium = contracts * bid + fees = ${fmtNumber(audit.netOptionProceedsBtc, 6)} BTC; USDT value = net premium * spot = ${fmtUsd(
          audit.netOptionProceedsUsdt,
          2
        )}.`,
        outputLabel: "Net call proceeds",
        outputValue: fmtUsd(audit.netOptionProceedsUsdt, 2),
        workbookRefs: ["C19", "C22", "C24", "C25"],
        traceRows: selectTraceRows(traceRows, ["C19", "C22", "C24", "C25"]),
        checkKeys: [],
        dependsOn: ["depth"]
      },
      {
        id: "client-yield",
        title: "Target profit and client yield",
        status: statusFromChecks(audit.checks, ["clientYieldFormulaValid", "clientYieldPositive", "targetFirmProfitNonNegative"], [
          audit.clientYield
        ]),
        purpose: "Confirm the client yield is the workbook result after reserving the target firm profit at the upside reference price.",
        formulaText: `Client yield solves the upside reference case ${fmtUsd(
          audit.upsideReferencePrice,
          2
        )} after reserving ${fmtPct((audit.sellCallTargetFirmProfitBps ?? 0) / 10000, 2)} annualized firm profit.`,
        outputLabel: "Client yield",
        outputValue: fmtPct(audit.clientYield, 2),
        workbookRefs: ["C13", "Scenario Analysis - Sell Call!D27", "Input Dashboard - Sell Call!C9"],
        traceRows: selectTraceRows(traceRows, ["C13", "Scenario Analysis - Sell Call!D27", "Input Dashboard - Sell Call!C9"]),
        checkKeys: ["clientYieldFormulaValid", "clientYieldPositive", "targetFirmProfitNonNegative"],
        dependsOn: ["net-premium"]
      },
      buildDcnScenarioStep(traceRows, selectedScenario, scenarioRefs, "client-yield"),
      buildFinalGateStep(traceRows, audit.checks, audit.eligible, ["inputs", "depth", "net-premium", "client-yield", "scenario"])
    ];
  }

  const firmMarginMode = audit.sellPutPricingMethod !== "target_firm_profit";
  const yieldRefs = firmMarginMode
    ? ["Put Pricing Method", "Signafi Margin", "Client Yield", "Premium Check"]
    : ["Put Pricing Method", "Input Dashboard - Sell Put!C15", "Input Dashboard - Sell Put!C9", "Premium Check"];

  return [
    {
      id: "inputs",
      title: "USDT notional and terms",
      status: statusFromChecks(audit.checks, ["spotPricePositive", "strikePositive", "strikeBelowSpot"], [
        audit.investmentUsdt,
        audit.spotPrice,
        audit.strike,
        audit.dayCount
      ]),
      purpose: "Confirm the workbook starts from the selected USDT notional, live BTC spot, put strike, and day count.",
      formulaText: `Notional ${fmtUsd(audit.investmentUsdt, 2)}; spot ${fmtUsd(audit.spotPrice, 2)}; strike ${fmtUsd(
        audit.strike,
        2
      )}; tenor ${fmtNumber(audit.dayCount, 0)} days.`,
      outputLabel: "Notional",
      outputValue: fmtUsd(audit.investmentUsdt, 2),
      workbookRefs: ["C4", "C5", "C7", "C11"],
      traceRows: selectTraceRows(traceRows, ["C4", "C5", "C7", "C11"]),
      checkKeys: ["spotPricePositive", "strikePositive", "strikeBelowSpot"],
      dependsOn: []
    },
    {
      id: "depth",
      title: "Contracts and executable bid",
      status: statusFromChecks(audit.checks, ["usableBid", "sufficientDepth", "slippageWithinLimit"], [
        audit.requiredContracts,
        effectiveBid
      ]),
      purpose: "Check that the required put contracts can be sold into available bid depth at the displayed average price.",
      formulaText: `${fmtNumber(audit.requiredContracts, 1)} contracts sold into depth; average bid = weighted filled premium / required contracts = ${fmtNumber(
        effectiveBid,
        5
      )}.`,
      outputLabel: "Average executable bid",
      outputValue: fmtNumber(effectiveBid, 5),
      workbookRefs: ["C14", "C15"],
      traceRows: selectTraceRows(traceRows, ["C14", "C15"]),
      checkKeys: ["usableBid", "sufficientDepth", "slippageWithinLimit"],
      dependsOn: ["inputs"]
    },
    {
      id: "net-premium",
      title: "Fees and net put proceeds",
      status: statusFromChecks(audit.checks, [], [audit.tradingFeesBtc, audit.netOptionProceedsBtc, audit.netOptionProceedsUsdt]),
      purpose: "Verify that trading fees are deducted before the premium is converted to USDT.",
      formulaText: `Net premium = contracts * bid + fees = ${fmtNumber(audit.netOptionProceedsBtc, 6)} BTC; USDT value = net premium * spot = ${fmtUsd(
        audit.netOptionProceedsUsdt,
        2
      )}.`,
      outputLabel: "Net put proceeds",
      outputValue: fmtUsd(audit.netOptionProceedsUsdt, 2),
      workbookRefs: ["C17", "C20", "C22", "C23"],
      traceRows: selectTraceRows(traceRows, ["C17", "C20", "C22", "C23"]),
      checkKeys: [],
      dependsOn: ["depth"]
    },
    {
      id: "client-yield",
      title: "Pricing basis and client yield",
      status: statusFromChecks(
        audit.checks,
        firmMarginMode
          ? ["firmMarginPositive", "premiumCoversInterest", "clientYieldFormulaValid", "clientYieldPositive"]
          : ["targetFirmProfitNonNegative", "clientYieldFormulaValid", "clientYieldPositive"],
        [audit.clientYield]
      ),
      purpose: "Confirm the client yield follows the active sell-put pricing basis saved in admin.",
      formulaText: firmMarginMode
        ? `Client yield = workbook-rounded max(${fmtPct(audit.grossReferenceYield, 2)} gross reference yield - ${fmtPct(
            audit.firmMarginBps / 10000,
            2
          )} firm margin, 0).`
        : `Client yield = net premium / notional * 365 / days - ${fmtPct(
            (audit.sellPutTargetFirmProfitBps ?? 0) / 10000,
            2
          )} target firm profit.`,
      outputLabel: "Client yield",
      outputValue: fmtPct(audit.clientYield, 2),
      workbookRefs: yieldRefs,
      traceRows: selectTraceRows(traceRows, yieldRefs),
      checkKeys: firmMarginMode
        ? ["firmMarginPositive", "premiumCoversInterest", "clientYieldFormulaValid", "clientYieldPositive"]
        : ["targetFirmProfitNonNegative", "clientYieldFormulaValid", "clientYieldPositive"],
      dependsOn: ["net-premium"]
    },
    buildDcnScenarioStep(traceRows, selectedScenario, scenarioRefs, "client-yield"),
    buildFinalGateStep(traceRows, audit.checks, audit.eligible, ["inputs", "depth", "net-premium", "client-yield", "scenario"])
  ];
}

export function buildPppVerificationGuide(audit: PppCandidate): VerificationStep[] {
  const callLeg = audit.legs.find((leg) => leg.role === "long_call");
  const putLeg = audit.legs.find((leg) => leg.role === "short_put");
  const floorPutLeg = audit.legs.find((leg) => leg.role === "long_floor_put");

  return [
    {
      id: "terms",
      title: "Product terms",
      status: statusFromChecks(audit.checks, ["spotValid", "expiryValid"], [
        audit.investmentUsdt,
        audit.spotPrice,
        audit.protectionLevel,
        audit.dayCount
      ]),
      purpose: "Confirm the PPP starts from the selected notional, spot, protection, participation, target margin, and delivery-fee setting.",
      formulaText: `Notional ${fmtUsd(audit.investmentUsdt, 2)}; spot ${fmtUsd(audit.spotPrice, 2)}; floor ${fmtPct(
        audit.protectionLevel,
        2
      )}; quoted participation ${fmtPct(audit.quotedParticipation, 2)}; target margin ${fmtPct(
        audit.targetFirmMarginBps / 10000,
        2
      )}; participation rounding ${
        audit.participationRoundDownBps > 0 ? fmtPct(audit.participationRoundDownBps / 10000, 1) : "off"
      }; ${fmtNumber(audit.dayCount, 0)} days.`,
      outputLabel: "Target profit",
      outputValue: fmtUsd(audit.targetProfitUsdt, 2),
      workbookRefs: [
        "Robust Model!B4",
        "Robust Model!B5",
        "Robust Model!B7",
        "Robust Model!B8",
        "pricing_config.ppp_participation_round_down_bps",
        "Robust Model!B9",
        "Robust Model!B10",
        "Robust Model!B12"
      ],
      traceRows: selectTraceRows(audit.formulaTrace, [
        "Robust Model!B4",
        "Robust Model!B5",
        "Robust Model!B7",
        "Robust Model!B8",
        "pricing_config.ppp_participation_round_down_bps",
        "Robust Model!B9",
        "Robust Model!B10",
        "Robust Model!B12"
      ]),
      checkKeys: ["spotValid", "expiryValid"],
      dependsOn: []
    },
    {
      id: "hedge-prices",
      title: "Hedge strikes and prices",
      status: statusFromChecks(audit.checks, ["quoteFresh", "sufficientDepth", "slippageWithinLimit"], [
        callLeg?.averagePrice,
        putLeg?.averagePrice,
        floorPutLeg?.averagePrice
      ]),
      purpose: "Check that each hedge leg uses the intended strike and a depth-weighted executable option price.",
      formulaText: `Buy ATM call ${fmtUsd(callLeg?.strike, 2)} at ${fmtNumber(
        callLeg?.averagePrice,
        5
      )}; sell ATM put ${fmtUsd(putLeg?.strike, 2)} at ${fmtNumber(putLeg?.averagePrice, 5)}; buy floor put ${fmtUsd(
        floorPutLeg?.strike,
        2
      )} at ${fmtNumber(floorPutLeg?.averagePrice, 5)}.`,
      outputLabel: "Max leg slippage",
      outputValue: fmtPct(audit.maxSlippagePct, 3),
      workbookRefs: [
        "Robust Model!F4",
        "Robust Model!F5",
        "Robust Model!F6",
        "Robust Model!F7",
        "Robust Model!F8",
        "Robust Model!F9"
      ],
      traceRows: selectTraceRows(audit.formulaTrace, [
        "Robust Model!F4",
        "Robust Model!F5",
        "Robust Model!F6",
        "Robust Model!F7",
        "Robust Model!F8",
        "Robust Model!F9"
      ]),
      checkKeys: ["quoteFresh", "sufficientDepth", "slippageWithinLimit"],
      dependsOn: ["terms"]
    },
    {
      id: "hedge-sizing",
      title: "Contracts, participation, and floor",
      status: statusFromChecks(
        audit.checks,
        ["participationPositive", "floorAtOrAboveProtection", "callHedgeAtOrAboveParticipation"],
        [audit.putSpreadContracts, audit.optimalCallContracts, audit.quotedParticipation, audit.putSpreadImpliedFloor]
      ),
      purpose: "Confirm contract rounding still supports the quoted client participation and protection floor.",
      formulaText: `Put-spread contracts ${fmtNumber(audit.putSpreadContracts, 1)}; call contracts ${fmtNumber(
        audit.optimalCallContracts,
        1
      )}; quoted participation ${fmtPct(audit.quotedParticipation, 2)}; implied floor ${fmtPct(audit.putSpreadImpliedFloor, 2)}.`,
      outputLabel: audit.recommendedLever === "protection" ? "Quoted protection" : "Quoted participation",
      outputValue:
        audit.recommendedLever === "protection" ? fmtPct(audit.quotedProtection, 2) : fmtPct(audit.quotedParticipation, 2),
      workbookRefs: [
        "Robust Model!B19",
        "Robust Model!B20",
        "Robust Model!B21",
        "Robust Model!B23",
        "Robust Model!B24",
        "Robust Model!B25",
        "Robust Model!B43",
        "Robust Model!B44"
      ],
      traceRows: selectTraceRows(audit.formulaTrace, [
        "Robust Model!B19",
        "Robust Model!B20",
        "Robust Model!B21",
        "Robust Model!B23",
        "Robust Model!B24",
        "Robust Model!B25",
        "Robust Model!B43",
        "Robust Model!B44"
      ]),
      checkKeys: ["participationPositive", "floorAtOrAboveProtection", "callHedgeAtOrAboveParticipation"],
      dependsOn: ["hedge-prices"]
    },
    {
      id: "net-cash",
      title: "Fees and net inception cash",
      status: statusFromChecks(audit.checks, [], [audit.netOptionCashBtc, audit.netOptionCashUsdt]),
      purpose: "Verify that call cost, put-spread credit, and trading fees produce the displayed net inception option cash.",
      formulaText: `Net cash = put spread credit - call cost - trading fees = ${fmtNumber(
        audit.netOptionCashBtc,
        6
      )} BTC, or ${fmtUsd(audit.netOptionCashUsdt, 2)}.`,
      outputLabel: "Net option cash",
      outputValue: fmtUsd(audit.netOptionCashUsdt, 2),
      workbookRefs: [
        "Robust Model!B30",
        "Robust Model!B31",
        "Robust Model!B32",
        "Robust Model!B33",
        "Robust Model!B34",
        "Robust Model!B35",
        "Robust Model!B36"
      ],
      traceRows: selectTraceRows(audit.formulaTrace, [
        "Robust Model!B30",
        "Robust Model!B31",
        "Robust Model!B32",
        "Robust Model!B33",
        "Robust Model!B34",
        "Robust Model!B35",
        "Robust Model!B36"
      ]),
      checkKeys: [],
      dependsOn: ["hedge-sizing"]
    },
    {
      id: "optimizer",
      title: "Optimizer and stress result",
      status: statusFromChecks(audit.checks, ["targetProfitMet"], [audit.minScenarioPnlUsdt, audit.stressPrice]),
      purpose: "Confirm the selected hedge package meets the target profit in the lowest-P&L scenario.",
      formulaText: `Minimum issuer P&L ${fmtUsd(audit.minScenarioPnlUsdt, 2)} at BTC ${fmtUsd(
        audit.stressPrice,
        2
      )}; target profit ${fmtUsd(audit.targetProfitUsdt, 2)}.`,
      outputLabel: "Minimum P&L",
      outputValue: fmtUsd(audit.minScenarioPnlUsdt, 2),
      workbookRefs: ["Robust Model!B38", "Robust Model!B39", "Robust Model!B45", "Robust Model!B46"],
      traceRows: selectTraceRows(audit.formulaTrace, [
        "Robust Model!B38",
        "Robust Model!B39",
        "Robust Model!B45",
        "Robust Model!B46"
      ]),
      checkKeys: ["targetProfitMet"],
      dependsOn: ["net-cash"]
    },
    buildFinalGateStep(audit.formulaTrace, audit.checks, audit.eligible, [
      "terms",
      "hedge-prices",
      "hedge-sizing",
      "net-cash",
      "optimizer"
    ])
  ];
}

function buildDcnScenarioStep(
  traceRows: FormulaTraceRow[],
  selectedScenario: DcnScenarioResult | null,
  workbookRefs: string[],
  dependsOn: string
): VerificationStep {
  const payout =
    selectedScenario?.clientPayoutAsset === "BTC"
      ? `${fmtNumber(selectedScenario.clientPayoutAmount, 6)} BTC`
      : fmtUsd(selectedScenario?.clientPayoutAmount, 2);
  const side = selectedScenario?.side === "downside" ? "downside" : "upside";

  return {
    id: "scenario",
    title: "Scenario payout and firm P&L",
    status: scenarioStatus(selectedScenario),
    purpose: "Check the selected expiry-price scenario links client payout, option settlement, and firm P&L.",
    formulaText: `At expiry ${fmtUsd(selectedScenario?.expiryPrice, 2)}, the ${side} case pays the client ${payout}; firm P&L = ${fmtUsd(
      selectedScenario?.firmProfitUsdt,
      2
    )}.`,
    outputLabel: "Firm P&L",
    outputValue: fmtUsd(selectedScenario?.firmProfitUsdt, 2),
    workbookRefs: ["Selected Scenario", "Selected Payout", ...workbookRefs],
    traceRows: selectTraceRows(traceRows, ["Selected Scenario", "Selected Payout", ...workbookRefs]),
    checkKeys: ["selectedScenarioProfitPositive"],
    dependsOn: [dependsOn]
  };
}

function buildFinalGateStep(
  traceRows: FormulaTraceRow[],
  checks: Record<string, boolean>,
  eligible: boolean,
  dependsOn: string[]
): VerificationStep {
  const checkKeys = Object.keys(checks);

  return {
    id: "final-gates",
    title: "Final gates",
    status: eligible ? "pass" : "fail",
    purpose: "Confirm the audit only passes when market freshness, depth, slippage, yield, and profit checks are all passing.",
    formulaText: `Eligibility = all reported checks pass. Passing checks: ${checkKeys.filter((key) => checks[key]).length} / ${checkKeys.length}.`,
    outputLabel: "Audit result",
    outputValue: eligible ? "Eligible" : "Review required",
    workbookRefs: ["Pass/fail checks"],
    traceRows: selectTraceRows(traceRows, ["Premium Check", "Robust Model!B39"]),
    checkKeys,
    dependsOn
  };
}

function statusFromChecks(
  checks: Record<string, boolean>,
  checkKeys: string[],
  requiredValues: unknown[]
): VerificationStepStatus {
  if (checkKeys.some((key) => checks[key] === false)) return "fail";
  if (requiredValues.some(isUnavailable)) return "warn";
  if (checkKeys.length > 0 || requiredValues.length > 0) return "pass";
  return "info";
}

function scenarioStatus(selectedScenario: DcnScenarioResult | null): VerificationStepStatus {
  if (!selectedScenario || isUnavailable(selectedScenario.firmProfitUsdt)) return "warn";
  return (selectedScenario.firmProfitUsdt ?? 0) > 0 ? "pass" : "fail";
}

function selectTraceRows(traceRows: FormulaTraceRow[], workbookRefs: string[]): FormulaTraceRow[] {
  const refs = new Set(workbookRefs);
  return traceRows.filter((row) => refs.has(row.cell));
}

function isUnavailable(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && (!Number.isFinite(value) || Number.isNaN(value)))
  );
}

function fmtUsd(value: number | null | undefined, digits = 0): string {
  return isUnavailable(value) ? NOT_AVAILABLE : formatUsd(value, digits);
}

function fmtPct(value: number | null | undefined, digits = 2): string {
  return isUnavailable(value) ? NOT_AVAILABLE : formatPct(value, digits);
}

function fmtNumber(value: number | null | undefined, digits = 2): string {
  return isUnavailable(value) ? NOT_AVAILABLE : formatNumber(value, digits);
}
