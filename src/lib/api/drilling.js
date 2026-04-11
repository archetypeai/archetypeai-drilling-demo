export async function fetchWells() {
	const res = await fetch('/api/wells');
	if (!res.ok) throw new Error('Failed to fetch wells');
	return res.json();
}

export async function startSession(onStep) {
	return new Promise((resolve, reject) => {
		const es = new EventSource('/api/session');

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
