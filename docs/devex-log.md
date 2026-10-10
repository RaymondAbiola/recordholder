# Developer experience log

## 2026-10-06 — the Web3 API's auth scheme is not the documented Binance one

**Trying to:** make any authenticated call to the Binance Web3 API.

**Expected:** the Binance signing scheme every tutorial and the spot API docs describe.
HMAC-SHA256 hex over the query string, `timestamp` as epoch milliseconds in the query,
`signature` appended, `X-MBX-APIKEY` header.

**Got:** none of that. The Web3 API uses a different scheme entirely:

```
timestamp = ISO 8601 with milliseconds   2026-10-06T05:06:12.050Z
preHash   = timestamp + METHOD + "/build" + path + ("?" + query) + body
signature = base64( HMAC_SHA256(secret, preHash) )

X-OC-APIKEY, X-OC-TIMESTAMP, X-OC-SIGN, X-OC-RECV-WINDOW, X-OC-NONCE
```

Four separate departures: base64 rather than hex, a structured pre-hash rather than the
bare query string, the literal string `/build` baked inside the signed path, and the
timestamp as a header rather than a parameter. An implementation written from the
documented spot scheme fails on every call, and the failure arrives as an auth rejection
with nothing pointing at which of the four assumptions was wrong.

**How I ended up finding it:** `developers.binance.com` returns **HTTP 202 with a
zero-byte body** to a plain client, so the reference is not reachable programmatically at
all. The scheme had to be recovered by downloading three published wheels in sequence:
`binance-web3-wallet` imports from `binance_web3_common`, which is a separate package from
`binance_common`, and only the first of those contains the `X-OC-*` assembly. The useful
by-product is the exact endpoint list, 65 paths.

**Cost:** roughly two hours, nearly all of it establishing facts that one correct example
request in reachable documentation would have conveyed in a minute.

**Would fix it:** serve the docs to non-browser clients, and publish one worked example
showing the pre-hash string for a real request. The signing is not complicated; it is
simply undiscoverable, and it differs from the scheme a developer will arrive with.

---

## 2026-10-06 — CORRECTION to the enumeration entry below

The earlier entry claims there is no authoritative source for the bStocks token set and
that discovery is left to a third-party listing site. **That is wrong and should not go in
the report as written.**

There is a first-party endpoint, `GET /api/v1/dex/market/rwa/tokens`, taking a
`platformId` and returning the issuer's own token list. There is also
`/api/v1/dex/market/rwa/price`, `/rwa/platforms`, `/rwa/underlying-profile` and
`/rwa/underlying-market`. An entire RWA surface exists.

The accurate version of the complaint is narrower and more interesting: the data exists,
but only behind an authenticated API whose documentation is not reachable programmatically,
and nowhere on chain. A consumer cannot answer "what is the complete set of bStocks" from
BNB Chain itself, and cannot discover that an answer exists without first obtaining a key.
CoinGecko was not the best source available, it was the only *discoverable* one.

Worth noting for the three-issuer comparison the report asks for: the published client's
platform enum contains exactly `ondo` and `bstock`. **xStocks is absent**, though the
hackathon names all three as acceptable. Confirm against the live `/rwa/platforms`
response before stating it, since a published client can lag its API.

---

## 2026-10-10 — Binance Web3 API, first successful call

**Result:** first authenticated call returned HTTP 200 in 1028ms (`/dex/balance/supported/chain`),
the second in 914ms (`/dex/market/rwa/platforms`). The signing scheme recovered from the
published wheels was correct on the first live attempt. Time from opening the docs to this
call: *fill in from your stopwatch, and say which part is measured and which estimated.*

**Not Binance's fault, do not count as friction:** one earlier failed run was a bug in my own
code (the env file was never loaded by that script), and one was the VPN being off.

**Confirmed from the live API:**
- BSC is `binanceChainId` `"56"`. Stated in the client docs, and consistent with the platforms
  response, which places all 91 bStocks on chain `56` only.
- `/rwa/platforms` serves exactly two platforms, `ondo` (459 tickers, 458 tokens on BSC) and
  `bstock` (91 tickers, all on BSC). **xStocks is absent**, although the hackathon names it as
  an acceptable focus. So one of the three named products cannot be reached through the sponsor's
  own RWA API at all.
- The token list response carries `tokenToShareRatio`, `tokenPrice`, `referencePrice` and a
  per-token `statusInfo` with market status and next open and close times, which is the
  market-hours data the report asks about.

**Error-message quality, one real data point:** when the host did not resolve, node's fetch
reported only `fetch failed` and hid `ENOTFOUND` inside `error.cause`. That is a Node
behaviour, not Binance's, but anyone building against this API from a region that needs a VPN
will hit it. Worth saying that the API is unreachable by name without one, and that nothing
tells you so.

**Mistake to avoid repeating in the report:** my probe printed `BSC entry` for the Ethereum
row, because a case-insensitive match on "bnb" hit `bnbstatic.com` in its logo URL. That was a
bug in my matching, not a quirk of the API.

**Follow-up:** the RWA cross-check has now run, see the next entry.

---

## 2026-10-10 — Binance RWA API cross-checked against the chain

Method: `npm run rwa` fetches `/dex/market/rwa/tokens` for `bstock` and `ondo` on chain `56`,
then reads the multiplier and interface support for every returned token directly from the
chain. Raw responses are cached in `data/rwa-tokens.json`.

