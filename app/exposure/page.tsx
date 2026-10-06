import Link from "next/link";
import { client } from "@/src/config";
import { loadSweep } from "@/src/snapshot";
import { readExposure, VENUS_PRICE_PATH_AUDIT } from "@/src/venues";
import { amount, shareAmount, bps, duration, buildOverview } from "@/src/view";

export const revalidate = 300;

export default async function Exposure() {
  const sweep = loadSweep();
  const overview = buildOverview();
  if (!sweep) return null;

  const medianNotice = overview?.notice?.median ?? null;
  const smallestStep = overview?.events.length
    ? Math.min(...overview.events.map((e) => e.stepBps))
    : null;

  const exposures = await readExposure(client, sweep.divergent);
  const audit = VENUS_PRICE_PATH_AUDIT;

  return (
    <main className="sheet">
      <header className="masthead">
        <div>
          <h1 className="wordmark">
            <Link href="/">Recordholder</Link>
          </h1>
          <p className="subtitle">Where the undisclosed shares sit</p>
        </div>
        <div className="label">
          Block {sweep.blockNumber.toString()}
        </div>
      </header>

      <section className="section">
        <h2>Lending protocols hold these securities as collateral</h2>
        <p className="lede">
          Both venues below take tokenized stocks as collateral. Because{" "}
          <span className="num">balanceOf</span> returns raw amounts, the collateral each one
          custodies is worth more shares than the figure its accounting reads.
        </p>
      </section>

      {exposures.map((e) => (
        <section className="section" key={e.venue.key}>
          <h2>{e.venue.name}</h2>
          <p className="lede">{e.venue.detail}</p>
          {e.holdings.length === 0 ? (
            <p className="lede">
              Holds none of the {sweep.divergent.length} securities whose multiplier has moved.
            </p>
          ) : (
            <div className="scroller">
              <table className="ledger">
                <caption>
                  {e.tokenCount} of {sweep.divergent.length} securities with a moved multiplier
                </caption>
                <thead>
                  <tr>
                    <th>Security</th>
                    <th>Ticker</th>
                    <th>Custodied by</th>
                    <th className="r">balanceOf reports</th>
                    <th className="r">Shares actually held</th>
                    <th className="r">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {e.holdings.map((h) => (
                    <tr key={`${h.holderLabel}-${h.token.address}`}>
                      <td>{h.token.underlying}</td>
                      <td className="sym">{h.token.symbol}</td>
                      <td className="sym quiet">{h.holderLabel}</td>
                      <td className="r quiet">{amount(h.raw, h.token.decimals, 4)}</td>
                      <td className="r">{amount(h.shares, h.token.decimals, 4)}</td>
                      <td className="r flag">{shareAmount(h.hidden, 6)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="lbl" colSpan={5}>
                      Shares held but not reported
                    </td>
                    <td className="r">{shareAmount(e.hiddenTotal, 6)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      ))}

      <section className="section">
        <h2>What was checked in Venus&rsquo;s price path</h2>
        <p className="lede">
          Collateral value is a balance multiplied by a price. The balance is raw by
          specification, so correctness depends on what the price is denominated in. These are the
          contracts in that path, searched for any reference to the multiplier.
        </p>
        <div className="scroller">
          <table className="ledger">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Address</th>
                <th className="r">Multiplier references</th>
              </tr>
            </thead>
            <tbody>
              {audit.contracts.map((c) => (
                <tr key={c.address}>
                  <td>{c.role}</td>
                  <td className="addr quiet">{c.address}</td>
                  <td className="r">0</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="lede" style={{ marginTop: "1rem" }}>
          Searched for {audit.selectorsSearched.join(", ")} across the deployed implementation
          bytecode behind each proxy. Zero occurrences in any of the three.
        </p>

        <div className="callout">
          <p>
            <strong>The claim, stated exactly.</strong> Nothing in Venus&rsquo;s on-chain price path
            reads the UI multiplier. Whether today&rsquo;s valuations are nonetheless correct depends
            on whether the off-chain publisher of the{" "}
            <span className="num">{audit.feedDescription}</span> feed quotes per share or per raw
            token. That is not determinable from chain data and is not asserted here.
          </p>
          <p>
            What follows regardless: correctness rests on an off-chain convention that nothing on
            chain enforces or can verify, while the multiplier moves at a scheduled second
            {medianNotice !== null ? ` with a median of ${duration(medianNotice)} notice` : ""} and
            the feed may be {duration(audit.stalenessToleranceSeconds)} stale. Those two clocks
            cannot be made atomic.
          </p>
        </div>

        <div className="callout">
          <p>
            <strong>And what is not yet at risk.</strong> Borrowing against these markets is
            disabled, with a borrow cap of {audit.borrowCap} and no outstanding debt, so no position
            can currently be liquidated on a stale valuation. The exposure is latent. It becomes live
            when caps are raised.
          </p>
          <p>
            Severity also scales with step size. The smallest action recorded so far moved a
            multiplier by {smallestStep !== null ? `${bps(smallestStep)} bps` : "a fraction of a basis point"},
            which is immaterial. A four-for-one split moves it by roughly 4x, and the same
            desynchronisation then misprices collateral by 4x rather than fractions of a percent.
          </p>
        </div>
      </section>

      <footer className="colophon">
        <p>
          Holdings read live. The audit of the price path was performed on {audit.checkedOn} by
          fetching implementation bytecode from behind each proxy and searching for the selectors
          named above; the addresses are listed so it can be repeated.
        </p>
        <p>
          Automated market makers are unaffected by this, and deliberately so: PancakeSwap prices a
          raw token against USDT, so the market price of a raw token already embeds the multiplier.
          The failure mode is specific to combining a raw balance with a per-share price, or showing
          a raw balance as a share count.
        </p>
        <p>
          <Link href="/">Back to the record</Link> &nbsp;·&nbsp;{" "}
          <Link href="/actions">Complete action record</Link>
        </p>
      </footer>
    </main>
  );
}
