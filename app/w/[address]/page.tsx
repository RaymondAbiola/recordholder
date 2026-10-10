import Link from "next/link";
import { Brand } from "@/app/brand";
import { SiteNav, Jump, SiteFooter } from "@/app/site-nav";
import { notFound } from "next/navigation";
import { isAddress, getAddress, type Address } from "viem";
import { client, archiveClient } from "@/src/config";
import { loadEvents } from "@/src/snapshot";
import { walletReport } from "@/src/wallet";
import { amount, shareAmount, bps, utcDate } from "@/src/view";

export const revalidate = 300;

export default async function WalletRecord({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!isAddress(address)) notFound();

  const account = getAddress(address) as Address;
  const snapshot = loadEvents();
  if (!snapshot) notFound();

  const r = await walletReport(client, archiveClient, account, snapshot.events);
  const withHidden = r.positions.filter((p) => p.hidden > 0n).length;

  return (
    <main className="sheet">
      <header className="masthead">
        <div>
          <h1 className="wordmark">
            <Brand />
          </h1>
          <p className="subtitle">Statement of corporate actions</p>
        </div>
        <div className="label">
          Account
          <br />
          <span className="addr">{account}</span>
        </div>
      </header>

      <SiteNav current="none" />
      <form className="lookup" action="/lookup" method="get">
        <input
          name="address"
          placeholder="Look up another address, 0x…"
          aria-label="BNB Chain address"
          spellCheck={false}
          autoComplete="off"
          required
        />
        <button type="submit">Open record</button>
      </form>
      <Jump
        items={[
          { id: "actions", label: "Corporate actions" },
          { id: "holdings", label: "Holdings" },
        ]}
      />

      <section className="figures">
        <div className="figure">
          <span className="label">Shares this account is not shown</span>
          <span className="value flag num">{shareAmount(r.hiddenNow, 4)}</span>
          <span className="note">
            Held right now, across {withHidden}{" "}
            {withHidden === 1 ? "security" : "securities"}, absent from every balance.
          </span>
        </div>
        <div className="figure">
          <span className="label">Paid by corporate actions</span>
          <span className="value num">{shareAmount(r.sharesGainedTotal, 4)}</span>
          <span className="note">
            Credited across {r.held.length} of {snapshot.events.length} recorded actions, with no
            transaction of any kind.
          </span>
        </div>
        <div className="figure">
          <span className="label">Actions held through</span>
          <span className="value num">
            {r.held.length}
            <span style={{ color: "var(--muted)", fontSize: "0.5em" }}>
              {" "}
              / {snapshot.events.length}
            </span>
          </span>
          <span className="note">
            Counted whether or not the position is still open, because a closed position was still
            paid.
          </span>
        </div>
      </section>

      <section className="section" id="actions">
        <h2>Corporate actions</h2>
        {r.held.length === 0 ? (
          <p className="lede">
            This account held no tokenized stock at the moment any multiplier moved, so no corporate
            action has paid it.
          </p>
        ) : (
          <>
            <p className="lede">
              Each row is a dividend or distribution delivered by moving the security&rsquo;s UI
              multiplier. The raw balance did not change in any of them, which is why no wallet,
              explorer or portfolio tracker reported them.
            </p>
            <p className="lede">
              <a href={`/api/wallet/${account}?format=csv`}>Download as CSV</a>
              {" "}&nbsp;·&nbsp;{" "}
              <a href={`/api/wallet/${account}`}>JSON</a>. Quantities and dates only. Pricing each
              credit at its effective date is left to whoever prepares the return.
            </p>
            <div className="scroller">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Effective</th>
                    <th>Security</th>
                    <th>Ticker</th>
                    <th className="r">Step, bps</th>
                    <th className="r">Held at the time</th>
                    <th className="r">Paid to this account</th>
                    <th>Position</th>
                  </tr>
                </thead>
                <tbody>
                  {r.held.map((h) => (
                    <tr key={`${h.event.address}-${h.event.block}`}>
                      <td className="num" style={{ fontSize: "0.8125rem" }}>
                        {utcDate(h.event.effectiveAt)}
                      </td>
                      <td>{h.event.underlying}</td>
                      <td className="sym">{h.event.symbol}</td>
                      <td className="r quiet">{bps(h.event.stepBps)}</td>
                      <td className="r quiet">{amount(h.rawAtEvent, 18, 4)}</td>
                      <td className="r flag">{shareAmount(h.sharesGained)}</td>
                      <td className="quiet" style={{ fontSize: "0.8125rem" }}>
                        {h.stillHeld ? "still open" : "since closed"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="lbl" colSpan={5}>
                      Total shares credited, never reported
                    </td>
                    <td className="r">{shareAmount(r.sharesGainedTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="section" id="holdings">
        <h2>Holdings</h2>
        {r.positions.length === 0 ? (
          <p className="lede">This account holds no tokenized stocks today.</p>
        ) : (
          <>
            <p className="lede">
              What a balance call returns, against what is actually owned.
            </p>
            <div className="scroller">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Security</th>
                    <th>Ticker</th>
                    <th className="r">balanceOf reports</th>
                    <th className="r">Shares owned</th>
                    <th className="r">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {r.positions.map((p) => (
                    <tr key={p.token.address}>
                      <td>{p.token.underlying}</td>
                      <td className="sym">{p.token.symbol}</td>
                      <td className="r quiet">{amount(p.raw, p.token.decimals, 4)}</td>
                      <td className="r">{amount(p.shares, p.token.decimals, 4)}</td>
                      <td className={`r ${p.hidden > 0n ? "flag" : "quiet"}`}>
                        {shareAmount(p.hidden, 4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="lbl" colSpan={4}>
                      Total difference
                    </td>
                    <td className="r">{shareAmount(r.hiddenNow, 4)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>

      <footer className="colophon">
        <p>
          The two headline totals differ on purpose. Shares paid by corporate actions counts only
          what the account held at the moment of each action. Shares not shown applies to the
          balances held today, which can be larger or smaller than they were then.
        </p>
        <p>
          Reconstructed from BNB Chain state. Amounts paid are computed as the raw balance held one
          block before each multiplier took effect, multiplied by the change in that multiplier, and
          floored exactly as the contract floors its own conversions.
        </p>
        <p>
          A dividend under BEP-677 emits no event naming the holder.{" "}
          <span className="num">UIMultiplierUpdated</span> records that the multiplier moved but
          names nobody, and <span className="num">TransferWithUIAmount</span> only fires on
          transfers, so it never fires for a corporate action. This statement exists because that
          record does not.
        </p>
        <SiteFooter />
      </footer>
    </main>
  );
}
