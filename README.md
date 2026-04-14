# Newton Drilling Monitor

Drilling state classification dashboard powered by [Newton](https://www.archetypeai.dev/) and the [Equinor Volve Data Village](https://www.equinor.com/energy/volve-data-sharing).

Plays back real drilling sensor data from 14 wells in the Volve oil field (North Sea, 2007–2009 drilling phase) and uses Newton's Machine State Lens to classify each data window as **drilling** or **not_drilling** in real-time via SSE streaming. Includes live evaluation against ACTC ground truth.

> The Volve field operated 2007–2016, but real-time drilling sensor data only covers the 2007–2009 construction phase. After 2009 the rig left and the field moved to production (different file types, no real-time WITSML streams).

![Newton Drilling Monitor](static/demo.png)

## Features

- **14 wells** from the Volve North Sea oil field, sorted by class balance (wells with both drilling and not-drilling activity first)
- **Rig instrument panel** — SVG drilling rig with 10 live sensor sparklines (9 channels + ACTC ground truth)
- **Playback controls** — play, pause, reset with progress bar, human-friendly timestamps
- **Machine State classification** — Newton classifies each 128-sample window as drilling or not_drilling
- **Classification log** — scrolling list of predictions with drilling/not-drilling counts
- **N-shot learning** — 2,000 labeled examples per class (from batch repo, seed 42) uploaded to Newton for KNN
- **SSE streaming** — results arrive in real-time as windows are processed
- **Incremental data loading** — full raw CSVs (up to 1.9M rows) loaded in 5,000-row chunks during playback
- **Auto-seek** — automatically starts playback at the section with the best drilling/not-drilling balance (scored by unanimous windows, not raw rows)

### Advanced Mode (⚙)

- **Live Evaluation** — compares predictions against ACTC ground truth (unanimous windows only), shows accuracy, F1, precision, recall, confusion matrix, and per-window pass/fail log

## Tuning the Config

Hyperparameter search lives in a separate tool: [archetypeai/newton-streaming-optimizer](https://github.com/archetypeai/newton-streaming-optimizer) brute-forces a grid of window sizes / KNN params against the streaming API and outputs a ready-to-use config JSON. Drop the winning values into `DEFAULT_CONFIG` in `src/lib/server/newton.js` to apply them here.

The current default (`window=128, k=3, euclidean, uniform`) is the optimizer's top-ranked config on the bundled drilling slice. F1 climbed monotonically with window size: w32=85.4% → w64=97.1% → w128=100%. Re-run the optimizer against your own data if you want a different sensor set or balance.

## Notes on the Streaming Encoder

The streaming API uses `OmegaEncoder::omega_embeddings_01` (generic time-series encoder). On the optimizer's balanced 200K-row drilling slice, the tuned w128 config reaches **macro F1 = 100%** (99 unanimous test windows). On full-file evaluation with `classify.py` across the same slice: **F1 = 94.6%** (1,465 unanimous windows).

**Per-well numbers in the live demo are lower.** Observed during testing:

| Well | F1 | Notes |
|---|---:|---|
| F-15S | ~94% | Best — large, balanced well |
| F-1 | ~63% | Conservative drilling predictions (high precision, low recall) |
| F-5 (NA) | ~57% | |
| F-7 | ~45% | High transition activity → many skipped windows |

The gap between optimizer numbers (94–100%) and per-well reality (45–94%) is due to distribution shift: the generic n-shot examples were extracted from one region of the dataset and don't equally represent the operational patterns of every well.

The batch pipeline's `omega_1_3_surface` (domain-specific surface drilling encoder) achieves higher accuracy on the broader drilling distribution but is not yet available for the streaming/lens API.

## Stack

- **SvelteKit** with Svelte 5 runes
- **Archetype AI Design System** — semantic tokens, component primitives, composite patterns
- **Newton Machine State Lens** — `lens_timeseries_state_processor` with OmegaEncoder embeddings + KNN
- **SSE** — Server-Sent Events for real-time classification results
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

## Development

```bash
npm run dev
```

Open `http://localhost:5173`, select a well, click **Start Analysis**, then press Play.

## How It Works

1. Select a well — data loads incrementally from full raw CSVs (up to 1.9M rows per well)
2. **Start Analysis** uploads n-shot CSV files (2,000 drilling + 2,000 not_drilling), creates a Machine State Lens session, and connects SSE
3. Press **Play** — data plays back at accelerated speed, advancing the rig sparklines and playhead
4. As the playhead passes each 128-sample window boundary, the window is streamed to Newton
5. Newton computes OmegaEncoder embeddings, runs KNN against n-shot examples, returns classification via SSE
6. Results appear as colored bands on the rig and entries in the classification log

## Architecture

```
src/
├── routes/
│   ├── +page.svelte                  # Dashboard orchestrator
│   └── api/
│       ├── session/+server.js        # Newton lens session lifecycle (SSE progress)
│       ├── wells/+server.js          # List wells sorted by class balance
│       ├── wells/data/+server.js     # Paginated well data chunks
│       ├── wells/mixed-offset/       # Find best mixed section (auto-seek)
│       ├── stream/+server.js         # Stream data windows to Newton
│       └── sse-proxy/+server.js      # Proxy Newton SSE to browser
├── lib/
│   ├── server/newton.js              # Machine State Lens API (DEFAULT_CONFIG)
│   ├── api/drilling.js               # Client-side fetch wrappers
│   └── components/ui/custom/
│       ├── rig-dashboard.svelte      # SVG rig + 10 sensor sparklines
│       ├── classification-log.svelte # Prediction history + stats
│       ├── accuracy-panel.svelte     # Live Evaluation (accuracy, F1, confusion matrix)
│       ├── playback-controls.svelte  # Play/pause/reset + progress
│       └── well-selector.svelte      # Well button grid
└── static/data/
    ├── volve_drilling.csv            # N-shot examples (2,000 drilling rows)
    ├── volve_not_drilling.csv        # N-shot examples (2,000 not-drilling rows)
    └── wells/                        # 14 full raw well CSVs (Git LFS)
```

## Newton API Pattern

This demo uses the **Machine State Lens** — the third Newton API pattern:

| Pattern | Used In | API |
|---------|---------|-----|
| Vision (lens session + model.query) | Traffic, Wildfire | Image → classification |
| Text reasoning (direct query) | Earthquake, Grid | Structured text → analysis |
| **Machine State (lens session + SSE)** | **Drilling** | **Time-series → state classification** |

## Newton Config

Optimized via [newton-streaming-optimizer](https://github.com/archetypeai/newton-streaming-optimizer):

```json
{
  "model_name": "OmegaEncoder",
  "model_version": "OmegaEncoder::omega_embeddings_01",
  "normalize_input": true,
  "buffer_size": 128,
  "csv_configs": {
    "timestamp_column": "DATE_TIME",
    "data_columns": ["BPOS", "DBTM", "FLWI", "HDTH", "HKLD", "ROP", "RPM", "SPPA", "WOB"],
    "window_size": 128,
    "step_size": 128
  },
  "knn_configs": {
    "n_neighbors": 3,
    "metric": "euclidean",
    "weights": "uniform",
    "algorithm": "ball_tree",
    "normalize_embeddings": false
  }
}
```

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

We tested extracting n-shot examples from each well's own data (per-well prep). Counterintuitively, this performed **worse** than the generic multi-well n-shots (F-7: 40% F1 per-well vs 80% F1 generic). The generic examples are more diverse and capture a broader range of drilling/not-drilling signatures. The right lever for improving accuracy is a better encoder (e.g., `omega_1_3_surface`), not per-well reference data.

### 4× slower classification update rate at w128

Each 128-sample window takes ~640ms to accumulate during playback vs ~160ms at w32. The dashboard feels less "live" but each prediction is more reliable. A future improvement could use overlapping windows (`window=128, step=32`) for 4× more frequent predictions without losing context, but this wasn't tested with the optimizer.

### Session settle time

Each Newton session requires ~60 seconds after creation for the KNN index to finish building from the n-shot files. During this time the dashboard shows "Connecting...". This is a platform-level constraint — the session reports READY before the index is fully loaded.

## Data Attribution

The drilling sensor data used in these examples is from the **Equinor Volve Data Village**, released under a modified CC BY 4.0 license. The data may be used for commercial and non-commercial purposes but may not be resold.

> Data provided by Equinor and the former Volve license partners (ExxonMobil Exploration & Production Norway AS and Bayerngas Norge AS). [Terms and Conditions](https://www.equinor.com/energy/volve-data-sharing).
