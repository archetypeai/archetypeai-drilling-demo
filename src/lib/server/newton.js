import { ATAI_API_KEY, ATAI_API_ENDPOINT } from '$env/static/private';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const API_VERSION = 'v0.5';
const LENS_NAME = 'volve-drilling-lens';

function apiUrl(path) {
	return `${ATAI_API_ENDPOINT.replace(/\/$/, '')}/${API_VERSION}${path}`;
}

async function apiGet(path) {
	const res = await fetch(apiUrl(path), {
		headers: { Authorization: `Bearer ${ATAI_API_KEY}` }
	});
	if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
	return res.json();
}

async function apiPost(path, body, timeoutMs = 10000) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(apiUrl(path), {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${ATAI_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body),
			signal: controller.signal
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(`POST ${path} failed: ${res.status} - ${JSON.stringify(err)}`);
		}
		return res.json();
	} finally {
		clearTimeout(timeoutId);
	}
}

async function uploadFile(filePath) {
	const formData = new FormData();
	const fileBuffer = readFileSync(filePath);
	const blob = new Blob([fileBuffer], { type: 'text/csv' });
	formData.append('file', blob, filePath.split('/').pop());

	const res = await fetch(apiUrl('/files'), {
		method: 'POST',
		headers: { Authorization: `Bearer ${ATAI_API_KEY}` },
		body: formData
	});
	if (!res.ok) throw new Error(`File upload failed: ${res.status}`);
	return res.json();
}

async function cleanStaleLenses() {
	const lenses = await apiGet('/lens/metadata');
	const stale = Array.isArray(lenses)
		? lenses.find((l) => l.lens_name === LENS_NAME)
		: null;
	if (stale) {
		await apiPost('/lens/delete', { lens_id: stale.lens_id });
	}
}

async function waitForSession(sessionId, maxWaitMs = 60000) {
	const start = Date.now();
	while (Date.now() - start < maxWaitMs) {
		const status = await apiPost(
			'/lens/sessions/events/process',
			{ session_id: sessionId, event: { type: 'session.status' } },
			10000
		);
		const s = status.session_status;
		if (s === 'LensSessionStatus.SESSION_STATUS_RUNNING' || s === '3') return true;
		if (s === 'LensSessionStatus.SESSION_STATUS_FAILED' || s === '6') return false;
		await new Promise((r) => setTimeout(r, 1000));
	}
	return false;
}

// Optimized via newton-streaming-optimizer:
// w64 k3 manhattan distance → F1=93.0% Acc=94.9% on examples/drilling/inference.csv
// (drilling: P=100% R=93.6% F1=96.7% / not_drilling: P=80.8% R=100% F1=89.4%)
const DEFAULT_CONFIG = {
	windowSize: 64,
	stepSize: 64,
	nNeighbors: 3,
	metric: 'manhattan',
	weights: 'distance',
	algorithm: 'ball_tree',
	normalizeEmbeddings: false
};
const DATA_COLUMNS = ['BPOS', 'DBTM', 'FLWI', 'HDTH', 'HKLD', 'ROP', 'RPM', 'SPPA', 'WOB'];

// Cache uploaded file IDs so we don't re-upload for each session
let cachedDrillingFileId = null;
let cachedNotDrillingFileId = null;

export async function createDrillingSession() {
	return createDrillingSessionWithProgress(() => {});
}

export async function createDrillingSessionWithProgress(onStep, config = {}) {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	const lensName = `${LENS_NAME}-${Date.now()}`;

	onStep('Cleaning stale lenses...');
	await cleanStaleLenses();

	if (!cachedDrillingFileId || !cachedNotDrillingFileId) {
		onStep('Uploading drilling examples (2,000 rows)...');
		const drillingUpload = await uploadFile(resolve('static/data/volve_drilling.csv'));
		cachedDrillingFileId = drillingUpload.file_id;

		onStep('Uploading not-drilling examples (2,000 rows)...');
		const notDrillingUpload = await uploadFile(resolve('static/data/volve_not_drilling.csv'));
		cachedNotDrillingFileId = notDrillingUpload.file_id;
	} else {
		onStep('Using cached n-shot files...');
	}

	const lensConfig = {
		lens_name: lensName,
		lens_config: {
			model_pipeline: [
				{ processor_name: 'lens_timeseries_state_processor', processor_config: {} }
			],
			model_parameters: {
				model_name: 'OmegaEncoder',
				model_version: 'OmegaEncoder::omega_embeddings_01',
				normalize_input: true,
				buffer_size: cfg.windowSize,
				input_n_shot: {
					DRILLING: cachedDrillingFileId,
					NOT_DRILLING: cachedNotDrillingFileId
				},
				csv_configs: {
					timestamp_column: 'DATE_TIME',
					data_columns: DATA_COLUMNS,
					window_size: cfg.windowSize,
					step_size: cfg.stepSize
				},
				knn_configs: {
					n_neighbors: cfg.nNeighbors,
					metric: cfg.metric,
					weights: cfg.weights,
					algorithm: cfg.algorithm,
					normalize_embeddings: cfg.normalizeEmbeddings
				}
			},
			output_streams: [{ stream_type: 'server_sent_events_writer' }]
		}
	};

	onStep('Registering Machine State Lens...');
	const lens = await apiPost('/lens/register', { lens_config: lensConfig }, 30000);

	onStep('Creating session...');
	const session = await apiPost('/lens/sessions/create', { lens_id: lens.lens_id });
	const sessionId = session.session_id;

	onStep('Waiting for session to be ready (processing n-shot examples)...');
	const ready = await waitForSession(sessionId);
	if (!ready) throw new Error('Drilling session failed to start');

	return { sessionId, lensId: lens.lens_id };
}

export async function streamWindow(sessionId, sensorData, counter) {
	return apiPost(
		'/lens/sessions/events/process',
		{
			session_id: sessionId,
			event: {
				type: 'session.update',
				event_data: {
					type: 'data.json',
					event_data: {
						sensor_data: sensorData,
						sensor_metadata: {
							sensor_timestamp: Date.now() / 1000,
							sensor_id: `well_sensor_${counter}`
						}
					}
				}
			}
		},
		15000
	);
}

export function getSSEUrl(sessionId) {
	return apiUrl(`/lens/sessions/consumer/${sessionId}`);
}

export function getApiKey() {
	return ATAI_API_KEY;
}

export async function destroySession(sessionId) {
	await apiPost('/lens/sessions/destroy', { session_id: sessionId });
}

export { DEFAULT_CONFIG, DATA_COLUMNS };
