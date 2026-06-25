# Newton Drilling Monitor

Drilling state classification dashboard powered by [Newton](https://www.archetypeai.io/) and the [Equinor Volve Data Village](https://www.equinor.com/energy/volve-data-sharing).

Plays back real drilling sensor data from 14 wells in the Volve oil field (North Sea, 2007–2009 drilling phase) and uses Newton's **Direct Query API** to classify each data window as **drilling** or **not_drilling**: every window is embedded per-channel by the Omega encoder (one stateless `/query` call per sensor) and scored by a **local KNN** against an n-shot reference library — no lens, no session, no SSE. Includes live evaluation against ACTC ground truth.

> The Volve field operated 2007–2016, but real-time drilling sensor data only covers the 2007–2009 construction phase. After 2009 the rig left and the field moved to production (different file types, no real-time WITSML streams).

![Newton Drilling Monitor](static/demo.png)

## Features

- **14 wells** from the Volve North Sea oil field, sorted by class balance (wells with both drilling and not-drilling activity first)
- **Rig instrument panel** — SVG drilling rig with 10 live sensor sparklines (9 channels + ACTC ground truth)
- **Playback controls** — play, pause, reset with progress bar, human-friendly timestamps
- **Direct Query classification** — each 128-sample window is embedded by Omega (`/query`) and classified by a local KNN as drilling or not_drilling
- **Classification log** — scrolling list of predictions with drilling/not-drilling counts
- **N-shot library (leakage-free)** — built offline from two **held-out reference wells** (F-10, F-4) that are excluded from the well selector, so every well you can classify is genuinely unseen. Unanimous-ACTC windows from those wells are embedded into a local KNN library (`data/knn-library.json`) by `scripts/build-knn-library.js`
- **Synchronous per-window inference** — `POST /api/classify` returns the verdict for each window directly (no streaming session to manage)
- **Incremental data loading** — full raw CSVs (up to 1.9M rows) loaded in 5,000-row chunks during playback
- **Auto-seek** — automatically starts playback at the section with the best drilling/not-drilling balance (scored by unanimous windows, not raw rows)

### Advanced Mode (⚙)

- **Live Evaluation** — compares predictions against ACTC ground truth (unanimous windows only), shows accuracy, F1, precision, recall, confusion matrix, and per-window pass/fail log

## Notes on the Encoder

The classifier embeds with `OmegaEncoder::omega_embeddings_1_4` (generic time-series encoder, the current prod default per the [`atai-newton-omega-model`](https://github.com/archetypeai/agent-skills/tree/main/skills/atai-newton-omega-model) skill). Each sensor channel is sent as its own `/query` call with `normalize_input: false`; every window is pre-normalized with a fixed global scaler (`data/scaler.json`) so cross-window amplitude is preserved rather than erased by per-window normalization. The per-channel 768-d embeddings are concatenated into the joint feature the KNN compares.

The encoder is hardcoded to `omega_embeddings_1_4`. To try a different encoder, change `OMEGA_MODEL` in `src/lib/server/newton.js` **and** in `scripts/build-knn-library.js`, then rebuild the library — the library embeddings and the live query path must use the same encoder, since different encoders produce different vectors (same `[N × 768]` shape, different values) and KNN distances over them are not comparable.

**Per-well accuracy (held-out, prod).** Measured against prod (`omega_embeddings_1_4`) with the leakage-free library, scoring up to 15 unanimous-ACTC windows per class per well (window=128, k=3), DRILLING as the positive class:

| Well | Accuracy | F1 | Eval windows |
|---|---:|---:|---|
| F-14 | 100% | 100% | 30 |
| F-9 | 93% | 93% | 30 |
| F-12 | 93% | 93% | 30 |
| F-5 (NA-NA) | 90% | 91% | 30 |
| F-5 (StatoilHydro) | 87% | 87% | 30 |
| F-15S | 83% | 81% | 30 |
| F-1 | 83% | 80% | 30 |
| F-7 | 83% | 80% | 30 |
| F-9 A † | 83% | 85% | 24 |
| F-15B † | 65% | 79% | 17 |
| F-15 † | 65% | 77% | 20 |
| F-15A † | 38% | 55% | 29 |

Across the **8 wells with substantive both-class activity**, held-out accuracy averages **~88%** (F1 ~88%) — and these are *genuinely unseen* wells (the references come only from held-out F-10 + F-4). That's notably better than the pre-fix figures, which were measured under data leakage and a different encoder.

† **Single-class wells** (>99% drilling: F-9 A, F-15, F-15A, F-15B) have only 2–14 not-drilling windows in the entire well, so a balanced sample over-weights that rare class and the metric is noisy/misleading — see [Single-class wells show misleading metrics](#single-class-wells-show-misleading-metrics). They're sorted to the end of the selector.

## Stack

- **SvelteKit** with Svelte 5 runes
- **Archetype AI Design System** — semantic tokens, component primitives, composite patterns
- **Newton Direct Query API** — per-channel Omega `/query` embeddings + local KNN classification
- **Tailwind v4** — styling with semantic design tokens

## Dataset

The [Equinor Volve Data Village](https://www.equinor.com/energy/volve-data-sharing) provides real-time drilling sensor data from the Volve oil field. 9 sensor channels at ~1-second resolution:

| Channel | Description | Unit |
|---------|-------------|------|
| BPOS | Block Position | m |
| DBTM | Bit Depth | m |
| FLWI | Flow In | L/min |
| HDTH | Hole Depth | m |
| HKLD | Hookload | kkgf |
| ROP | Rate of Penetration | m/h |
| RPM | Rotary Speed | rpm |
| SPPA | Standpipe Pressure | kPa |
| WOB | Weight on Bit | kkgf |

**Drilling** (ACTC 1-2) = bit on bottom, rotating, mud flowing, hole getting deeper. **Not drilling** (ACTC 3/4/8/9) = tripping, circulating, shut in, etc.

## Setup

Requires [Git LFS](https://git-lfs.com) (the well CSVs and the precomputed KNN library are stored via LFS):

```bash
git lfs install
git clone <repo>          # LFS pulls static/data/wells/*.csv and data/knn-library.json
npm install
```

Create a `.env` file:

```
ATAI_API_KEY=your_api_key_here
ATAI_API_ENDPOINT=https://api.u1.archetypeai.app/
```

`data/scaler.json` and `data/knn-library.json` are **committed** (the library via Git LFS), so the demo runs out of the box — no build step needed for a normal run.

Rebuild the reference library only if you change the held-out reference wells, the window size, or the encoder:

```bash
node scripts/build-scaler.js        # data/scaler.json  (per-channel robust median/IQR)
node scripts/build-knn-library.js   # data/knn-library.json  (labeled Omega embeddings)
```

Both read the held-out reference wells from `src/lib/reference-wells.js`; `build-knn-library.js` reads `.env` directly.

## Development

```bash
npm run dev
```

Open `http://localhost:5173`, select a well, click **Start Analysis**, then press Play.

## How It Works

1. Select a well — data loads incrementally from full raw CSVs (up to 1.9M rows per well)
2. **Start Analysis** arms the analysis (no lens session — Direct Query is stateless) and classifies the first window
3. Press **Play** — data plays back at accelerated speed, advancing the rig sparklines and playhead
4. The window **under the playhead** is POSTed to `/api/classify` (up to 3 in flight), so verdicts track what's on screen
5. The server pre-normalizes the window with the global scaler, embeds each channel via Omega `/query` (`normalize_input: false`), concatenates the per-channel vectors, and runs a local KNN against `data/knn-library.json`
6. The verdict returns synchronously and appears as colored bands on the rig and entries in the classification log

## Architecture

```
src/
├── routes/
│   ├── +page.svelte                  # Dashboard orchestrator
│   └── api/
│       ├── classify/+server.js       # POST window → { label, votes, neighbors }
│       ├── wells/+server.js          # List wells sorted by class balance
│       ├── wells/data/+server.js     # Paginated well data chunks
│       └── wells/mixed-offset/       # Find best mixed section (auto-seek)
├── lib/
│   ├── server/newton.js              # Direct Query embedding + local KNN
│   ├── reference-wells.js            # Held-out reference wells (F-10, F-4) + ACTC code sets
│   ├── api/drilling.js               # Client-side fetch wrappers (classifyWindow)
│   └── components/ui/custom/
│       ├── rig-dashboard.svelte      # SVG rig + 10 sensor sparklines
│       ├── classification-log.svelte # Prediction history + stats
│       ├── accuracy-panel.svelte     # Live Evaluation (accuracy, F1, confusion matrix)
│       ├── playback-controls.svelte  # Play/pause/reset + progress
│       └── well-selector.svelte      # Well button grid
├── scripts/
│   ├── build-scaler.js               # Offline: per-channel scaler → data/scaler.json
│   └── build-knn-library.js          # Offline: embed n-shot refs → data/knn-library.json
├── data/                             # scaler.json (committed) + knn-library.json (committed via Git LFS)
└── static/data/
    └── wells/                        # 14 full raw well CSVs (Git LFS).
                                      # F-10 + F-4 are the held-out reference pool
                                      # (build the library); the other 12 are classified.
```

## Newton API Pattern

This demo uses the **Direct Query API** with the Omega encoder — the same time-series pattern as the [SWaT water-treatment demo](https://github.com/archetypeai/archetypeai-swat-demo-direct-query), and the [`atai-newton-omega-model`](https://github.com/archetypeai/agent-skills/tree/main/skills/atai-newton-omega-model) skill's recommended downstream shape:

| Pattern | Used In | API |
|---------|---------|-----|
| Vision (multi-frame `/query`) | Traffic, Wildfire | Image → classification |
| Text reasoning (`/query`) | Earthquake, Grid | Structured text → analysis |
| **Omega embeddings + local KNN (`/query`)** | **Drilling, SWaT, Wind Turbine** | **Time-series → state classification** |

There is no lens and no session: classification is `embed each channel via /query → concatenate → KNN against the local library`, entirely under our control.

## Classifier Config

`DEFAULT_CONFIG` in `src/lib/server/newton.js`:

```js
{ windowSize: 128, stepSize: 128, nNeighbors: 3 }   // KNN metric: euclidean
```

The window/step were tuned with [newton-streaming-optimizer](https://github.com/archetypeai/newton-streaming-optimizer) (F1 climbed monotonically with window size: w32=85.4% → w64=97.1% → w128=100% on the bundled slice). The library is built at the same `windowSize`/`stepSize` by `scripts/build-knn-library.js`; the encoder is `OmegaEncoder::omega_embeddings_1_4` with `normalize_input: false` over the global scaler.

## Known Limitations

### Accuracy varies widely by well

Held-out prod accuracy is **~88% across the 8 both-class wells** (see the per-well table above), but it varies with each well's operational profile, transition frequency, and similarity to the reference wells, and the single-class wells score lower on a balanced sample. This isn't a bug — it's the inherent limitation of few-shot classification with a generic encoder.

### No "I don't know" answer

KNN always picks the nearest class, even when the input is far from any n-shot example. Wells with unusual operations (sidetracks, casing, completions) that don't resemble either the "drilling" or "not drilling" references will be force-classified into one, often incorrectly. A distance threshold or abstention mechanism would help but isn't implemented here.

### Single-class wells show misleading metrics

Four classifiable wells are effectively single-class (>98% drilling): F-9 A, F-15, F-15A, F-15B. They sort to the end of the selector. Their per-well numbers above are noisy because a balanced eval sample over-weights the 2–14 not-drilling windows that exist; in normal use (mostly drilling) they score much higher.

### Transition-heavy sections produce many skipped windows

At `window_size=128`, windows that straddle a drilling↔not-drilling transition contain mixed ACTC codes and are excluded from evaluation. Wells like F-7 with frequent state changes can have 30%+ skipped windows. The auto-seek minimizes this by starting at a section with the most *unanimous* (single-class) windows, but some skipping is inevitable.

### Leakage-free split (held-out reference wells)

The references come from two **held-out wells** — F-10 (drilling-rich) and F-4 (not-drilling-rich) — that are excluded from the well selector, so no well you can classify ever contributed a reference window. `build-scaler.js` and `build-knn-library.js` read this list from `src/lib/reference-wells.js`; only unanimous-ACTC windows become references.

> Earlier versions sampled the n-shot examples (the bundled `volve_drilling.csv` / `volve_not_drilling.csv`) from across *all* wells, which leaked reference rows into the very wells being scored and flattered accuracy on the wells that contributed most. Those files were removed; the library is now built from the held-out wells only.

### Direct Query latency

Each window fans out 9 per-channel `/query` calls (bounded to 6 concurrent, with retries) — roughly 1–3 s per window. To stay aligned with playback, the UI classifies the window **under the playhead** rather than sequentially from the start, with up to 3 windows in flight at once (`MAX_IN_FLIGHT` in `+page.svelte`). Verdicts therefore track what's on screen; at fast playback some windows between are skipped (the log is sparse but every entry is relevant). The library is precomputed offline, so there's no per-session warm-up wait.

## Data Attribution

The drilling sensor data used in these examples is from the **Equinor Volve Data Village**, released under a modified CC BY 4.0 license. The data may be used for commercial and non-commercial purposes but may not be resold.

> Data provided by Equinor and the former Volve license partners (ExxonMobil Exploration & Production Norway AS and Bayerngas Norge AS). [Terms and Conditions](https://www.equinor.com/energy/volve-data-sharing).
