#!/usr/bin/env node
// Compute a per-channel ROBUST scaler (median + IQR) over the held-out reference
// wells (see src/lib/reference-wells.js). Used to pre-normalize every window
// before /query, with `normalize_input: false` so Omega sees consistent
// amplitudes across windows. Fitting on the reference pool only (not the wells
// we classify) keeps the split leakage-free.
//
// Why robust (median/IQR) instead of mean/std: the raw Volve well files contain
// sensor-glitch sentinels (e.g. F-10's SPPA spikes to ~6e31), which would blow
// up mean/std. Median + IQR ignore those tails. The center/scale are still
// stored under the `mean`/`std` keys so the runtime applyScaler is unchanged;
// glitch *inputs* at classify time are additionally clipped (see newton.js).
//
// Usage:  node scripts/build-scaler.js
// Output: data/scaler.json  { columns, mean: {col:center}, std: {col:scale}, config }

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { REFERENCE_WELLS } from '../src/lib/reference-wells.js';

const DATA_COLUMNS = ['BPOS', 'DBTM', 'FLWI', 'HDTH', 'HKLD', 'ROP', 'RPM', 'SPPA', 'WOB'];
const WELLS_DIR = 'static/data/wells';
const SAMPLE_EVERY = 5; // subsample rows for the percentile estimate (memory-bounded)

function percentile(sorted, q) {
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
}

function main() {
	const samples = {};
	for (const col of DATA_COLUMNS) samples[col] = [];

	for (const well of REFERENCE_WELLS) {
		const lines = readFileSync(resolve(WELLS_DIR, well), 'utf-8')
			.split(/\r?\n/)
			.filter((l) => l.trim());
		const headers = lines[0].split(',').map((h) => h.trim());
		const colIdx = DATA_COLUMNS.map((c) => headers.indexOf(c));
		if (colIdx.some((i) => i < 0)) throw new Error(`Missing column in ${well}`);
		let count = 0;
		for (let r = 1; r < lines.length; r += SAMPLE_EVERY) {
			const row = lines[r].split(',');
			for (let i = 0; i < DATA_COLUMNS.length; i++) {
				const v = parseFloat(row[colIdx[i]]);
				if (Number.isFinite(v)) samples[DATA_COLUMNS[i]].push(v);
			}
			count++;
		}
		console.log(`  ${well}: ${lines.length - 1} rows (sampled ~${count})`);
	}

	const mean = {}; // center (median)
	const std = {}; // scale (IQR / 1.349 ≈ robust std)
	for (const col of DATA_COLUMNS) {
		const s = samples[col].sort((a, b) => a - b);
		const median = percentile(s, 0.5);
		const iqr = percentile(s, 0.75) - percentile(s, 0.25);
		mean[col] = median;
		std[col] = iqr > 1e-9 ? iqr / 1.349 : 1; // avoid divide-by-zero for constant channels
	}

	const out = {
		columns: DATA_COLUMNS,
		mean,
		std,
		config: {
			method: 'robust (median + IQR/1.349)',
			referenceWells: REFERENCE_WELLS,
			samplesUsed: samples[DATA_COLUMNS[0]].length,
			builtAt: new Date().toISOString()
		}
	};

	const outPath = resolve('data/scaler.json');
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, JSON.stringify(out, null, 2));
	console.log(`\nWrote ${outPath} from ${out.config.samplesUsed} samples per channel`);
	for (const col of DATA_COLUMNS) {
		console.log(`  ${col}: mean=${mean[col].toFixed(3)}, std=${std[col].toFixed(3)}`);
	}
}

main();
