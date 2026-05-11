export const DCN_SELL_PUT_TEMPLATE = {
  id: "dcn-sell-put-workbook-v1",
  version: "2026-05-11",
  label: "DCN Sell Put workbook template",
  sourceWorkbook: "DCN Calcs.xlsx",
  sourceSheets: ["Input Dashboard - Sell Put", "DCN - Sell Put", "Scenario Analysis - Sell Put"],
  defaultPricingMethod: "firm_margin",
  firmMarginBps: 200,
  sellPutTargetFirmProfitBps: 500,
  cells: {
    investmentUsdt: "C4",
    spotPrice: "C5",
    strike: "C7",
    clientYield: "C8",
    dayCount: "C11",
    contracts: "C14",
    effectivePutBidPrice: "C15",
    targetFirmAnnualizedProfit: "C18",
    grossReferenceYield: "C17",
    tradingFeesBtc: "C20",
    netOptionProceedsBtc: "C22",
    netOptionProceedsUsdt: "C23",
    downsideExpiryPrice: "C28",
    downsideOptionSettlementBtc: "C32",
    downsideNetHedgeBtc: "C33",
    downsideClientPayoutBtc: "C37",
    downsideBtcToPurchase: "C39",
    downsideFirmProfitUsdt: "C42",
    upsideExpiryPrice: "C59",
    upsideSellBtcProceedsUsdt: "C66",
    upsideClientPayoutUsdt: "C70",
    upsideFirmProfitUsdt: "C72"
  },
  formulas: {
    dayCount: "calendar expiry date - calendar today date (exclusive today, inclusive expiry date)",
    contracts: "ROUNDDOWN(C4/C7, 1)",
    grossReferenceYield: "effectivePutBidPrice / dayCount * 365",
    clientYield: "selected Put pricing method client yield formula",
    clientYieldFirmMargin: "ROUND(MAX(grossReferenceYield - firmMarginBps / 10000, 0) * 100, 1) / 100",
    clientYieldTargetFirmProfit:
      "NetPremiumUSDT/InitialInvestment*365/DayCount-TargetFirmAnnualizedProfit",
    clientPayoutBtc: "investmentUSDT / strike * (1 + clientYield * days / 365)",
    clientPayoutUsdt: "investmentUSDT * (1 + clientYield * days / 365)",
    downsideOptionSettlementBtc: "IF(expiryPrice < strike, -((strike - expiryPrice) / expiryPrice * contracts), 0)",
    downsideFirmProfitUsdt: "investmentUSDT - (clientPayoutBTC - netHedgeBTC) * expiryPrice",
    upsideFirmProfitUsdt: "investmentUSDT + netOptionProceedsBTC * expiryPrice - clientPayoutUSDT"
  }
} as const;

export const DCN_SELL_CALL_TEMPLATE = {
  id: "dcn-sell-call-workbook-v1",
  version: "2026-05-07",
  label: "DCN Sell Call workbook template",
  sourceWorkbook: "DCN Calcs.xlsx",
  sourceSheets: ["Input Dashboard - Sell Call", "DCN - Sell Call", "Scenario Analysis - Sell Call"],
  sellCallTargetFirmProfitBps: 500,
  upsideReferenceMultiplier: 1.3,
  cells: {
    investmentBtc: "C4",
    spotPrice: "C5",
    strikePct: "C6",
    strike: "C7",
    clientYield: "C8",
    startDate: "C9",
    endDate: "C10",
    dayCount: "C11",
    clientBtcPayout: "C12",
    targetFirmAnnualizedProfit: "C13",
    contracts: "C16",
    effectiveCallBidPrice: "C17",
    markPrice: "C18",
    grossReferenceYield: "C19",
    tradingFeePerOptionBtc: "C21",
    tradingFeesBtc: "C22",
    sellCallProceedsBtc: "C23",
    netCallProceedsBtc: "C24",
    netCallProceedsUsdt: "C25",
    downsideExpiryPrice: "C28",
    downsideProfitBtc: "C34",
    downsideProfitUsdt: "C35",
    downsideAnnualizedProfit: "C36",
    upsideExpiryPrice: "C55",
    upsideProfitUsdt: "C63",
    upsideAnnualizedProfit: "C64"
  },
  formulas: {
    dayCount: "C10-C9",
    contracts: "ROUNDDOWN(C4,1)",
    grossReferenceYield: "C17/C11*365",
    tradingFeePerOptionBtc: "-MIN(0.0003,0.125*C17)",
    tradingFeesBtc: "C21*C16",
    netCallProceedsBtc: "C16*C17+C22",
    netCallProceedsUsdt: "C24*C5",
    clientYield:
      "ROUNDDOWN(((PremiumUSDT+(InitialBTC-((UpsidePrice-Strike)/UpsidePrice*Contracts))*UpsidePrice-TargetFirmProfitUSDT)/(InitialBTC*Strike)-1)*365/DayCount,4)",
    clientBtcPayout: "InitialBTC*(1+ClientYield*DayCount/365)",
    clientUsdtPayout: "ClientBTCPayout*Strike",
    upsideOptionSettlementBtc: "IF(expiryPrice > strike, -((expiryPrice - strike) / expiryPrice * contracts), 0)"
  }
} as const;

export interface DcnTemplateSummary {
  id: string;
  version: string;
  label: string;
  sourceWorkbook: string;
  sourceSheets: string[];
  sellPutPricingMethod?: string;
  firmMarginBps?: number;
  sellPutTargetFirmProfitBps?: number;
  sellCallTargetFirmProfitBps?: number;
  upsideReferenceMultiplier?: number;
}

export function getDcnTemplateSummary(productType: "sell_put" | "sell_call" = "sell_put"): DcnTemplateSummary {
  if (productType === "sell_call") {
    return {
      id: DCN_SELL_CALL_TEMPLATE.id,
      version: DCN_SELL_CALL_TEMPLATE.version,
      label: DCN_SELL_CALL_TEMPLATE.label,
      sourceWorkbook: DCN_SELL_CALL_TEMPLATE.sourceWorkbook,
      sourceSheets: [...DCN_SELL_CALL_TEMPLATE.sourceSheets],
      sellCallTargetFirmProfitBps: DCN_SELL_CALL_TEMPLATE.sellCallTargetFirmProfitBps,
      upsideReferenceMultiplier: DCN_SELL_CALL_TEMPLATE.upsideReferenceMultiplier
    };
  }

  return {
    id: DCN_SELL_PUT_TEMPLATE.id,
    version: DCN_SELL_PUT_TEMPLATE.version,
    label: DCN_SELL_PUT_TEMPLATE.label,
    sourceWorkbook: DCN_SELL_PUT_TEMPLATE.sourceWorkbook,
    sourceSheets: [...DCN_SELL_PUT_TEMPLATE.sourceSheets],
    sellPutPricingMethod: DCN_SELL_PUT_TEMPLATE.defaultPricingMethod,
    firmMarginBps: DCN_SELL_PUT_TEMPLATE.firmMarginBps,
    sellPutTargetFirmProfitBps: DCN_SELL_PUT_TEMPLATE.sellPutTargetFirmProfitBps
  };
}
