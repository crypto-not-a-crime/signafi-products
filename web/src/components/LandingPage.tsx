"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUsd } from "@/lib/format";
import { SiteNav } from "./Logo";

const menus = {
  defensive: {
    label: "Defensive",
    blended: 0.085,
    loss: 0.0024,
    desc: "Protect what you have. Earn a steady monthly yield with lower risk, using stable base strategies and carefully selected option income.",
    cards: [
      ["Appetizer", "Stable base", "UMINT and contango yield", 0.6, "3-6% p.a."],
      ["Main Course", "Income engine", "USDT put selling and BTC covered calls", 0.4, "8-12% p.a."],
      ["Dessert", "Diversifying layer", "Tokenised real-world assets", 0, "varies"]
    ]
  },
  offensive: {
    label: "Offensive",
    blended: 0.155,
    loss: 0.0375,
    desc: "Grow what you have. Higher target yield, more market exposure, and more bespoke structured product opportunities.",
    cards: [
      ["Appetizer", "Stable foundation", "UMINT and contango yield", 0.3, "3-6% p.a."],
      ["Main Course", "Growth engine", "Put selling, covered calls, principal protection", 0.55, "12-20% p.a."],
      ["Dessert", "Maximum upside layer", "Bespoke structured products", 0.15, "up to 40%"]
    ]
  }
} as const;

