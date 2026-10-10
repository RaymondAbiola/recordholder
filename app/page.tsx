import Link from "next/link";
import { Brand } from "@/app/brand";
import { NoticeChart } from "@/app/notice-chart";
import { buildOverview, amount, bps, duration, utcDate, utcDateTime } from "@/src/view";

export const revalidate = 300;

export default function Home() {
  const o = buildOverview();

  if (!o) {
    return (
      <main className="sheet">
        <h1 className="wordmark">
            <Brand />
          </h1>
        <p className="lede">
          No snapshot present. Run <span className="num">npm run sweep</span> and{" "}
          <span className="num">npm run events</span>.
        </p>
      </main>
    );
  }

  const recent = o.events.slice(-6).reverse();

  return (
    <main className="sheet">
      <header className="masthead">
        <div>
          <h1 className="wordmark">
            <Brand />
          </h1>
          <p className="subtitle">
            Corporate action record for tokenized stocks on BNB Chain
          </p>
        </div>
        <div className="label">
          Block {o.asOf.block.toString()}
          <br />
          {utcDateTime(o.asOf.timestamp)} UTC
        </div>
      </header>

      <p className="thesis">
        bStocks, Binance&rsquo;s tokenized stocks on BNB Chain, pay out dividends by moving a hidden
        multiplier instead of sending anything.<sup className="fn">1</sup> The balance never changes,
        so no wallet, explorer or portfolio tracker ever shows it. Recordholder reconstructs what was
        paid, when, and how little notice anyone got.
      </p>

      <section className="figures">
        <div className="figure">
          <span className="label">Shares outside balanceOf</span>
          <span className="value flag num">{amount(o.hiddenShareCount, 18, 3)}</span>
          <span className="note">
            Owned by holders, reported by nothing. A count across {o.divergentCount} securities,
            not a value.<sup className="fn">2</sup>
          </span>
          {o.priced && (
            <span className="note" style={{ marginTop: "0.5rem" }}>
              At the issuer&rsquo;s last reference price, the {o.priced.pricedCount} securities it
              prices account for at least{" "}
              <span className="num">${Math.round(o.priced.value).toLocaleString("en-US")}</span> of
              it.<sup className="fn">3</sup>
            </span>
          )}
        </div>
        <div className="figure">
          <span className="label">Securities whose multiplier moved</span>
          <span className="value num">
            {o.divergentCount}
            <span style={{ color: "var(--muted)", fontSize: "0.5em" }}> / {o.tokenCount}</span>
          </span>
          <span className="note">
            Every one still reports a raw balance through <span className="num">balanceOf</span>,
            exactly as the standard requires.
          </span>
        </div>
        <div className="figure">
          <span className="label">Corporate actions recorded</span>
          <span className="value num">{o.events.length}</span>
          <span className="note">
            Dividends and distributions paid since July 2026, none of which moved a balance.
            {o.truncatedSymbols.length > 0 && <sup className="fn">4</sup>}
          </span>
        </div>
      </section>

      {o.example && (
        <section className="section">
          <h2>
            Worked example: {o.example.underlying}{" "}
            <span className="num" style={{ fontSize: "0.8em", color: "var(--muted)" }}>
              {o.example.symbol}
            </span>
          </h2>
          <p className="lede">
            The same token, read two ways. Every wallet and explorer shows the first line.
          </p>
          <div className="scroller">
            <table className="ledger">
              <tbody>
                <tr>
                  <td>
                    What <span className="num">balanceOf</span> and{" "}
                    <span className="num">totalSupply</span> report
                  </td>
                  <td className="r">{amount(o.example.rawSupply, o.example.decimals, 2)}</td>
                </tr>
                <tr>
                  <td>What holders actually own</td>
                  <td className="r">{amount(o.example.trueShares, o.example.decimals, 2)}</td>
                </tr>
                <tr>
                  <td>
                    Owned but not reported
                    {o.example.since !== null && (
                      <span style={{ color: "var(--muted)" }}>
                        {" "}
                        (multiplier {(Number(o.example.multiplier) / 1e18).toFixed(6)} since {utcDate(o.example.since)})
                      </span>
                    )}
                  </td>
                  <td className="r flag">{amount(o.example.hidden, o.example.decimals, 2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Look up an address</h2>
        <p className="lede">
          Any BNB Chain address. The record shows what it holds, what each corporate action paid
          it, and what its wallet is not telling it.
        </p>
        <form className="lookup" action="/lookup" method="get">
          <input
            name="address"
            placeholder="0x…"
            aria-label="BNB Chain address"
            spellCheck={false}
            autoComplete="off"
            required
          />
          <button type="submit">Open record</button>
        </form>
      </section>

      {o.notice && (
        <section className="section">
          <h2>How much warning integrators get</h2>
          <p className="lede">
            A multiplier change is announced on chain through{" "}
            <span className="num">newUIMultiplier()</span> before it takes effect. Measured across
            all {o.notice.count} actions, that warning is shorter than the window Venus permits its
            price feed for these same securities to be stale.
          </p>
          <NoticeChart events={o.events} stalenessSeconds={o.oracleStalenessSeconds} />
          <p className="lede" style={{ marginTop: "0.9rem", marginBottom: 0 }}>
            Shortest {duration(o.notice.min)}, median {duration(o.notice.median)}, longest{" "}
            {duration(o.notice.max)}.
          </p>
          <div className="callout flag">
            <p>
              All {o.notice.count} of {o.notice.count} corporate actions were announced with less
              warning than the oracle may be stale. The mechanism supports arbitrary lead time. In
              practice the issuer is using minutes.
            </p>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Securities holding undisclosed shares</h2>
        <p className="lede">
          Raw supply is what every balance call reports. True supply is what holders collectively
          own. The difference has been paid out and is not visible anywhere.
        </p>
        <div className="scroller">
          <table className="ledger">
            <thead>
              <tr>
                <th>Security</th>
                <th>Ticker</th>
                <th className="r">Multiplier, bps</th>
                <th className="r">Raw supply</th>
                <th className="r">True shares</th>
                <th className="r">Undisclosed</th>
              </tr>
            </thead>
            <tbody>
              {o.divergent.map((r) => (
                <tr key={r.address}>
                  <td>{r.underlying}</td>
                  <td className="sym">{r.symbol}</td>
                  <td className="r quiet">{bps(r.deviationBps)}</td>
                  <td className="r quiet">{amount(r.totalSupply, r.decimals, 2)}</td>
                  <td className="r">{amount(r.totalSupplyUI, r.decimals, 2)}</td>
                  <td className="r flag">{amount(r.hiddenSupply, r.decimals, 4)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="lbl" colSpan={5}>
                  Total shares outside reported balances
                </td>
                <td className="r">{amount(o.hiddenShareCount, 18, 4)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Most recent actions</h2>
        <p className="lede">
          The six latest of {o.events.length}. <Link href="/actions">See the complete record</Link>,
          with announcement blocks and notice periods for each.
        </p>
        <div className="scroller">
          <table className="ledger">
            <thead>
              <tr>
                <th>Effective</th>
                <th>Security</th>
                <th>Ticker</th>
                <th className="r">Step, bps</th>
                <th className="r">Notice</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => (
                <tr key={`${e.address}-${e.block}`}>
                  <td className="num" style={{ fontSize: "0.8125rem" }}>
                    {utcDate(e.effectiveAt)}
                  </td>
                  <td>{e.underlying}</td>
                  <td className="sym">{e.symbol}</td>
                  <td className="r">{bps(e.stepBps)}</td>
                  <td className="r quiet">
                    {e.noticeSeconds === null ? "unknown" : duration(e.noticeSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Where these shares sit</h2>
        <p className="lede">
          Venus and Lista both take these securities as lending collateral, valuing a raw balance
          against a price feed. <Link href="/exposure">What that means, and what was checked</Link>.
        </p>
        <p className="lede">
          Binance&rsquo;s own API returns the same raw balances.{" "}
          <Link href="/binance">What it reports, next to the chain</Link>.
        </p>
      </section>

      <footer className="colophon">
        <p>
          <sup className="fn">1</sup> Per bStocks documentation, net dividends are reinvested by
          raising the multiplier, and the step sizes recorded here are consistent with that. The
          chain itself records only that the multiplier moved, and individual steps were not matched
          against issuer announcements.
        </p>
        <p>
          <sup className="fn">2</sup> A share count, not a value. One undisclosed NVIDIA share and
          one undisclosed Nokia share are both one share and are not interchangeable.
        </p>
        {o.priced && (
          <p>
            <sup className="fn">3</sup> Per-share reference price published by Binance&rsquo;s RWA
            API, multiplied by the undisclosed shares of each security it prices (fetched{" "}
            {o.priced.fetchedAt.slice(0, 10)}). It is the value of the shares, not a loss: Binance&rsquo;s own dollar balances already include it, because its per-token price carries the multiplier. It is a last close, not a live quote.{" "}
            {o.priced.unpriced.length > 0 && (
              <>
                It does not price {o.priced.unpriced.length} of the {o.priced.divergentCount},
                including {o.priced.unpriced[0]?.symbol} (
                {Math.round(o.priced.unpriced[0]?.hiddenShares ?? 0).toLocaleString("en-US")}{" "}
                undisclosed shares), so the true total is higher.
              </>
            )}
          </p>
        )}
        {o.truncatedSymbols.length > 0 && (
          <p>
            <sup className="fn">4</sup> {o.truncatedSymbols.join(", ")} already carried a multiplier
            above 1.0 at the earliest block observed, so {o.truncatedSymbols.length === 1 ? "its" : "their"}{" "}
            earlier history is unknown rather than assumed, and no action is recorded for it.
          </p>
        )}
        <p>
          The catalogue holds the {o.tokenCount} bStocks that could be found and verified on chain.
          Binance&rsquo;s own RWA API advertises 91 on this chain but returns only 46 from its token
          list, so neither figure is a confirmed complete set.
        </p>
        <p>
          Machine readable: <a href="/api/events">the full record as JSON</a>, and{" "}
          <span className="num">/api/wallet/&lt;address&gt;</span> for any account, as JSON or with{" "}
          <span className="num">?format=csv</span>.
        </p>
        <p>
          Derived from BNB Chain state at block {o.asOf.block.toString()}. Under BEP-677 and
          ERC-8056, <span className="num">balanceOf</span> and{" "}
          <span className="num">totalSupply</span> return raw amounts by specification; shares owned
          are <span className="num">raw × uiMultiplier ÷ 1e18</span>. Every figure here is two
          contract calls from being checked independently.
        </p>
      </footer>
    </main>
  );
}
