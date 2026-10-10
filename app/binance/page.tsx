import Link from "next/link";
import { Brand } from "@/app/brand";
import { SiteNav, Jump, SiteFooter } from "@/app/site-nav";
import { loadBalances, binanceFindings, loadQuotes, summariseQuotes, valueCheck } from "@/src/binance-data";

export const metadata = { title: "What Binance's API reports | Recordholder" };

// balance comes back in whole tokens and rawBalance as an integer in smallest units (1e-18),
// so they are only comparable after conversion
const wholeTokens = (v: string | null): number | null =>
  v === null ? null : /^\d+$/.test(v) && v.length > 12 ? Number(v) / 1e18 : Number(v);

const fmt = (v: string | null, places = 4) =>
  v === null ? "none" : Number(v).toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });

export default function BinancePage() {
  const cap = loadBalances();
  const f = binanceFindings();
  if (!cap || !f) return null;
  const value = valueCheck(cap, f);
  const quotesRaw = loadQuotes();
  const qs = quotesRaw ? summariseQuotes(quotesRaw) : null;

  const close = (a: number | null, b: number) => a !== null && Math.abs(a - b) <= 1e-6 * Math.max(Math.abs(b), 1e-12);
  const allRaw = cap.rows.every(
    (r) => close(wholeTokens(r.apiBalance), Number(r.chainRaw)) && close(wholeTokens(r.apiRawBalance), Number(r.chainRaw))
  );
  const unlisted = cap.rows.filter((r) => !f.ratioByAddress.has(r.address.toLowerCase())).map((r) => r.symbol);

  return (
    <main className="sheet">
      <header className="masthead">
        <div>
          <h1 className="wordmark">
            <Brand />
          </h1>
          <p className="subtitle">What Binance&rsquo;s own API reports</p>
        </div>
        <div className="label">
          Captured {cap.capturedAt}
          <br />
          BNB Chain, chain id 56
        </div>
      </header>

      <SiteNav current="binance" />
      <Jump
        items={[
          { id: "holdings", label: "Holdings" },
          { id: "disagree", label: "Disagreements" },
          { id: "issuers", label: "Other issuers" },
          { id: "cost-holder", label: "Cost to a holder" },
          { id: "cost-trade", label: "Cost to trade" },
          { id: "unknown", label: "Not established" },
        ]}
      />

      <p className="thesis">
        Binance publishes a Web3 API for the tokens it issues. Asked what an account holds, it returns
        the raw token amount, which leaves out the multiplier. The multiplier is available from the
        same API, in a different endpoint, and nothing joins the two.
      </p>

      <section className="section" id="holdings">
        <h2>The same holdings, two answers</h2>
        <p className="lede">
          {cap.accountLabel || "One account"} (<span className="addr">{cap.account}</span>) was read
          through <span className="num">{cap.endpoint}</span>, then compared with the chain. The API
          returned {cap.tokensReturned} tokens across {cap.pages} pages in{" "}
          {(cap.elapsedMs / 1000).toFixed(1)} seconds. Only securities whose multiplier has moved are
          shown, since those are the only ones where the two answers can differ.
        </p>
        <div className="scroller">
          <table className="ledger">
            <thead>
              <tr>
                <th>Security</th>
                <th>Ticker</th>
                <th className="r">API: balance</th>
                <th className="r">Shares owned</th>
                <th className="r">Binance&rsquo;s ratio</th>
              </tr>
            </thead>
            <tbody>
              {cap.rows.map((r) => (
                <tr key={r.address}>
                  <td>{r.underlying}</td>
                  <td className="sym">{r.symbol}</td>
                  <td className="r quiet">{fmt(r.apiBalance, 4)}</td>
                  <td className="r">{fmt(r.chainShares, 4)}</td>
                  <td className="r">
                    {f.ratioByAddress.get(r.address.toLowerCase()) ? (
                      Number(f.ratioByAddress.get(r.address.toLowerCase())).toFixed(6)
                    ) : (
                      <span className="quiet">not listed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="callout flag">
          <p>
            {allRaw ? `In all ${cap.rows.length} rows` : "In these rows"}, both fields describe the raw token
            amount: <span className="num">balance</span> in whole tokens and{" "}
            <span className="num">rawBalance</span> as an integer in smallest units. Each equals the chain&rsquo;s
            raw balance, and neither is the number of shares the account owns.
          </p>
          <p>
            The correct figure is in Binance&rsquo;s API. Its token list publishes{" "}
            <span className="num">tokenToShareRatio</span>, and it equals the multiplier on chain for{" "}
            {f.ratioMatches} of {f.ratioCompared} securities it lists. Multiplying the balance by that
            ratio gives the shares owned. Nothing in either response says the balance needs that.
          </p>
        </div>
      </section>

      <section className="section" id="disagree">
        <h2>Where the API disagrees with itself</h2>
        <div className="scroller">
          <table className="ledger">
            <tbody>
              <tr>
                <td>bStocks on this chain, according to the platform summary</td>
                <td className="r">91</td>
              </tr>
              <tr>
                <td>bStocks returned by the token list for the same platform and chain</td>
                <td className="r flag">{f.bstockListed}</td>
              </tr>
              <tr>
                <td>Ondo tokens, platform summary against token list</td>
                <td className="r flag">458 against {f.ondoListed}</td>
              </tr>
              {unlisted.length > 0 && (
                <tr>
                  <td>
                    Held tokens the balances endpoint returns but the token list omits:{" "}
                    <span className="num">{unlisted.join(", ")}</span>
                  </td>
                  <td className="r flag">{unlisted.length}</td>
                </tr>
              )}
              <tr>
                <td>
                  Securities where <span className="num">tokenPrice</span> equals{" "}
                  <span className="num">referencePrice × tokenToShareRatio</span> exactly
                </td>
                <td className="r">
                  {f.priceIdentity} of {f.priceCompared}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="lede" style={{ marginTop: "1rem" }}>
          The last row means the API publishes two prices for one security that differ by exactly the
          multiplier: a per-share price that pairs with a share count, and a per-token price that pairs
          with a raw balance. Pairing them the wrong way round is the error this record exists to
          expose, and the response does not say which pairs with which. Neither the platform summary
          nor the token list shows which count is complete. Our own verified catalogue holds 83 bStocks
          and contains all {f.bstockListed} that the token list returns.
        </p>
      </section>

      <section className="section" id="issuers">
        <h2>The other issuers, and market hours</h2>
        <div className="scroller">
          <table className="ledger">
            <tbody>
              <tr>
                <td>Issuers served by the RWA API</td>
                <td className="r">Ondo, bStocks</td>
              </tr>
              <tr>
                <td>xStocks</td>
                <td className="r flag">not served</td>
              </tr>
              <tr>
                <td>
                  Ondo tokens that reported support for the scaled-amount interface, out of{" "}
                  {f.ondoListed} probed on chain
                </td>
                <td className="r">0</td>
              </tr>
              <tr>
                <td>
                  bStocks reporting <span className="num">openState</span> true, on a Saturday
                </td>
                <td className="r">
                  {f.bstockOpen} of {f.bstockListed}
                </td>
              </tr>
              <tr>
                <td>bStocks carrying a market status or next open time</td>
                <td className="r">{f.bstockWithStatus}</td>
              </tr>
              <tr>
                <td>Ondo market status</td>
                <td className="r">{f.ondoStatus.map(([k, v]) => `${k} ${v}`).join(", ")}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="lede" style={{ marginTop: "1rem" }}>
          Ondo&rsquo;s tokens do not use this mechanism as far as these probes can tell, so how Ondo
          adjusts for corporate actions was not determined here. A function under a different name
          would not have been found.
        </p>
      </section>

      <section className="section" id="cost-holder">
        <h2>What it does and does not cost a holder</h2>
        <p className="lede">
          Each balance row also carries a <span className="num">tokenPrice</span>. Compared with the
          issuer&rsquo;s per-share price multiplied by its ratio, it matches exactly for {value.perToken} of{" "}
          {value.compared} rows, and the worst row is off by {value.worstPpm.toFixed(0)} parts per million.
          So the price is per token, and raw balance times that price gives the correct dollar value.
        </p>
        <div className="callout">
          <p>
            <strong>The dollar value is right. The share count is not.</strong> A holder sees the
            correct total but a share count that omits every dividend reinvestment, and anything computed
            from that count inherits the error: shares held, dividend per share, position size against a
            benchmark.
          </p>
        </div>
      </section>

      {qs && (
        <section className="section" id="cost-trade">
          <h2>What it costs to trade them</h2>
          <p className="lede">
            Prices requested from Binance&rsquo;s aggregator for buying with USDT at five order sizes. Quotes
            only: nothing was signed, built or submitted. Each took a median of {qs.medianMs} ms (range{" "}
            {qs.minMs} to {qs.maxMs}, {qs.quotes} quotes). Every quote returned exactly {qs.maxRoutesPerQuote}{" "}
            route, from {qs.vendors.join(", ")}.
          </p>
          <div className="scroller">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Ticker</th>
                  {qs.sizes.slice(1).map((sz) => (
                    <th key={sz} className="r">
                      Extra at ${sz.toLocaleString("en-US")}
                    </th>
                  ))}
                  <th className="r">Binance reports at ${qs.sizes[qs.sizes.length - 1]!.toLocaleString("en-US")}</th>
                </tr>
              </thead>
              <tbody>
                {qs.tokens.map((t) => (
                  <tr key={t.symbol}>
                    <td className="sym">{t.symbol}</td>
                    {qs.sizes.slice(1).map((sz) => (
                      <td key={sz} className={`r ${(t.extraBps[sz] ?? 0) > 100 ? "flag" : "quiet"}`}>
                        {t.extraBps[sz] === null ? "none" : `${t.extraBps[sz]! >= 0 ? "+" : ""}${t.extraBps[sz]!.toFixed(1)} bps`}
                      </td>
                    ))}
                    <td className="r">{t.reportedAtLargest === null ? "none" : `${Number(t.reportedAtLargest).toFixed(4)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lede" style={{ marginTop: "1rem" }}>
            Extra cost is the effective price against the ${qs.sizes[0]} order, in basis points of price, so it
            isolates what size alone adds. It is small for a liquid name and enormous for a thin one.
            The last column is the field Binance labels <span className="num">priceImpactPercent</span>,
            exactly as returned. It does not track the measured cost: where size alone adds more than 50%
            to the price, the field reports under 1%.
          </p>
          <div className="callout">
            <p>
              Captured {qs.capturedAt.slice(0, 10)}, a Saturday, while US markets were closed. These are
              quotes from a single venue on a weekend, not a general statement about liquidity, and the
              absence of any RFQ or PancakeSwap route was observed, not explained.
            </p>
          </div>
        </section>
      )}

      <section className="section" id="unknown">
        <h2>Not established</h2>
        <p className="lede">
          Why the platform summary and the token list disagree on how many tokens exist. Which price
          Venus&rsquo;s feed quotes. How Ondo adjusts for corporate actions. Why the aggregator returned
          one route per quote.
        </p>
      </section>

      <footer className="colophon">
        <p>
          Reproduce with <span className="num">npm run rwa</span> and{" "}
          <span className="num">npm run binance:balances -- &lt;address&gt;</span>. Both need a
          Binance developer key, and from some regions a VPN, since the API does not resolve without one.
          The balance capture dates from {cap.capturedAt}; the token list from {f.fetchedAt.slice(0, 10)}.
          The 91 and 458 counts come from the platform summary on that date.
        </p>
        <SiteFooter />
      </footer>
    </main>
  );
}
