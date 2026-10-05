# Developer experience log

Append-only. Written at the moment something costs time, because friction becomes
invisible once you have worked around it.

Format per entry: what I was doing, what I expected, what happened, what it cost,
what would have prevented it. Things that worked go in too.

Entries below marked `[recon]` predate the build and come from reconnaissance on
BSC mainnet. Each carries the command that produced it so it can be re-run.

---

## [recon] Enumerating the bStocks token set

**Trying to:** get the full list of bStocks tokens programmatically.

**Expected:** a registry contract with an enumerable getter, or a public token list endpoint.

**Got:** neither. All bStocks are beacon proxies sharing one beacon
(`0x156d6dce9a4f6139a3406f1f021f1a4880de93a3`), but the beacon's owner is an EOA,
so there is no on-chain enumeration point. `bstocks.finance/api/tokens` returns the
site's HTML error page. The only source that worked was CoinGecko's `coins/list`,
filtered on names containing "bStocks": 83 tokens.

**Would have prevented it:** a registry contract, or a documented token list endpoint.

```
cast storage <token> 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50
curl -s "https://api.coingecko.com/api/v3/coins/list?include_platform=true"
```

---

## [recon] Archive state and log ranges on public RPC

**Trying to:** read historical `uiMultiplier()` and pull `UIMultiplierUpdated` history.

**Expected:** at least one free endpoint to serve both.

**Got:** of six public BSC endpoints, exactly one served historical `eth_call`
(`bsc-mainnet.public.blastapi.io`) and none allowed a wide `eth_getLogs`:

| endpoint | result |
| --- | --- |
| bsc-dataseed.binance.org | no archive state; getLogs "limit exceeded" |
| bsc.publicnode.com | archive requires a personal token |
| rpc.ankr.com/bsc | requires an API key |
| 1rpc.io/bnb | getLogs capped at 50 blocks |
| bsc.drpc.org | getLogs capped at 10,000 blocks |
| bsc-mainnet.public.blastapi.io | archive state works |

**Cost:** this is a structural blocker, not an annoyance. The standard's own history
lives in events, and the events are unreachable on free infrastructure.

**Would have prevented it:** documenting the archive requirement next to the event
definitions in BEP-677, since any integrator reconstructing corporate actions hits this.

---

## [recon] State cannot reconstruct history

**Trying to:** find when a multiplier last changed, from contract state alone.

**Expected:** `effectiveAt()` to retain the timestamp of the last applied change.

**Got:** `effectiveAt()` returns 0 once a scheduled change has taken effect with none
pending, per spec 4.2. `newUIMultiplier()` keeps the stored next value even after it
goes live, so it equals `uiMultiplier()` afterwards. Both are correct per spec and both
mean the same thing: history is only in logs. Detecting a past change without an
archive node requires binary searching historical `eth_call`, roughly 20 calls per event.

**Would have prevented it:** a note in the spec saying history is log-only, or an
optional getter returning the last applied change and its timestamp.

---

## [recon] Advance notice is much shorter than oracle staleness tolerance

**Trying to:** measure how much warning an integrator gets before a multiplier moves.

**Got:** NVDAB's move was scheduled at block 120969809 (2026-09-09 23:55:10 UTC) and
took effect at exactly 1788998400 (2026-09-10 00:00:00 UTC). **290 seconds of notice.**
Venus's oracle config for the same token tolerates 3900 seconds of price staleness,
13.4x longer than the notice window.

**Would have prevented it:** a recommended minimum notice period in BEP-677. The
mechanism supports arbitrary lead time; nothing encourages using it.

---

## [recon] Overwritten schedules are invisible to the obvious listener

**Got:** BEP-677 4.5 states that an integrator listening only to `UIMultiplierUpdated`
will not detect that an earlier scheduled change was discarded, which is what
`UIMultiplierChangeOverwritten` exists for. The spec flags this itself. Worth noting
that the trap is real and that the obvious implementation is the wrong one.

---

## [recon] Price data for 83 tokens

**Trying to:** put a USD figure on the hidden share counts.

**Got:** CoinGecko's `simple/token_price` returned nothing for a 23-address batch.
DexScreener's search endpoint returns fuzzy matches dominated by scam tokens, pricing
AAPLB at $0.017 against a true figure near $250. Usable only by querying
`dex/tokens/<address>` and filtering on exact `baseToken.address` plus a liquidity
floor. 11 of 23 divergent tokens still had no clean price.

**Would have prevented it:** an issuer-published price endpoint, or a note that
tokenized equities need address-exact matching because ticker search is poisoned.

---

## [recon] What worked first try

- ERC-165 detection. All five interface IDs returned true on TSLAB, including the
  BSC-only `IERC8056Scheduled` (`0xeb0093dd`).
- `toUIAmount` / `fromUIAmount` / `balanceOfUI` / `totalSupplyUI` all behaved as specified.
- `totalSupplyUI() - totalSupply()` is a clean one-call measure of hidden shares per token.
- Multicall3 is deployed at the standard address on BSC, so an 83-token sweep batches
  into one request.
- All three events are present in the shared implementation bytecode, so every one of
  the 83 tokens emits them.
