import type { BidAskLevel } from "./pricing/dcn";

export interface DeribitInstrument {
  instrument_name: string;
  instrument_id?: number;
  kind: string;
  base_currency: string;
  quote_currency: string;
  settlement_currency?: string;
  option_type?: "call" | "put";
  strike?: number;
  expiration_timestamp?: number;
  creation_timestamp?: number;
  contract_size?: number;
  min_trade_amount?: number;
  tick_size?: number;
  state?: string;
  is_active?: boolean;
}

export interface DeribitBookSummary {
  instrument_name: string;
  bid_price?: number | null;
  ask_price?: number | null;
  mid_price?: number | null;
  mark_price?: number | null;
  last?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  open_interest?: number | null;
  creation_timestamp?: number;
  underlying_price?: number | null;
  underlying_index?: string;
  interest_rate?: number | null;
  mark_iv?: number | null;
  price_change?: number | null;
}

export interface DeribitTicker {
  instrument_name: string;
  timestamp: number;
  state?: string;
  best_bid_price?: number | null;
  best_bid_amount?: number | null;
  best_ask_price?: number | null;
  best_ask_amount?: number | null;
  mark_price?: number | null;
  last_price?: number | null;
  open_interest?: number | null;
  underlying_price?: number | null;
  underlying_index?: string;
  interest_rate?: number | null;
  bid_iv?: number | null;
  ask_iv?: number | null;
  mark_iv?: number | null;
  greeks?: {
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    rho?: number;
  };
}

export interface DeribitOrderBook extends DeribitTicker {
  change_id?: number;
  bids: BidAskLevel[];
  asks: BidAskLevel[];
  index_price?: number;
  min_price?: number;
  max_price?: number;
}

interface DeribitRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

export class DeribitClient {
  constructor(private readonly baseUrl = "https://www.deribit.com/api/v2") {}

  async getInstruments(currency = "BTC"): Promise<DeribitInstrument[]> {
    return this.rpc<DeribitInstrument[]>("public/get_instruments", {
      currency,
      kind: "option",
      expired: false
    });
  }

  async getBookSummaryByCurrency(currency = "BTC"): Promise<DeribitBookSummary[]> {
    return this.rpc<DeribitBookSummary[]>("public/get_book_summary_by_currency", {
      currency,
      kind: "option"
    });
  }

  async ticker(instrumentName: string): Promise<DeribitTicker> {
    return this.rpc<DeribitTicker>("public/ticker", {
      instrument_name: instrumentName
    });
  }

  async getOrderBook(instrumentName: string, depth = 100): Promise<DeribitOrderBook> {
    return this.rpc<DeribitOrderBook>("public/get_order_book", {
      instrument_name: instrumentName,
      depth
    });
  }

  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/${method}?${new URLSearchParams(flattenParams(params)).toString()}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Deribit ${method} failed with ${response.status}`);
    }

    const payload = (await response.json()) as DeribitRpcResponse<T>;
    if (payload.error) {
      throw new Error(`Deribit ${method} error ${payload.error.code}: ${payload.error.message}`);
    }
    if (payload.result === undefined) {
      throw new Error(`Deribit ${method} returned no result`);
    }
    return payload.result;
  }
}

function flattenParams(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    out[key] = String(value);
  }
  return out;
}
