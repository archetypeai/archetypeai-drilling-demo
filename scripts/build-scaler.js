#!/usr/bin/env node
// Compute a per-channel StandardScaler (mean + std) over the n-shot reference
// pool (the two Volve drilling/not-drilling CSVs). Used to pre-normalize every
// window before sending to /query, with `normalize_input: false` so Omega sees
// consistent amplitudes across windows.
//
// Without this, /query would have to normalize per-window, which erases
// cross-window amplitude signal. The recommended pattern (atai-newton-omega-model)
// is to fit one global scaler on the reference pool and apply it everywhere.
//
// Usage:  node scripts/build-scaler.js
// Output: data/scaler.json  { columns, mean: {col:m}, std: {col:s}, config }

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const DATA_COLUMNS = ['BPOS', 'DBTM', 'FLWI', 'HDTH', 'HKLD', 'ROP', 'RPM', 'SPPA', 'WOB'];
const SOURCES = ['static/data/volve_drilling.csv', 'static/data/volve_not_drilling.csv'];

function readCsv(filePath) {
	const text = readFileSync(filePath, 'utf-8');
	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	const headers = lines[0].split(',').map((h) => h.trim());
	const rows = lines.slice(1).map((line) => line.split(','));
	return { headers, rows };
}

function main() {
	const stats = {};
	for (const col of DATA_COLUMNS) stats[col] = { sum: 0, sumsq: 0, n: 0 };

	for (const src of SOURCES) {
		const { headers, rows } = readCsv(resolve(src));
		const colIdx = DATA_COLUMNS.map((c) => headers.indexOf(c));
		if (colIdx.some((i) => i < 0)) throw new Error(`Missing column in ${src}`);
		for (const row of rows) {
			for (let i = 0; i < DATA_COLUMNS.length; i++) {
				const v = parseFloat(row[colIdx[i]]);
				if (Number.isNaN(v)) continue;
				const s = stats[DATA_COLUMNS[i]];
				s.sum += v;
				s.sumsq += v * v;
				s.n += 1;
			}
		}
		console.log(`  ${src}: ${rows.length} rows`);
	}

	const mean = {};
	const std = {};
	for (const col of DATA_COLUMNS) {
		const { sum, sumsq, n } = stats[col];
		const m = sum / n;
		const variance = Math.max(0, sumsq / n - m * m);
		const s = Math.sqrt(variance);
		mean[col] = m;
		// Avoid divide-by-zero for constant channels: (x - mean) preserves structure.
		std[col] = s > 1e-9 ? s : 1;
	}

	const out = {
		columns: DATA_COLUMNS,
		mean,
		std,
		config: { samplesUsed: stats[DATA_COLUMNS[0]].n, builtAt: new Date().toISOString() }
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
