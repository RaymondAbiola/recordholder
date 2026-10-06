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

**Follow-up (2026-10-05):** every one of the 83 addresses passed on-chain verification,
so the third-party data was accurate, and addresses only needed checksumming since
CoinGecko returns them lowercased. The problem is not data quality, it is that the issuer
of a regulated equity product leaves discovery to a third-party listing site with no
authoritative alternative. A consumer cannot answer "what is the complete set of bStocks"
from BNB Chain itself.

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

## 2026-10-05 — there is no per-holder event for a dividend, at all

**Trying to:** tell a holder what a corporate action paid them.

**Expected:** some event carrying holder and amount, the way an airdrop or a transfer does.

**Got:** nothing exists. The two events in play carry disjoint halves of the answer and
neither can be joined to the other:

- `UIMultiplierUpdated(old, new, effectiveAt)` says the multiplier moved. It names no
  holder and carries no balances.
- `TransferWithUIAmount(from, to, amount, uiAmount)` names holders, but is only emitted
  on transfers. A multiplier change moves no tokens, so it fires for nobody.

So when a dividend lands there is no transaction, no transfer, no log mentioning the
holder, and no change to `balanceOf`. A holder's entire transaction history contains zero
evidence that they were paid. The only way to compute it is to already know the multiplier
changed, then go read your own historical balance at the block before it did, which
requires an archive node.

That is the product in one paragraph. It is also the most consequential thing I found: the
information is not hard to get, it is structurally unavailable through every tool a normal
holder has.

**Measured:** Lista Moolah's lending pool held through 21 of the 22 events and was credited
7.6443 shares. Reconstructing that took 3.7 seconds with an archive node and is impossible
without one.

**Would fix it:** emit a per-holder event on multiplier change, or at minimum specify an
`accrued`-style view so an integrator can ask "what did this account gain from multiplier
changes" without reconstructing balances at historical blocks. Failing that, document
plainly in BEP-677 that corporate actions are invisible to holder-side tooling, because
right now the standard reads as though the display layer handles it.

**Follow-up (2026-10-06), what that costs at the UI:** because there is no index, a
statement for one account needs one historical read per recorded action, and it cannot be
batched the way the catalogue sweep can. Multicall3 batches many contracts at one block;
this needs one contract at many different blocks, which is the opposite shape.

Measured on the rendered page, at concurrency 12 against the public archive endpoint:

| account | cold | warm |
| --- | --- | --- |
| Lista Moolah, 66 securities, 21 actions | 8.2s | 2.2s |
| Venus vNVDAB market, 1 security, 1 action | 2.1s | - |

So response time scales with how many corporate actions have ever happened, for every
viewer, forever. Twenty-two actions is fine. The cadence is already sixteen per month and
rising, and at a few hundred this approach stops being viable for anyone without their own
indexer. A per-holder event, or a documented log range that public RPC will actually serve,
would turn an O(actions) reconstruction into a single query.

---

## 2026-10-05 — every corporate action so far had less notice than the oracle may be stale

**Trying to:** recover the full corporate action history for the catalogue, and measure
how much warning integrators actually got for each one.

**Got:** 22 events across 22 tokens, reconstructed from historical `eth_call`. The notice
period is the gap between the block where `newUIMultiplier()` first reports the incoming
value and the block where `uiMultiplier()` starts returning it.

| | seconds |
| --- | --- |
| minimum (GSB) | 109 |
| median | 649 |
| maximum (WDCB) | 1549 |

Venus's pivot oracle config for these same tokens tolerates **3900 seconds** of price
staleness. So all 22 of 22 corporate actions were announced with less warning than the
price feed is permitted to be stale, the tightest by a factor of 36.

The mechanism supports arbitrary lead time. In practice the issuer is using minutes.

Other observations from the reconstruction:

- Most events take effect at exactly 00:00:00 UTC. Three leveraged ETFs (MUUB, SOXLB,
  SOXSB) moved together at 01:30:00 on 2026-09-22, so events arrive in issuer batches,
  not independently.
- Cadence is accelerating as the catalogue grows: one event in July, four in August,
  sixteen in September.
- MUB was already off 1.0 at the earliest block sampled, so its earlier history is
  genuinely unrecoverable within the scan window and is recorded as unknown rather than
  guessed.

**Cost:** the reconstruction itself runs in 65 seconds, but only because Multicall3 works
at historical blocks, so the coarse scan is one request per sampled block regardless of
how many tokens are in it. 18 requests cover 83 tokens.

**Would have prevented the work entirely:** retrievable event logs. All three BEP-677
events are emitted correctly; they are simply unreadable on public infrastructure, so this
whole module exists to reconstruct from state what the logs already record.

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

## 2026-10-05 — "is a multiplier change pending" needs two code paths

**Trying to:** answer one question for any ERC-8056 token: is a multiplier change
scheduled, and when does it land.

**Expected:** one getter.

**Got:** it depends on which optional interfaces the token carries, so a correct reader
needs both paths plus ERC-165 detection to choose between them.

On a token with the BSC-only `IERC8056Scheduled` (`0xeb0093dd`), `hasPendingMultiplier()`
answers directly. Without it you fall back to `effectiveAt() > block.timestamp`, because
`newUIMultiplier()` cannot answer alone: spec 4.2 has it keep returning the stored next
value after that value is already active, so it equals `uiMultiplier()` both before
anything is scheduled and after a change has landed. Those two states are
indistinguishable from that getter.

The fallback also costs an extra round trip, since comparing against `block.timestamp`
means fetching a block just to ask whether something is pending.

Same shape on `totalSupplyUI()`: `IScaledUIAmountBalances` is optional, so a generic
reader has to compute `raw * multiplier / 1e18` locally when it is absent. All 83 bStocks
expose it, but nothing in the standard says they must.

**Cost:** about 30 minutes, most of it re-reading 4.2 and 4.5 to convince myself the
ambiguity was real and not a misreading.

**Would have prevented it:** fold `hasPendingMultiplier()` into the required extension
rather than leaving it as a BSC addition. It is the only getter that answers the question
an integrator actually has, and the spec's own motivation section in 4.5 says as much.

---

## 2026-10-05 — latency: characterising a catalogue needs batching, not patience

**Trying to:** read multiplier, raw supply, UI supply and pending state for all 83
bStocks, fast enough to render a page.

**Numbers:** 5 reads per token, so 415 logical calls. Through Multicall3 that collapses
to **4 RPC round trips, 6714ms total** against `bsc-dataseed.binance.org`.

The interesting part is where the time goes. At roughly 1.7s per round trip, the cost is
almost entirely per-request latency on the public endpoint, not the work inside the call:
a multicall carrying 200 sub-calls costs about the same as one carrying 5. So the lever is
request count, and nothing else.

Done naively, 415 sequential round trips at that latency is on the order of 12 minutes.
I hit this during reconnaissance before batching: a sequential scan of 55 Venus markets
blew a 120 second timeout and had to be moved to the background.

**Worth knowing:** Multicall3 is deployed at the canonical
`0xcA11bde05977b3631167028862bE2a173976CA11` on BSC, so viem's `multicall` works with no
setup. That is the single thing that makes a catalogue-wide view feasible.

**Would have prevented the detour:** BEP-677's integration guidance could say outright
that fully characterising a scaled-UI token takes four to five reads, so anything
operating over a set of them must batch. The per-token interface reads naturally and
scales terribly, and nothing in the spec hints at that.

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
