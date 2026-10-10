import { duration } from "@/src/view";
import type { MultiplierEvent } from "@/src/events";

// Plain markup and CSS, no chart library. One bar per corporate action, scaled against the
// staleness window Venus tolerates, so the claim is visible without reading a number.
const AXIS_MAX_SECONDS = 4200;
const TICKS = [0, 15, 30, 45, 60];

export function NoticeChart({
  events,
  stalenessSeconds,
}: {
  events: MultiplierEvent[];
  stalenessSeconds: number;
}) {
  const rows = events
    .filter((e) => e.noticeSeconds !== null)
    .sort((a, b) => Number(a.effectiveAt - b.effectiveAt));
  const ref = (stalenessSeconds / AXIS_MAX_SECONDS) * 100;
  const longest = Math.max(...rows.map((r) => r.noticeSeconds!));

  return (
    <div
      className="chart"
      style={{ ["--ref" as string]: `${ref}%` }}
      role="img"
      aria-label={`Notice given for each of ${rows.length} corporate actions. The longest was ${duration(longest)}. Every one is shorter than the ${duration(stalenessSeconds)} of price staleness Venus tolerates.`}
    >
      <div className="chead">
        <span />
        <span className="ctrack">
          <span className="cref">Venus tolerates {duration(stalenessSeconds)} stale</span>
        </span>
      </div>

      {rows.map((e) => {
        const secs = e.noticeSeconds!;
        const pct = (secs / AXIS_MAX_SECONDS) * 100;
        const d = new Date(Number(e.effectiveAt) * 1000).toISOString().slice(5, 10);
        return (
          <div className="crow" key={`${e.address}-${e.block}`}>
            <span className="clabel">
              <span className="cdate">{d}</span>
              <span className="csym">{e.symbol}</span>
            </span>
            <span className="ctrack">
              <span className="cbar" style={{ width: `${pct}%` }} />
              <span className="cval" style={{ left: `calc(${pct}% + 0.4rem)` }}>
                {duration(secs)}
              </span>
            </span>
          </div>
        );
      })}

      <div className="chead caxis">
        <span />
        <span className="ctrack">
          {TICKS.map((m) => (
            <span key={m} className="ctick" style={{ left: `${((m * 60) / AXIS_MAX_SECONDS) * 100}%` }}>
              {m === 0 ? "0" : `${m}m`}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
