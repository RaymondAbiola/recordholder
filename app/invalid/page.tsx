import Link from "next/link";
import { Brand } from "@/app/brand";
import { SiteNav, Jump, SiteFooter } from "@/app/site-nav";

export const metadata = { title: "Not an address | Recordholder" };

export default function Invalid() {
  return (
    <main className="sheet">
      <header className="masthead">
        <div>
          <h1 className="wordmark">
            <Brand />
          </h1>
          <p className="subtitle">Statement of corporate actions</p>
        </div>
      </header>

      <SiteNav current="none" />

      <section className="section">
        <h2>That is not a valid BNB Chain address</h2>
        <p className="lede">
          An address is <span className="num">0x</span> followed by 40 hexadecimal characters. Check
          for a missing or extra character, or for a transaction hash pasted by mistake.
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
    </main>
  );
}
