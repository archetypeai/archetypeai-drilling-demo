# Newton Drilling Monitor

Drilling state classification dashboard powered by [Newton](https://www.archetypeai.dev/) and the [Equinor Volve Data Village](https://www.equinor.com/energy/volve-data-sharing).

Plays back real drilling sensor data from 14 wells in the Volve oil field (North Sea, 2007–2009 drilling phase) and uses Newton's **Direct Query API** to classify each data window as **drilling** or **not_drilling**: every window is embedded per-channel by the Omega encoder (one stateless `/query` call per sensor) and scored by a **local KNN** against an n-shot reference library — no lens, no session, no SSE. Includes live evaluation against ACTC ground truth.

> The Volve field operated 2007–2016, but real-time drilling sensor data only covers the 2007–2009 construction phase. After 2009 the rig left and the field moved to production (different file types, no real-time WITSML streams).

![Newton Drilling Monitor](static/demo.png)

## Features

- **14 wells** from the Volve North Sea oil field, sorted by class balance (wells with both drilling and not-drilling activity first)
- **Rig instrument panel** — SVG drilling rig with 10 live sensor sparklines (9 channels + ACTC ground truth)
- **Playback controls** — play, pause, reset with progress bar, human-friendly timestamps
- **Direct Query classification** — each 128-sample window is embedded by Omega (`/query`) and classified by a local KNN as drilling or not_drilling
- **Classification log** — scrolling list of predictions with drilling/not-drilling counts
- **N-shot library** — 2,000 labeled examples per class embedded offline into a local KNN library (`data/knn-library.json`), built once with `scripts/build-knn-library.js`
- **Synchronous per-window inference** — `POST /api/classify` returns the verdict for each window directly (no streaming session to manage)
- **Incremental data loading** — full raw CSVs (up to 1.9M rows) loaded in 5,000-row chunks during playback
- **Auto-seek** — automatically starts playback at the section with the best drilling/not-drilling balance (scored by unanimous windows, not raw rows)

### Advanced Mode (⚙)

- **Live Evaluation** — compares predictions against ACTC ground truth (unanimous windows only), shows accuracy, F1, precision, recall, confusion matrix, and per-window pass/fail log

## Tuning the Config

Hyperparameter search lives in a separate tool: [archetypeai/newton-streaming-optimizer](https://github.com/archetypeai/newton-streaming-optimizer) brute-forces a grid of window sizes / KNN params and outputs a ready-to-use config. Drop the winning `windowSize` / `stepSize` / `nNeighbors` into `DEFAULT_CONFIG` in `src/lib/server/newton.js` (and rebuild the library if the window changed) to apply them here.

The current default (`window=128, k=3, euclidean`) is the optimizer's top-ranked config on the bundled drilling slice. F1 climbed monotonically with window size: w32=85.4% → w64=97.1% → w128=100%. Re-run the optimizer against your own data if you want a different sensor set or balance.

## Notes on the Encoder

The classifier embeds with `OmegaEncoder::omega_embeddings_1_4` (generic time-series encoder, the current prod default per the [`atai-newton-omega-model`](https://github.com/archetypeai/agent-skills/tree/main/skills/atai-newton-omega-model) skill). Each sensor channel is sent as its own `/query` call with `normalize_input: false`; every window is pre-normalized with a fixed global scaler (`data/scaler.json`) so cross-window amplitude is preserved rather than erased by per-window normalization. The per-channel 768-d embeddings are concatenated into the joint feature the KNN compares.

The encoder is hardcoded to `omega_embeddings_1_4`. To try a different encoder, change `OMEGA_MODEL` in `src/lib/server/newton.js` **and** in `scripts/build-knn-library.js`, then rebuild the library — the library embeddings and the live query path must use the same encoder, since different encoders produce different vectors (same `[N × 768]` shape, different values) and KNN distances over them are not comparable.

**Per-well numbers in the live demo are lower.** Observed during testing:

| Well | F1 | Notes |
|---|---:|---|
| F-15S | ~94% | Best — large, balanced well |
| F-1 | ~63% | Conservative drilling predictions (high precision, low recall) |
| F-5 (NA) | ~57% | |
| F-7 | ~45% | High transition activity → many skipped windows |

The gap between optimizer numbers (94–100%) and per-well reality (45–94%) is due to distribution shift: the generic n-shot examples were extracted from one region of the dataset and don't equally represent the operational patterns of every well.

A domain-specific surface drilling encoder, `OmegaEncoder::omega_embeddings_surface_01`, is exposed on `/query` (staging only as of 2026-04-30). It's a drop-in replacement for the generic encoder — to try it, set `OMEGA_MODEL` in `src/lib/server/newton.js` and `scripts/build-knn-library.js`, then rebuild the library so the reference embeddings and the live query path use the same encoder.

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

```bash
npm install
```

Create a `.env` file:

```
ATAI_API_KEY=your_api_key_here
ATAI_API_ENDPOINT=https://api.u1.archetypeai.app/
```

Then build the n-shot reference library once (offline — embeds the 2,000+2,000 reference rows via `/query` and caches them locally):

```bash
node scripts/build-scaler.js        # data/scaler.json  (per-channel mean/std)
node scripts/build-knn-library.js   # data/knn-library.json  (labeled Omega embeddings)
```

`build-knn-library.js` reads `.env` directly. Rebuild only if you change a reference CSV, the window size, or the encoder.

## Development

```bash
npm run dev
```

Open `http://localhost:5173`, select a well, click **Start Analysis**, then press Play.

## How It Works

1. Select a well — data loads incrementally from full raw CSVs (up to 1.9M rows per well)
2. **Start Analysis** arms the analysis (no lens session — Direct Query is stateless) and pre-classifies the first few windows
3. Press **Play** — data plays back at accelerated speed, advancing the rig sparklines and playhead
4. As the playhead passes each 128-sample window boundary, the window is POSTed to `/api/classify`
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
├── data/                             # scaler.json (committed) + knn-library.json (generated, git-ignored)
└── static/data/
    ├── volve_drilling.csv            # N-shot examples (2,000 drilling rows)
    ├── volve_not_drilling.csv        # N-shot examples (2,000 not-drilling rows)
    └── wells/                        # 14 full raw well CSVs (Git LFS)
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

The optimizer reports F1 = 94–100% on its curated evaluation slice. Real per-well performance ranges from **45% to 94% F1** depending on the well's operational profile, transition frequency, and similarity to the generic n-shot examples. This is not a bug — it's the inherent limitation of few-shot classification with a generic encoder.

### No "I don't know" answer

KNN always picks the nearest class, even when the input is far from any n-shot example. Wells with unusual operations (sidtracks, casing, completions) that don't resemble either the "drilling" or "not drilling" n-shots will be force-classified into one, often incorrectly. A confidence threshold or abstention mechanism would help but is not available in the current Newton lens API.

### Single-class wells show misleading metrics

5 of the 14 Volve wells are effectively single-class (>98% drilling): F-9A, F-10, F-15, F-15A, F-15B. These are sorted to the end of the well selector since there's nothing meaningful to evaluate. F1 may show 0% on these wells even though the model is technically correct most of the time — there simply aren't enough minority-class windows to score.

### Transition-heavy sections produce many skipped windows

At `window_size=128`, windows that straddle a drilling↔not-drilling transition contain mixed ACTC codes and are excluded from evaluation. Wells like F-7 with frequent state changes can have 30%+ skipped windows. The auto-seek minimizes this by starting at a section with the most *unanimous* (single-class) windows, but some skipping is inevitable.

### Per-well n-shots don't help

We tested extracting n-shot examples from each well's own data (per-well prep). Counterintuitively, this performed **worse** than the generic multi-well n-shots (F-7: 40% F1 per-well vs 80% F1 generic). The generic examples are more diverse and capture a broader range of drilling/not-drilling signatures. The right lever for improving accuracy is a better encoder (e.g. a domain-specific surface-drilling Omega encoder), not per-well reference data. To swap encoders, change `OMEGA_MODEL` in both `src/lib/server/newton.js` and `scripts/build-knn-library.js`, then rebuild the library.

### 4× slower classification update rate at w128

Each 128-sample window takes ~640ms to accumulate during playback vs ~160ms at w32. The dashboard feels less "live" but each prediction is more reliable. A future improvement could use overlapping windows (`window=128, step=32`) for 4× more frequent predictions without losing context, but this wasn't tested with the optimizer.

### Direct Query latency

Each window fans out 9 per-channel `/query` calls (bounded to 6 concurrent, with retries). On staging that's roughly 1–2 s per window, so at fast playback the classification log trails the rig slightly — the UI classifies windows one at a time (guarded so playback never fans out overlapping calls) and catches up between transitions. The n-shot library is precomputed offline, so there's no per-session warm-up wait.

## Data Attribution

The drilling sensor data used in these examples is from the **Equinor Volve Data Village**, released under a modified CC BY 4.0 license. The data may be used for commercial and non-commercial purposes but may not be resold.

> Data provided by Equinor and the former Volve license partners (ExxonMobil Exploration & Production Norway AS and Bayerngas Norge AS). [Terms and Conditions](https://www.equinor.com/energy/volve-data-sharing).
