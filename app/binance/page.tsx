import Link from "next/link";
import { Brand } from "@/app/brand";
import { loadBalances, binanceFindings } from "@/src/binance-data";

export const metadata = { title: "What Binance's API reports | Recordholder" };

const fmt = (v: string | null, places = 4) =>
  v === null ? "none" : Number(v).toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });

export default function BinancePage() {
  const cap = loadBalances();
  const f = binanceFindings();
  if (!cap || !f) return null;

  const allRaw = cap.rows.every((r) => r.apiBalance === r.apiRawBalance && r.apiBalance === Number(r.chainRaw).toFixed(6));
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

      <p className="thesis">
        Binance publishes a Web3 API for the tokens it issues. Asked what an account holds, it returns
        the raw token amount, which leaves out the multiplier. The multiplier is available from the
        same API, in a different endpoint, and nothing joins the two.
      </p>

      <section className="section">
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
                <th className="r">API: rawBalance</th>
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
                  <td className="r quiet">{fmt(r.apiRawBalance, 4)}</td>
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
            {allRaw ? `In all ${cap.rows.length} rows` : "In these rows"}, both fields report the raw token
            amount, so neither is the number of shares the account owns. The field named{" "}
            <span className="num">balance</span> is identical to <span className="num">rawBalance</span>.
          </p>
          <p>
            The correct figure is in Binance&rsquo;s API. Its token list publishes{" "}
            <span className="num">tokenToShareRatio</span>, and it equals the multiplier on chain for{" "}
            {f.ratioMatches} of {f.ratioCompared} securities it lists. Multiplying the balance by that
            ratio gives the shares owned. Nothing in either response says the balance needs that.
          </p>
        </div>
      </section>

      <section className="section">
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

      <section className="section">
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

      <section className="section">
        <h2>Not established</h2>
        <p className="lede">
          Each balance row also carries a <span className="num">tokenPrice</span>. In the rows checked
          against the token list, five match the per-token price exactly, none match the per-share
          price, and eleven match neither at a tight tolerance, so whether{" "}
          <span className="num">balance × tokenPrice</span> gives the right dollar value is supported
          for some tokens and not shown for all. The reason the two counts above differ was not found.
          Which price Venus&rsquo;s feed quotes was not settled either.
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
        <p>
          <Link href="/">Back to the record</Link> &nbsp;·&nbsp; <Link href="/exposure">Where these shares sit</Link>
        </p>
      </footer>
    </main>
  );
}
