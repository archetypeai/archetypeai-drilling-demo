import { ATAI_API_KEY, ATAI_API_ENDPOINT } from '$env/static/private';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const API_VERSION = 'v0.5';
const OMEGA_MODEL = 'OmegaEncoder::omega_embeddings_1_4';

// The nine drilling sensor channels. Identical to the original Lens-based demo
// and to the n-shot CSV headers, so the same reference data builds the library.
export const DATA_COLUMNS = ['BPOS', 'DBTM', 'FLWI', 'HDTH', 'HKLD', 'ROP', 'RPM', 'SPPA', 'WOB'];

export const DEFAULT_CONFIG = {
	windowSize: 128,
	stepSize: 128,
	nNeighbors: 3
};

function apiUrl(path) {
	return `${ATAI_API_ENDPOINT.replace(/\/$/, '')}/${API_VERSION}${path}`;
}

// ──────────────────────────────────────────────────────────────────────
// Global per-channel robust scaler (data/scaler.json), loaded lazily.
// Pre-normalizing every window with these fixed stats — and passing
// normalize_input=false to Omega — preserves cross-window amplitude signal
// that per-window normalization would erase. See scripts/build-scaler.js.
// Scaled values are clipped to ±SCALE_CLIP so sensor-glitch sentinels in the
// raw well data (e.g. SPPA spikes to ~1e31) can't dominate the embedding. The
// library was built with the same clip, so live and reference stay comparable.
// ──────────────────────────────────────────────────────────────────────

const SCALE_CLIP = 10;

let SCALER = null;
let SCALER_ERROR = null;
function ensureScaler() {
	if (SCALER || SCALER_ERROR) return;
	const path = resolve('data/scaler.json');
	if (!existsSync(path)) {
		SCALER_ERROR = new Error(
			'Missing data/scaler.json — run `node scripts/build-scaler.js` first.'
		);
		return;
	}
	SCALER = JSON.parse(readFileSync(path, 'utf-8'));
}

