export async function fetchWells() {
	const res = await fetch('/api/wells');
	if (!res.ok) throw new Error('Failed to fetch wells');
	return res.json();
}

export async function fetchMixedOffset(wellFile, windowSize = 128, numWindows = 100) {
	const res = await fetch(
		`/api/wells/mixed-offset?well=${encodeURIComponent(wellFile)}&windowSize=${windowSize}&numWindows=${numWindows}`
	);
	if (!res.ok) return { offset: 0, mix: 0 };
	return res.json();
}

// Classify one window of sensor rows via Direct Query + local KNN.
// Returns { label: 'DRILLING'|'NOT_DRILLING', votes, neighbors }.
export async function classifyWindow(rows, k) {
	const res = await fetch('/api/classify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ rows, k })
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err.error || 'Classify failed');
	}
	return res.json();
}

export async function fetchWellChunk(wellFile, offset = 0, limit = 5000) {
	const res = await fetch(
		`/api/wells/data?well=${encodeURIComponent(wellFile)}&offset=${offset}&limit=${limit}`
	);
	if (!res.ok) throw new Error('Failed to fetch well data');
	return res.json();
}
