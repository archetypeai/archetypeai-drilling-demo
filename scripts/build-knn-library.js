#!/usr/bin/env node
// Build the n-shot KNN library from the held-out reference wells
// (src/lib/reference-wells.js) — NOT from the wells the demo classifies, so the
// split is leakage-free.
//
// For each reference well it slides a window across the rows; a window whose
// ACTC codes are unanimously drilling (1/2) or not-drilling (3/4/8/9) becomes a
// labeled reference, mixed/other windows are skipped. The unanimous windows are
// pooled per class across the reference wells and evenly subsampled to CAP each
// (a balanced library that doesn't take forever to embed), then each window is
// embedded per-channel via /query and concatenated.
//
// Output: data/knn-library.json
//   { config: { windowSize, stepSize, model, referenceWells, builtAt },
//     columns: [...],
//     embeddings: [{ label: 'DRILLING'|'NOT_DRILLING', vec: number[] }, ...] }
//
// Usage: node scripts/build-knn-library.js [--window=128] [--step=128] [--cap=18]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { REFERENCE_WELLS, ACTC_DRILLING, ACTC_NOT_DRILLING } from '../src/lib/reference-wells.js';

const DATA_COLUMNS = ['BPOS', 'DBTM', 'FLWI', 'HDTH', 'HKLD', 'ROP', 'RPM', 'SPPA', 'WOB'];
const MODEL = 'OmegaEncoder::omega_embeddings_1_4';
const WELLS_DIR = 'static/data/wells';
const DRILL = new Set(ACTC_DRILLING);
const NOT = new Set(ACTC_NOT_DRILLING);

const SCALER_PATH = resolve('data/scaler.json');
const SCALER = existsSync(SCALER_PATH) ? JSON.parse(readFileSync(SCALER_PATH, 'utf-8')) : null;
if (!SCALER) {
	console.error('Missing data/scaler.json — run `node scripts/build-scaler.js` first.');
	process.exit(1);
}
const SCALE_CLIP = 10; // must match src/lib/server/newton.js
function applyScaler(channelFirstWindow, columns) {
	const out = new Array(columns.length);
	for (let c = 0; c < columns.length; c++) {
		const m = SCALER.mean[columns[c]] ?? 0;
		const s = SCALER.std[columns[c]] ?? 1;
		const src = channelFirstWindow[c];
		const dst = new Array(src.length);
		for (let i = 0; i < src.length; i++) {
			const z = (src[i] - m) / s;
			dst[i] = z > SCALE_CLIP ? SCALE_CLIP : z < -SCALE_CLIP ? -SCALE_CLIP : z;
		}
		out[c] = dst;
	}
	return out;
}

function loadEnv() {
	const env = {};
	for (const line of readFileSync('.env', 'utf-8').split('\n')) {
		const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
		if (m) env[m[1]] = m[2].trim();
	}
	return env;
}

function parseArgs() {
	const args = { window: 128, step: 128, cap: 18 };
	for (const a of process.argv.slice(2)) {
		const m = a.match(/^--(\w+)=(\d+)$/);
		if (m) args[m[1]] = parseInt(m[2]);
	}
	return args;
}

function readCsv(filePath) {
	const text = readFileSync(filePath, 'utf-8');
	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	const headers = lines[0].split(',').map((h) => h.trim());
	return { headers, rows: lines.slice(1).map((l) => l.split(',')) };
}

// Collect unanimous-label windows (channel-first 2D) from one well.
function collectWindows(well, windowSize, stepSize) {
	const { headers, rows } = readCsv(resolve(WELLS_DIR, well));
	const colIdx = DATA_COLUMNS.map((c) => headers.indexOf(c));
	const actcIdx = headers.indexOf('ACTC');
	if (colIdx.some((i) => i < 0) || actcIdx < 0) throw new Error(`${well}: missing column`);
	const found = { DRILLING: [], NOT_DRILLING: [] };
	for (let start = 0; start + windowSize <= rows.length; start += stepSize) {
		let allD = true;
		let allN = true;
		for (let r = 0; r < windowSize; r++) {
			const code = rows[start + r][actcIdx]?.trim();
			if (DRILL.has(code)) allN = false;
			else if (NOT.has(code)) allD = false;
			else {
				allD = false;
				allN = false;
			}
		}
		const label = allD ? 'DRILLING' : allN ? 'NOT_DRILLING' : null;
		if (!label) continue;
		const win = colIdx.map((ci) => {
			const ch = new Array(windowSize);
			for (let r = 0; r < windowSize; r++) {
				const v = parseFloat(rows[start + r][ci]);
				ch[r] = isNaN(v) ? 0 : v;
			}
			return ch;
		});
		found[label].push(win);
	}
	return found;
}

