export async function fetchWells() {
	const res = await fetch('/api/wells');
	if (!res.ok) throw new Error('Failed to fetch wells');
	return res.json();
}

export async function startSession(onStep, config = {}) {
	const params = new URLSearchParams();
	for (const [key, val] of Object.entries(config)) {
		if (val !== undefined) params.set(key, String(val));
	}
	const url = `/api/session${params.toString() ? '?' + params.toString() : ''}`;

	return new Promise((resolve, reject) => {
		const es = new EventSource(url);

		es.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				if (data.type === 'step') {
					onStep?.(data.step);
				} else if (data.type === 'done') {
					es.close();
					resolve(data);
				} else if (data.type === 'error') {
					es.close();
					reject(new Error(data.error));
				}
			} catch {
				// ignore parse errors
			}
		};

		es.onerror = () => {
			es.close();
			reject(new Error('Connection to session setup failed'));
		};
	});
}

export async function fetchMixedOffset(wellFile, windowSize = 128, numWindows = 100) {
	const res = await fetch(`/api/wells/mixed-offset?well=${encodeURIComponent(wellFile)}&windowSize=${windowSize}&numWindows=${numWindows}`);
	if (!res.ok) return { offset: 0, mix: 0 };
	return res.json();
}

export async function streamWindowToNewton(sessionId, rows) {
	const res = await fetch('/api/stream', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ sessionId, rows })
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err.error || 'Stream failed');
	}
	return res.json();
}

export async function endSession(sessionId) {
	await fetch('/api/session', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ sessionId })
	});
}

export async function fetchWellChunk(wellFile, offset = 0, limit = 5000) {
	const res = await fetch(`/api/wells/data?well=${encodeURIComponent(wellFile)}&offset=${offset}&limit=${limit}`);
	if (!res.ok) throw new Error('Failed to fetch well data');
	return res.json();
}
