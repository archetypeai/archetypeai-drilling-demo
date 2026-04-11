export async function fetchWells() {
	const res = await fetch('/api/wells');
	if (!res.ok) throw new Error('Failed to fetch wells');
	return res.json();
}

export async function startSession() {
	const res = await fetch('/api/session', { method: 'POST' });
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err.error || 'Failed to create session');
	}
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

export async function fetchWellData(wellFile) {
	const res = await fetch(`/data/wells/${wellFile}`);
	if (!res.ok) throw new Error('Failed to fetch well data');
	const text = await res.text();

	const lines = text.trim().split('\n');
	const headers = lines[0].split(',');
	return lines.slice(1).map((line) => {
		const values = line.split(',');
		const row = {};
		headers.forEach((h, i) => {
			row[h.trim()] = values[i]?.trim() ?? '';
		});
		return row;
	});
}