// Evenly subsample `cap` windows across the pool (temporal diversity, deterministic).
function subsample(arr, cap) {
	if (arr.length <= cap) return arr;
	const step = arr.length / cap;
	const out = [];
	for (let i = 0; i < cap; i++) out.push(arr[Math.floor(i * step)]);
	return out;
}

async function queryOmegaChannel(endpoint, apiKey, channel) {
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			query: '',
			model: MODEL,
			normalize_input: false,
			events: [{ type: 'data.numeric_array', event_data: { contents: [channel] } }]
		})
	});
	if (!res.ok) throw new Error(`/query failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
	const data = await res.json();
	const vec = data.response?.response;
	if (!Array.isArray(vec) || typeof vec[0] !== 'number') {
		throw new Error(`unexpected response shape: ${JSON.stringify(data).slice(0, 300)}`);
	}
	return vec;
}

async function embedWindow(endpoint, apiKey, channelFirstWindow) {
	const perChannel = await Promise.all(
		channelFirstWindow.map((ch) => queryOmegaChannel(endpoint, apiKey, ch))
	);
	const cols = perChannel[0].length;
	const out = new Array(perChannel.length * cols);
	for (let r = 0; r < perChannel.length; r++) {
		for (let c = 0; c < cols; c++) out[r * cols + c] = perChannel[r][c];
	}
	return out;
}

async function main() {
	const env = loadEnv();
	const args = parseArgs();
	const endpoint = env.ATAI_API_ENDPOINT.replace(/\/$/, '') + '/v0.5/query';
	console.log(`Endpoint: ${endpoint}`);
	console.log(`Window: ${args.window}, Step: ${args.step}, Cap/class: ${args.cap}`);
	console.log(`Reference wells: ${REFERENCE_WELLS.join(', ')}`);

	// Pool unanimous windows per class across the reference wells.
	const pool = { DRILLING: [], NOT_DRILLING: [] };
	for (const well of REFERENCE_WELLS) {
		const found = collectWindows(well, args.window, args.step);
		pool.DRILLING.push(...found.DRILLING);
		pool.NOT_DRILLING.push(...found.NOT_DRILLING);
		console.log(
			`  ${well}: ${found.DRILLING.length} drilling / ${found.NOT_DRILLING.length} not-drilling windows`
		);
	}

	const selected = {
		DRILLING: subsample(pool.DRILLING, args.cap),
		NOT_DRILLING: subsample(pool.NOT_DRILLING, args.cap)
	};
	console.log(
		`Selected: ${selected.DRILLING.length} drilling + ${selected.NOT_DRILLING.length} not-drilling`
	);

	const embeddings = [];
	const t0 = Date.now();
	for (const label of ['DRILLING', 'NOT_DRILLING']) {
		for (const win of selected[label]) {
			const scaled = applyScaler(win, DATA_COLUMNS);
			let attempt = 0;
			while (true) {
				try {
					embeddings.push({ label, vec: await embedWindow(endpoint, env.ATAI_API_KEY, scaled) });
					break;
				} catch (err) {
					if (++attempt >= 6) throw err;
					await new Promise((r) => setTimeout(r, 1000 * attempt));
				}
			}
		}
		console.log(`  embedded ${label}: ${selected[label].length}`);
	}

	const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
	const lib = {
		config: {
			windowSize: args.window,
			stepSize: args.step,
			model: MODEL,
			referenceWells: REFERENCE_WELLS,
			builtAt: new Date().toISOString()
		},
		columns: DATA_COLUMNS,
		embeddings
	};

	const outPath = resolve('data/knn-library.json');
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, JSON.stringify(lib));
	const sizeMb = (readFileSync(outPath).length / 1024 / 1024).toFixed(2);
	console.log(`\nWrote ${outPath} (${sizeMb} MB, ${embeddings.length} windows) in ${elapsed}s`);
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
