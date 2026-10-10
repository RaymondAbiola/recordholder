"use client";

export default function StatementError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="sheet">
      <header className="masthead">
        <div>
          <h1 className="wordmark">Recordholder</h1>
          <p className="subtitle">Statement of corporate actions</p>
        </div>
      </header>
      <section className="section">
        <h2>The record could not be reconstructed</h2>
        <p className="lede">
          Each corporate action is read from historical chain state, and the archive endpoint did not
          answer in time. This is usually a rate limit and clears within a minute.
        </p>
        <div className="lookup">
          <button type="button" onClick={reset}>
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
