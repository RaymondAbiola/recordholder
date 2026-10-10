import { loadEvents } from "@/src/snapshot";

export default function Loading() {
  const total = loadEvents()?.events.length;
  return (
    <main className="sheet">
      <header className="masthead">
        <div>
          <h1 className="wordmark">Recordholder</h1>
          <p className="subtitle">Statement of corporate actions</p>
        </div>
        <div className="label">Compiling</div>
      </header>

      <section className="section">
        <h2>Reconstructing the record</h2>
        <p className="lede">
          Reading this account&rsquo;s balance at the block before each of the {total ?? "all"} recorded corporate
          actions. A dividend under BEP-677 emits no event naming the holder, so there is no index to
          query and each one has to be read from historical state.
        </p>
        <div className="callout">
          <p>Usually a few seconds. Longer on a first visit, since nothing is cached yet.</p>
        </div>
      </section>
    </main>
  );
}