function applyScaler(channelFirstWindow, columns) {
	ensureScaler();
	if (SCALER_ERROR) throw SCALER_ERROR;
	const out = new Array(columns.length);
	for (let c = 0; c < columns.length; c++) {
		const col = columns[c];
		const m = SCALER.mean[col] ?? 0;
		const s = SCALER.std[col] ?? 1;
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

// ──────────────────────────────────────────────────────────────────────
// KNN library (loaded once from data/knn-library.json)
// ──────────────────────────────────────────────────────────────────────

let LIBRARY = null;
let LIBRARY_ERROR = null;
function ensureLibrary() {
	if (LIBRARY || LIBRARY_ERROR) return;
	const path = resolve('data/knn-library.json');
	if (!existsSync(path)) {
		LIBRARY_ERROR = new Error(
			'Missing data/knn-library.json — run `node scripts/build-knn-library.js` first.'
		);
		return;
	}
	const raw = JSON.parse(readFileSync(path, 'utf-8'));
	raw.embeddings = raw.embeddings.map((e) => ({ label: e.label, vec: Float32Array.from(e.vec) }));
	LIBRARY = raw;
}

export function getLibraryConfig() {
	ensureLibrary();
	if (LIBRARY_ERROR) throw LIBRARY_ERROR;
	return LIBRARY.config;
}

// ──────────────────────────────────────────────────────────────────────
// Direct Query: Omega embedding (one /query per channel)
// ──────────────────────────────────────────────────────────────────────

const OMEGA_TIMEOUT_MS = 15000;

async function postQuery(body, timeoutMs = OMEGA_TIMEOUT_MS) {
	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(apiUrl('/query'), {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${ATAI_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body),
			signal: controller.signal
		});
		if (!res.ok) {
			const err = await res.text();
			throw new Error(`/query failed: ${res.status} ${err.slice(0, 300)}`);
		}
		return res.json();
	} finally {
		clearTimeout(t);
	}
}

// Bounded per-channel fan-out (matches the Omega skill's thread-pool / `embed()`
// pattern). One /query per channel, but cap how many run at once so a window's
// fan-out doesn't overrun a capacity-limited node. Each call retries transient
// failures (504 / timeout) instead of dropping the whole window.
const OMEGA_MAX_CONCURRENCY = 6;
const OMEGA_RETRIES = 3;

let omegaInFlight = 0;
const omegaQueue = [];
function withOmegaSlot(fn) {
	return new Promise((resolve, reject) => {
		const run = () => {
			omegaInFlight++;
			Promise.resolve()
				.then(fn)
				.then(resolve, reject)
				.finally(() => {
					omegaInFlight--;
					const next = omegaQueue.shift();
					if (next) next();
				});
		};
		if (omegaInFlight < OMEGA_MAX_CONCURRENCY) run();
		else omegaQueue.push(run);
	});
}

// Embed a single channel (flat 768-d vector), retrying transient failures.
async function embedChannel(channel) {
	let lastErr;
	for (let attempt = 0; attempt < OMEGA_RETRIES; attempt++) {
		try {
			const data = await postQuery({
				query: '',
				model: OMEGA_MODEL,
				// Pre-normalized at the call site via applyScaler(); Omega should NOT
				// re-normalize per-window or it would erase cross-window amplitude.
				normalize_input: false,
				events: [{ type: 'data.numeric_array', event_data: { contents: [channel] } }]
			});
			const vec = data.response?.response;
			if (!Array.isArray(vec) || typeof vec[0] !== 'number') {
				throw new Error(`unexpected Omega response shape: ${JSON.stringify(data).slice(0, 200)}`);
			}
			return vec;
		} catch (err) {
			lastErr = err;
			if (attempt < OMEGA_RETRIES - 1) {
				await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
			}
		}
	}
	throw lastErr;
}

// Send a [num_columns x window_size] channel-first array to Omega and return
// the per-channel 768-d embeddings concatenated into one Float32Array for KNN.
export async function embedWindow(channelFirstWindow) {
	const perChannel = await Promise.all(
		channelFirstWindow.map((channel) => withOmegaSlot(() => embedChannel(channel)))
	);
	const numChannels = perChannel.length;
	const dim = perChannel[0].length;
	const out = new Float32Array(numChannels * dim);
	for (let c = 0; c < numChannels; c++) {
		for (let d = 0; d < dim; d++) {
			out[c * dim + d] = perChannel[c][d];
		}
	}
	return out;
}

// ──────────────────────────────────────────────────────────────────────
// Local KNN classifier
// ──────────────────────────────────────────────────────────────────────

function euclideanSq(a, b) {
	let s = 0;
	for (let i = 0; i < a.length; i++) {
		const d = a[i] - b[i];
		s += d * d;
	}
	return s;
}

function classifyEmbedding(embedding, k = DEFAULT_CONFIG.nNeighbors) {
	ensureLibrary();
	if (LIBRARY_ERROR) throw LIBRARY_ERROR;
	const lib = LIBRARY.embeddings;
	const dists = new Array(lib.length);
	for (let i = 0; i < lib.length; i++) {
		dists[i] = { d: euclideanSq(lib[i].vec, embedding), label: lib[i].label };
	}
	dists.sort((a, b) => a.d - b.d);
	const top = dists.slice(0, k);
	const votes = {};
	for (const t of top) votes[t.label] = (votes[t.label] || 0) + 1;
	let winner = null;
	let max = -1;
	for (const [label, n] of Object.entries(votes)) {
		if (n > max) {
			max = n;
			winner = label;
		}
	}
	return {
		label: winner,
		votes,
		neighbors: top.map((t) => ({ label: t.label, dist: Math.sqrt(t.d) }))
	};
}

function extractWindow(rows, columns) {
	return columns.map((col) =>
		rows.map((row) => {
			const v = parseFloat(row[col]);
			return isNaN(v) ? 0 : v;
		})
	);
}

// Run Direct Query → KNN for one window of sensor rows.
// Returns { label, votes, neighbors }.
export async function classifyWindow(rows, { k = DEFAULT_CONFIG.nNeighbors } = {}) {
	const win = extractWindow(rows, DATA_COLUMNS);
	const scaled = applyScaler(win, DATA_COLUMNS);
	const embedding = await embedWindow(scaled);
	return classifyEmbedding(embedding, k);
}

export function getApiKey() {
	return ATAI_API_KEY;
}
