import Link from "next/link";

type Current = "record" | "actions" | "exposure" | "binance" | "none";

const ITEMS = [
  { key: "record", href: "/", label: "Record" },
  { key: "actions", href: "/actions", label: "Actions" },
  { key: "exposure", href: "/exposure", label: "Exposure" },
  { key: "binance", href: "/binance", label: "Binance" },
] as const;

export function SiteNav({ current }: { current: Current }) {
  return (
    <nav className="sitenav" aria-label="Site">
      {ITEMS.map((i) => (
        <Link key={i.key} href={i.href} aria-current={current === i.key ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
      <a href="/api/events">JSON</a>
      <Link className="push" href="/#lookup">
        Look up an address
      </Link>
    </nav>
  );
}

export function Jump({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav className="jump" aria-label="On this page">
      <span className="label">On this page</span>
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`}>
          {i.label}
        </a>
      ))}
    </nav>
  );
}

export function SiteFooter() {
  return (
    <p className="footnav">
      <Link href="/">Record</Link>
      <Link href="/actions">Actions</Link>
      <Link href="/exposure">Exposure</Link>
      <Link href="/binance">Binance</Link>
      <a href="/api/events">JSON</a>
      <a href="#top">Back to top</a>
    </p>
  );
}
