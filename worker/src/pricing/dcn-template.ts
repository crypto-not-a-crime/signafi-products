export const DCN_SELL_PUT_TEMPLATE = {
  id: "dcn-sell-put-workbook-v1",
  version: "2026-04-30",
  label: "DCN Sell Put workbook template",
  sourceWorkbook: "SP_Sell_Put_Calc_with_Scenario_Analysis.xlsx",
  sourceSheets: ["Product 3 - Sell Put", "Scenario Analysis"],
  firmMarginBps: 200,
  cells: {
    investmentUsdt: "C4",
    spotPrice: "C5",
    strike: "C7",
    clientYield: "C8",
    dayCount: "C11",
    contracts: "C14",
    effectivePutBidPrice: "C15",
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
    grossReferenceYield: "effectivePutBidPrice / dayCount * 365",
    clientYield: "ROUND(MAX(grossReferenceYield - firmMarginBps / 10000, 0) * 100, 1) / 100",
    clientPayoutBtc: "investmentUSDT / strike * (1 + clientYield * days / 365)",
    clientPayoutUsdt: "investmentUSDT * (1 + clientYield * days / 365)",
    downsideOptionSettlementBtc: "IF(expiryPrice < strike, -((strike - expiryPrice) / expiryPrice * contracts), 0)",
    downsideFirmProfitUsdt: "investmentUSDT - (clientPayoutBTC - netHedgeBTC) * expiryPrice",
    upsideFirmProfitUsdt: "investmentUSDT + netOptionProceedsBTC * expiryPrice - clientPayoutUSDT"
  }
} as const;

export interface DcnTemplateSummary {
  id: typeof DCN_SELL_PUT_TEMPLATE.id;
  version: typeof DCN_SELL_PUT_TEMPLATE.version;
  label: typeof DCN_SELL_PUT_TEMPLATE.label;
  sourceWorkbook: typeof DCN_SELL_PUT_TEMPLATE.sourceWorkbook;
  sourceSheets: string[];
  firmMarginBps: number;
}

export function getDcnTemplateSummary(): DcnTemplateSummary {
  return {
    id: DCN_SELL_PUT_TEMPLATE.id,
    version: DCN_SELL_PUT_TEMPLATE.version,
    label: DCN_SELL_PUT_TEMPLATE.label,
    sourceWorkbook: DCN_SELL_PUT_TEMPLATE.sourceWorkbook,
    sourceSheets: [...DCN_SELL_PUT_TEMPLATE.sourceSheets],
    firmMarginBps: DCN_SELL_PUT_TEMPLATE.firmMarginBps
  };
}