export function LandingPage() {
  const [amount, setAmount] = useState(500000);
  const [mode, setMode] = useState<keyof typeof menus>("defensive");
  const menu = menus[mode];
  const summary = useMemo(() => {
    const annual = amount * menu.blended;
    return {
      annual,
      monthly: annual / 12,
      loss: amount * menu.loss
    };
  }, [amount, menu]);

  return (
    <>
      <SiteNav active="home" />
      <main>
        <section className="hero">
          <div className="hero-left">
            <div className="hero-tag">Now live - Yield Platform</div>
            <h1>
              Your crypto.
              <br />
              <em>Earning for you.</em>
              <br />
              Every month.
            </h1>
            <p className="hero-sub">
              Transfer BTC or USDT to Signafi once. Choose your risk appetite. We run institutional-grade strategies on
              your behalf, and you receive a regular monthly yield.
            </p>
            <div className="hero-steps">
              {["Transfer", "Choose", "Earn monthly", "We handle it"].map((step, index) => (
                <div className="hero-step" key={step}>
                  <span className="hero-step-num">{index + 1}</span>
                  <strong>{step}</strong>
                </div>
              ))}
            </div>
            <div className="hero-btns">
              <a className="btn-primary" href="#menu">
                See your yield
              </a>
              <Link className="btn-ghost" href="/DCN-put">
                Open DCN Put
              </Link>
            </div>
          </div>

          <div className="hero-right">
            <div className="hero-card">
              <div className="hero-card-header">
                <div className="hero-card-title">Portfolio live view</div>
                <span className="status-badge status-live">Active</span>
              </div>
              <div className="yield-display">
                <div className="yield-label">Monthly yield credited</div>
                <div className="yield-number">{formatUsd(summary.monthly)}</div>
                <div className="small-muted">
                  on {formatUsd(amount)} - {menu.label} menu
                </div>
              </div>
              <div className="mini-buckets">
                <div className="mini-bucket">
                  <span className="mini-name">Stable base</span>
                  <span className="mini-val green">{formatUsd(amount * 0.045 / 12)}</span>
                </div>
                <div className="mini-bucket">
                  <span className="mini-name">Option income</span>
                  <span className="mini-val">{formatUsd(amount * 0.1 / 12)}</span>
                </div>
                <div className="mini-bucket">
                  <span className="mini-name">Structured upside</span>
                  <span className="mini-val purple">{formatUsd(amount * 0.06 / 12)}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-tag">How it works</div>
          <h2 className="section-title">
            Simple as ordering
            <br />
            from a menu.
          </h2>
          <p className="section-sub">
            We have taken institutional-grade crypto strategies and made them as simple as a restaurant menu:
            appetizer, main course, and dessert.
          </p>
          <div className="how-grid">
            {[
              ["STEP 01", "Transfer your crypto", "Send BTC or USDT to your segregated wallet."],
              ["STEP 02", "Choose your menu", "Pick Defensive or Offensive based on your appetite."],
              ["STEP 03", "We run the strategy", "Our team executes options, futures, and structured products."],
              ["STEP 04", "You receive yield", "Regular yield is credited to your account."]
            ].map(([num, title, copy]) => (
              <div className="how-card" key={num}>
                <div className="how-num">{num}</div>
                <div className="how-title">{title}</div>
                <p className="how-desc">{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section menu-section" id="menu">
          <div className="section-tag">The Yield Menu</div>
          <h2 className="section-title">Choose your appetite.</h2>
          <p className="section-sub">{menu.desc}</p>
          <div className="menu-toggle">
            <button className={`menu-btn ${mode === "defensive" ? "active" : ""}`} onClick={() => setMode("defensive")}>
              Menu D - Defensive
            </button>
            <button className={`menu-btn ${mode === "offensive" ? "active" : ""}`} onClick={() => setMode("offensive")}>
              Menu O - Offensive
            </button>
          </div>

          <div className="amount-row">
            <strong>How much would you like to start with?</strong>
            <input
              type="range"
              min={100000}
              max={2000000}
              step={50000}
              value={amount}
              onChange={(event) => setAmount(Number(event.target.value))}
            />
            <strong className="mono">{formatUsd(amount)}</strong>
          </div>

          <div className="summary-row">
            <div className="sum-card">
              <div className="sum-lbl">Monthly yield</div>
              <div className="sum-val green">{formatUsd(summary.monthly)}</div>
              <div className="small-muted">indicative</div>
            </div>
            <div className="sum-card">
              <div className="sum-lbl">Annual return</div>
              <div className="sum-val">{formatUsd(summary.annual)}</div>
              <div className="small-muted">{(menu.blended * 100).toFixed(1)}% blended</div>
            </div>
            <div className="sum-card">
              <div className="sum-lbl">Worst-case annual loss</div>
              <div className="sum-val red">{formatUsd(summary.loss)}</div>
              <div className="small-muted">modelled risk guardrail</div>
            </div>
          </div>

          <div className="menu-grid">
            {menu.cards.map(([course, title, poweredBy, balance, yieldLabel]) => (
              <div className="menu-card" key={course}>
                <div className="how-num">{course}</div>
                <strong>{title}</strong>
                <p className="card-copy">Powered by: {poweredBy}</p>
                <span className="pill">{yieldLabel}</span>
                {Number(balance) > 0 ? (
                  <p className="small-muted">
                    {Math.round(Number(balance) * 100)}% allocation - {formatUsd(amount * Number(balance))}
                  </p>
                ) : (
                  <p className="small-muted">add-on layer</p>
                )}
              </div>
            ))}
          </div>

          <div className="explorer-band" id="products">
            <div className="section-tag">Product Explorer</div>
            <h2 className="section-title">Depth-aware DCN pricing is live in the DCN Put and Call pages.</h2>
            <p className="section-sub">
              The DCN sell-put flow uses Deribit option data, depth-weighted bid modelling, Signafi margin, and issuer
              profit checks before showing a proposed client yield.
            </p>
            <Link className="btn-light" href="/DCN-put">
              Explore live DCN pricing
            </Link>
          </div>
        </section>

        <section className="section">
          <div className="section-tag">Behind the menu</div>
          <h2 className="section-title">What Signafi runs on your behalf.</h2>
          <div className="product-grid">
            {[
              ["PRODUCT 01", "UMINT - Digital Cash Account", "Tokenised money-market style yield."],
              ["PRODUCT 02", "Contango Yield", "Market-neutral futures basis income."],
              ["PRODUCT 03", "USDT Put Selling", "Earn yield while agreeing to buy BTC lower."],
              ["PRODUCT 04", "BTC Covered Call", "Earn BTC yield while agreeing to sell higher."],
              ["PRODUCT 05", "Principal Protection + Upside", "Defined downside with BTC-linked upside."],
              ["PRODUCT 06", "DigiFT Tokens", "Tokenised real-world asset diversification."]
            ].map(([num, title, copy]) => (
              <div className="product-card" key={num}>
                <div className="product-num">{num}</div>
                <div className="product-name">{title}</div>
                <p className="product-desc">{copy}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="footer">
        <span>Signafi - Bridging traditional and digital markets</span>
        <span>Indicative only. Capital at risk.</span>
      </footer>
    </>
  );
}
