# Recordholder

The corporate action and dividend record for BEP-677 tokenized stocks on BNB Chain.

bStocks pay dividends and process stock splits by moving an on-chain UI multiplier.
`balanceOf()` keeps returning the raw amount by spec, so the shares you actually own
are `raw * uiMultiplier / 1e18` and nothing that reads `balanceOf` ever shows them.
Recordholder reconstructs each wallet's true share count and the corporate actions it
held through, and exports the result.

As of 2026-10-10, 25 of the 83 bStocks have multipliers above 1.0, and 24 corporate
actions have been recorded since July, hiding roughly 2,896 shares across all holders.
The catalogue holds the 83 bStocks that could be found and verified on chain; Binance's own
RWA API advertises 91 on BSC but returns only 46 from its token list, so completeness is not
confirmed. That is a count of shares, not a value: one hidden NVIDIA share and one hidden Nokia
share are both one share. The deployed site reads the same snapshots as this repo, so
the figures match.

**Live:** https://recordholder.vercel.app

## What it does

- Reconstructs when each corporate action happened and how much notice integrators got, from
  historical chain state, because no public endpoint tested serves the event logs.
- Shows any address what it holds, what each action paid it, and the difference between
  `balanceOf` and the shares it actually owns.
- Cross-checks the figures against Binance's own Web3 RWA API.

## API

| | |
| --- | --- |
| `GET /api/events` | the full record: every action, notice period and affected security |
| `GET /api/wallet/<address>` | one account's statement as JSON |
| `GET /api/wallet/<address>?format=csv` | the same as CSV, quantities and dates only |

## Setup

```bash
npm install
cp .env.example .env.local   # fill in, see below
npm run smoke
```

`npm run smoke` verifies RPC access, multicall batching, ERC-8056 interface detection,
and archive state, asserting a known historical fact: NVDAB's multiplier moving from
1.0 to 1.000778223752807865 at block 120970451.

## Scripts

| | |
| --- | --- |
| `npm test` | unit tests for the arithmetic, export and request signing |
| `npm run smoke` | RPC, multicall, ERC-165 detection and an archive read asserting a known fact |
| `npm run catalogue` | rebuild the token list, verifying each address on chain |
| `npm run sweep` | read all multipliers and supplies into `data/sweep.json` |
| `npm run events` | reconstruct the corporate action history into `data/events.json` |
| `npm run wallet -- <address>` | the statement for one account, in the terminal |
| `npm run binance:probe` | first contact with the Binance Web3 API (needs keys and, in some regions, a VPN) |
| `npm run rwa` | fetch Binance's RWA token lists and cross-check them against the chain |
| `npm run binance:balances -- <address>` | compare what Binance's balances endpoint reports against the chain |

## Environment

Everything has a working public default, so the smoke test passes on a fresh clone with
no configuration. For real work set `BSC_ARCHIVE_RPC_URL` to an endpoint with archive
state and wide `eth_getLogs`, because corporate action history is only in events and most
public endpoints serve neither. See `docs/devex-log.md`.

`BINANCE_API_KEY` and `BINANCE_API_SECRET` are server side only. Requests are signed
with HMAC-SHA256, so the secret must never reach a browser.

## Layout

```
src/      chain reading, no framework imports, meant to be copied out
scripts/  one-shot sweeps and snapshot builders
docs/     developer experience log
```
