import Link from "next/link";
import { Brand } from "@/app/brand";
import { SiteNav, Jump, SiteFooter } from "@/app/site-nav";
import { buildOverview, amount, bps, duration, utcDate, utcDateTime } from "@/src/view";

export const revalidate = 300;

export default function Actions() {
  const o = buildOverview();
  if (!o) return null;

  const byMonth = new Map<string, number>();
  for (const e of o.events) {
    const key = new Date(Number(e.effectiveAt) * 1000).toISOString().slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }

  return (
    <main className="sheet">
      <header className="masthead">
        <div>
          <h1 className="wordmark">
            <Brand />
          </h1>
          <p className="subtitle">Complete record of corporate actions</p>
        </div>
        <div className="label">
          {o.events.length} actions
          <br />
          to block {o.asOf.block.toString()}
        </div>
      </header>

      <SiteNav current="actions" />
      <Jump
        items={[
          { id: "all", label: "Every action" },
          { id: "cadence", label: "Cadence" },
          { id: "notice", label: "Notice against staleness" },
        ]}
      />

      <section className="section" id="all">
        <h2>Every recorded action</h2>
        <p className="lede">
          Each row is a dividend or distribution delivered by moving a security&rsquo;s UI
          multiplier. Notice is the gap between the block where{" "}
          <span className="num">newUIMultiplier()</span> first reported the incoming value and the
          block where <span className="num">uiMultiplier()</span> began returning it.
        </p>
        <div className="scroller">
          <table className="ledger">
            <thead>
              <tr>
                <th>Effective, UTC</th>
                <th>Security</th>
                <th>Ticker</th>
                <th className="r">Step, bps</th>
                <th className="r">Notice</th>
                <th className="r">Announced at block</th>
                <th className="r">Effective at block</th>
              </tr>
            </thead>
            <tbody>
              {o.events.map((e) => (
                <tr key={`${e.address}-${e.block}`}>
                  <td className="num" style={{ fontSize: "0.8125rem" }}>
                    {utcDateTime(e.effectiveAt)}
                  </td>
                  <td>{e.underlying}</td>
                  <td className="sym">{e.symbol}</td>
                  <td className="r">{bps(e.stepBps)}</td>
                  <td className={`r ${e.noticeSeconds !== null && e.noticeSeconds < 600 ? "flag" : "quiet"}`}>
                    {e.noticeSeconds === null ? "unknown" : duration(e.noticeSeconds)}
                  </td>
                  <td className="r quiet" style={{ fontSize: "0.8125rem" }}>
                    {e.scheduledAtBlock?.toString() ?? "—"}
                  </td>
                  <td className="r quiet" style={{ fontSize: "0.8125rem" }}>
                    {e.block.toString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" id="cadence">
        <h2>Cadence</h2>
        <p className="lede">
          Actions per calendar month, as the catalogue of listed securities grows.
        </p>
        <div className="scroller">
          <table className="ledger">
            <tbody>
              {[...byMonth.entries()].map(([month, count]) => (
                <tr key={month}>
                  <td className="num" style={{ width: "6rem" }}>
                    {month}
                  </td>
                  <td className="r" style={{ width: "3rem" }}>
                    {count}
                  </td>
                  <td aria-hidden style={{ letterSpacing: "0.1em" }}>
                    {"█".repeat(count)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {o.notice && (
        <section className="section" id="notice">
          <h2>Notice against oracle staleness</h2>
          <div className="scroller">
            <table className="ledger">
              <tbody>
                <tr>
                  <td>Shortest notice</td>
                  <td className="r flag">{duration(o.notice.min)}</td>
                </tr>
                <tr>
                  <td>Median notice</td>
                  <td className="r">{duration(o.notice.median)}</td>
                </tr>
                <tr>
                  <td>Longest notice</td>
                  <td className="r">{duration(o.notice.max)}</td>
                </tr>
                <tr>
                  <td>Staleness Venus tolerates on these securities</td>
                  <td className="r">{duration(o.oracleStalenessSeconds)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="callout flag">
            <p>
              All {o.notice.count} actions were announced with less warning than the price feed is
              permitted to be stale. BEP-677 places no lower bound on notice, and nothing in the
              standard encourages a longer one.
            </p>
          </div>
        </section>
      )}

      <footer className="colophon">
        {o.truncatedSymbols.length > 0 && (
          <p>
            {o.truncatedSymbols.join(", ")} already carried a multiplier above 1.0 at the earliest
            block observed. Earlier history falls outside the scan window, so it is recorded as
            unknown and no action is listed. The table therefore shows {o.events.length} actions, not{" "}
            {o.events.length + o.truncatedSymbols.length}.
          </p>
        )}
        <p>
          Reconstructed by locating each multiplier change through historical state. The events that
          record these changes are emitted correctly by every token, but no public BNB Chain endpoint
          tested would serve a log range wide enough to read them.
        </p>
        <SiteFooter />
      </footer>
    </main>
  );
}
