import Link from "next/link";

// A boxy R. The ink is the part a balance reports; the coral leg is the part it does not.
// One path for the ink, so no hairline seam shows where the bowl meets the stem.
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="mark">
      <path fill="currentColor" fillRule="evenodd" d="M5 4H25V18H11V28H5Z M11 9H19V13H11Z" />
      <path fill="var(--discrepancy)" d="M13 18H19.6L26.5 28H19.9Z" />
    </svg>
  );
}

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Recordholder, home">
      <Mark />
      <span>Recordholder</span>
    </Link>
  );
}
