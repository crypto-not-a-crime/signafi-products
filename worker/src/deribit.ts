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
  index_price?: number | null;
  min_price?: number | null;
  max_price?: number | null;
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

export interface DeribitMarginResult {
  buy: number;
  sell: number;
  min_price: number;
  max_price: number;
}

interface DeribitAuthResult {
  access_token: string;
  expires_in: number;
  token_type?: string;
  refresh_token?: string;
  scope?: string;
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
  private accessToken: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly baseUrl = "https://www.deribit.com/api/v2",
    private readonly proxyToken?: string,
    private readonly clientId?: string,
    private readonly clientSecret?: string
  ) {}

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

  async btcUsdcSpotTicker(): Promise<DeribitTicker> {
    return this.ticker("BTC_USDC");
  }

  async getOrderBook(instrumentName: string, depth = 100): Promise<DeribitOrderBook> {
    return this.rpc<DeribitOrderBook>("public/get_order_book", {
      instrument_name: instrumentName,
      depth
    });
  }

  async getMargins(instrumentName: string, amount: number, price: number): Promise<DeribitMarginResult> {
    return this.privateRpc<DeribitMarginResult>("private/get_margins", {
      instrument_name: instrumentName,
      amount,
      price
    });
  }

  private async privateRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const token = await this.getAccessToken();
    return this.rpc<T>(method, params, token);
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt - Date.now() > 30_000) {
      return this.accessToken.token;
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error("Deribit API credentials are not configured");
    }

    const auth = await this.rpc<DeribitAuthResult>("public/auth", {
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret
    });
    const expiresInMs = Math.max(0, auth.expires_in - 30) * 1000;
    this.accessToken = {
      token: auth.access_token,
      expiresAt: Date.now() + expiresInMs
    };
    return auth.access_token;
  }

  private async rpc<T>(method: string, params: Record<string, unknown>, deribitAccessToken?: string): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/`;
    let response: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      response = await fetch(url, {
        method: "POST",
        headers: this.headers(deribitAccessToken),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method,
          params
        })
      });

      if (response.ok || !isRetryableStatus(response.status) || attempt === 3) break;
      await sleep(500 * 2 ** attempt);
    }

    if (!response?.ok) {
      throw new Error(`Deribit ${method} failed with ${response?.status ?? "unknown"}`);
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

  private headers(deribitAccessToken?: string): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "SignafiMarketWorker/1.0"
    };

    if (this.proxyToken) {
      headers.authorization = `Bearer ${this.proxyToken}`;
      if (deribitAccessToken) headers["x-deribit-authorization"] = `Bearer ${deribitAccessToken}`;
    } else if (deribitAccessToken) {
      headers.authorization = `Bearer ${deribitAccessToken}`;
    }

    return headers;
  }
}

export function spotPriceFromTicker(ticker: DeribitTicker | null | undefined): number | null {
  const bid = finitePositive(ticker?.best_bid_price);
  const ask = finitePositive(ticker?.best_ask_price);
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  return (
    mid ??
    finitePositive(ticker?.mark_price) ??
    finitePositive(ticker?.last_price) ??
    finitePositive(ticker?.index_price) ??
    null
  );
}

function finitePositive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