**The API disagrees with itself about how many tokens exist.** `/rwa/platforms` reports 91
bStocks and 458 Ondo tokens on BSC. `/rwa/tokens` for the same platform and chain returns 46 and
442. Neither request model nor response model has a page or limit parameter, so this is not
pagination. Our own catalogue, found independently and verified on chain, holds 83 bStocks and
contains all 46 that Binance's list returns, plus 37 it does not. So the token list is a subset
of what exists, and the platform summary (91) exceeds what we found (83), which means neither
source is shown to be complete. Unexplained; reported as found.

**`tokenToShareRatio` is the on-chain multiplier.** For 19 of 19 divergent bStocks in Binance's
list it equals `uiMultiplier()` to every digit shown, and for none is it the inverse. The other
27 returned tokens sit at exactly 1.0 and carry no information. This is the ratio, not a
balance, so it does not by itself say what the balances endpoint reports.

**`tokenPrice` is not a market price.** For 19 of 19 divergent tokens,
`tokenPrice == referencePrice x tokenToShareRatio` with zero error at 1e-12. So the API
publishes two different prices that differ by exactly the multiplier: `referencePrice` is per
share and pairs with a share count, `tokenPrice` is per token and pairs with a raw balance.
Using the wrong one with the wrong quantity is the trap this whole project is about, and the
API makes both available but does not say which belongs with which.

**Ondo does not use this mechanism, as far as these probes can tell.** Of 442 Ondo tokens, none
reported support for the ERC-8056 core or scheduled interface IDs and none exposed
`sharesMultiplier()`. How Ondo adjusts for corporate actions was not determined, and a function
under another name would not have been found.

**xStocks is not in this API at all** (`/rwa/platforms` lists two platforms).

**Market hours.** bStocks report `openState: true` for all 46 tokens on a Saturday, with no
`marketStatus` and no next open or close time. Ondo reports `closed` for 411 and `offhours` for
31, with next open and close times. So the issuer's own product is modelled as always open and
the third-party one carries a trading calendar.

**Does Venus's feed quote per share or per token? Leans per share, not established.** NVDAB on
2026-10-10: Venus's oracle 230.315, Binance reference (per share) 230.40, Binance token price
(per token) 230.579. Venus sits 0.037% below the per-share price and 0.115% below the per-token
price. On 2026-10-03: Venus 234.50 against an AMM price of 234.64 for the raw token, which
implies about 234.46 per share, so Venus was 0.018% above per share and 0.060% below per token.
Both observations are closer to per share. But the gaps are the same size as ordinary feed
noise and the multiplier itself is only 0.0778%, so these data cannot discriminate and the site
does not claim either way. If the feed is per share the error is conservative for the protocol,
since the multiplier has only risen so far, and matters for borrowers only once borrowing is
enabled, which it is not.

**Value of the undisclosed shares:** at least $224,743, at last-close reference prices, across
the 19 divergent securities Binance prices. It does not price SOXSB (1,461 undisclosed shares),
GSB, PYPLB, CRMB, AMATB or AAPLB, so the true total is higher.

---

## OPEN — Binance Web3 API, first contact

The client and the balance comparison are written and verified as far as they can be
without a live call. What is missing can only be measured by whoever holds the key, and
some of it exists only in the moment:

- [ ] **Time from opening the documentation to the first successful call.** Start a timer
      when the portal docs open. This cannot be reconstructed afterwards.
- [ ] Confirm `BINANCE_BSC_CHAIN_ID` from the `/dex/balance/supported/chain` response.
      EVM chains may use the plain chain id (56) while Solana and Tron use `CT_501` and
      `CT_195`, which look like SLIP-44 coin types, so BSC could be `CT_714`. Unresolved.
- [ ] Error message quality on a wrong path, an unsigned request, and a key not yet
      enabled for the Web3 API. Quote them verbatim, including whether the status code
      matched the message.
- [ ] Latency of the call, and whether it varies with the number of tokens returned.
- [ ] The response shape, since it had to be guessed at. Paste the first response.
- [ ] **The finding itself:** raw balances or multiplier-adjusted? Paste the comparison
      table from `npm run binance:balances` verbatim either way.

Run `npm run binance:probe` first: it establishes the chain id and the platform list.
Then `npm run binance:balances -- <address>`. Lista Moolah
(`0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C`) holds 22 of the 23 divergent securities, so
it produces the widest comparison in one call.

---

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
- Cadence is accelerating as the catalogue grows: one event in July, five in August,
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

## 2026-10-10 — refresh: the pattern held on two new actions, and the figures moved

Re-ran the sweep and the reconstruction five days after the first. Two further actions had
landed on 2026-10-09 (MRVLB, +1.53 bps, 829s notice; ORCLB, +25.72 bps, 769s notice), so the
record is now **24 actions across 25 securities**, with 2,896.154 hidden shares, up from
2,490.512 on the 5th. Hidden shares grew by about 16% in five days.

The notice figures to quote are the current ones, not the earlier entry's: **min 109s,
median 708s, max 1549s, n=24**. The median moved from 649s because two new points joined.
All 24 of 24 are still below the 3900s of staleness Venus tolerates. This is the first
independent check that the pattern is not an artefact of the first 22 observations, since
the two new events were not in the sample the claim was originally drawn from.

Cadence by month is now 1 (July), 5 (August), 16 (September), 2 (October so far, in nine
days). September was the peak; October is running at roughly the August rate, so this is
a steady stream rather than a single cluster.

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
