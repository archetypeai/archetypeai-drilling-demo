# Newton Drilling Monitor

Drilling state classification dashboard powered by [Newton](https://www.archetypeai.dev/) and the [Equinor Volve Data Village](https://www.equinor.com/energy/volve-data-sharing).

Plays back real drilling sensor data from 14 wells in the Volve oil field (North Sea, 2007-2016) and uses Newton's Machine State Lens to classify each data window as **drilling** or **not_drilling** in real-time via SSE streaming.

![Newton Drilling Monitor](static/demo.png)

## Features

- **14 wells** from the Volve North Sea oil field — select any well to explore its sensor data
- **Sensor chart** — 5 drilling channels (ROP, RPM, Pressure, Weight on Bit, Hookload) with playback
- **Playback controls** — play, pause, reset with progress bar
- **Machine State classification** — Newton classifies each 100-sample window as drilling or not_drilling
- **Classification bands** — color-coded overlay on the sensor chart (cyan = drilling, orange = not drilling)
- **Classification log** — scrolling list of predictions with drilling/not-drilling counts
- **N-shot learning** — 2,000 labeled examples per class uploaded to Newton for KNN classification
- **SSE streaming** — results arrive in real-time as windows are processed

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
| HKLD | Hookload | kkgf |
| ROP | Rate of Penetration | m/h |
| RPM | Rotary Speed | rpm |
| SPPA | Standpipe Pressure | kPa |
| WOB | Weight on Bit | kkgf |

**Drilling** = bit on bottom, rotating, mud flowing, hole getting deeper. **Not drilling** = tripping, circulating, shut in, etc.

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

1. Select a well — 5,000 downsampled rows load from the pre-processed CSV
2. **Start Analysis** uploads n-shot CSV files (2,000 drilling + 2,000 not_drilling examples), creates a Machine State Lens session, and connects SSE
3. Press **Play** — data plays back at accelerated speed, advancing the chart playhead
4. As the playhead passes each 100-sample window boundary, the window is streamed to Newton
5. Newton's Machine State Lens computes OmegaEncoder embeddings, runs KNN against n-shot examples, and returns a classification via SSE
6. Results appear as colored bands on the sensor chart and entries in the classification log

## Architecture

```
src/
├── routes/
│   ├── +page.svelte                  # Dashboard orchestrator
│   └── api/
│       ├── session/+server.js        # Newton lens session lifecycle
│       ├── wells/+server.js          # List available wells
│       ├── stream/+server.js         # Stream data windows to Newton
│       └── sse-proxy/+server.js      # Proxy Newton SSE to browser
├── lib/
│   ├── server/newton.js              # Machine State Lens API client
│   ├── api/drilling.js               # Client-side fetch wrappers
│   └── components/ui/custom/
│       ├── well-selector.svelte      # 14-well button grid
│       ├── sensor-chart.svelte       # Multi-channel SVG chart + classification bands
│       ├── classification-log.svelte # Prediction history + stats
│       └── playback-controls.svelte  # Play/pause/reset + progress
└── static/data/
    ├── volve_drilling.csv            # N-shot examples (drilling)
    ├── volve_not_drilling.csv        # N-shot examples (not_drilling)
    └── wells/                        # 14 downsampled well CSVs (5,000 rows each)
```

## Newton API Pattern

This demo uses the **Machine State Lens** — the third Newton API pattern:

| Pattern | Used In | API |
|---------|---------|-----|
| Vision (lens session + model.query) | Traffic, Wildfire | Image → classification |
| Text reasoning (direct query) | Earthquake, Grid | Structured text → analysis |
| **Machine State (lens session + SSE)** | **Drilling** | **Time-series → state classification** |

## Data Attribution

The drilling sensor data used in these examples is from the **Equinor Volve Data Village**, released under a modified CC BY 4.0 license. The data may be used for commercial and non-commercial purposes but may not be resold.

> Data provided by Equinor and the former Volve license partners (ExxonMobil Exploration & Production Norway AS and Bayerngas Norge AS). [Terms and Conditions](https://www.equinor.com/energy/volve-data-sharing).
