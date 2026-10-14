# $APE — Ape Into Lowcaps

Solana memecoin site with a live pump.fun desk where the ape trades on his own and you watch.

```
index.html         markup (hero, lore, the ape, the cycle, the trenches, ape army)
css/style.css      site styling · css/terminal.css the trenches desk
js/main.js         animations, cursor, effects — CONFIG (X link, CA, buy URL) at the top
js/terminal.js     the trenches: live feed, market-cap chart, the ape's desk
core.js            the ape's trading rulebook, shared by browser and server
api/pump.js        pump.fun lists proxy + the server-side coin universe
api/candles.js     real OHLC history per coin (pump.fun swap API, proxied)
api/meta.js        token metadata proxy (IPFS/other hosts)
api/state.js       shared session: one ape for everybody, kept in Redis, lazy tick
api/analyze.js     optional brain on fal.ai (FAL_KEY); without it the built-in scoring drives
assets/            character poses (WebP, transparent) and logo
```

Static site plus serverless functions. No build step.

## What is real and what is not

| Real | Simulated |
|---|---|
| Coins, launches, trades, market caps, bonding curve progress (PumpPortal + pump.fun) | The ape's 10 SOL wallet |
| Candle history (pump.fun swap API) | Fills, slippage, fees |
| The scoring model and the rulebook in `core.js` | Transaction signatures |

Nothing is broadcast on-chain and nobody can deposit or withdraw. Visitors only watch.

## Deploy

Pushing to `main` deploys on Vercel. Optional environment variables:

| Variable | What it does |
|---|---|
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) | Attach an Upstash Redis (Vercel → Storage) and every visitor watches the **same** ape. Without it each browser runs its own copy of the ape. |
| `FAL_KEY` | fal.ai key: the ape asks a language model for a thesis and proposals every 40s. Without it the built-in scoring drives. |
| `FAL_MODEL`, `FAL_ENDPOINT`, `LLM_MAX_PER_MIN` | Model id (default `google/gemini-2.5-flash-lite`), endpoint (`openrouter/router`), spend ceiling. |

## How the ape trades

1. **Scan** — new launches, coins climbing the bonding curve, fresh graduates. Only coins above $6K market cap are on the board.
2. **Score** — momentum over 1 and 3 minutes (sampled market caps), trades happening right now, curve progress sweet spot, age, replies, livestream, name quality.
3. **Veto** — dead (< $6K), too big (> $500K), already +100% in 3 minutes, no trade for 5 minutes, dumping, non-ascii names.
4. **Enter** — score ≥ 62, at most 4 open, 8–14% of equity per clip, sized to the pool so impact stays under 3%, one entry per 15s, no rebuy for 8 minutes (16 after a loss), four losses in a row pauses him for 5 minutes.
5. **Exit** — scale out 40% at +20%, bank 60% at +40% and trail the runner 20% under its high, profit locks behind the peak, stop −14%, time stop at 12 minutes under +5%, a one-tick −55% drop is a rug.

The rulebook is `RULES` in `core.js`. The numbers were tuned by backtesting this same core on real pump.fun candle history (15s and 1m, ~130 coins): the first cut lost on both sets, the tuned book was positive on both. That is evidence, not a promise — the trenches are a real market and losing sessions happen. One session is one UTC day; the wallet resets to 10 SOL at midnight and the day goes into the archive.
