import { json } from '@sveltejs/kit';
import { classifyWindow, DEFAULT_CONFIG } from '$lib/server/newton.js';

// Synchronous per-window classification via Direct Query + local KNN.
// Replaces the SSE session/stream routes from the Lens version.
//   Request:  { rows: [{ BPOS: '...', ... }, ...], k? }   length == windowSize
//   Response: { label: 'DRILLING'|'NOT_DRILLING', votes, neighbors: [...] }
export async function POST({ request }) {
	try {
		const { rows, k } = await request.json();
		if (!Array.isArray(rows) || rows.length === 0) {
			return json({ error: 'Missing or empty rows' }, { status: 400 });
		}
		const result = await classifyWindow(rows, { k: k || DEFAULT_CONFIG.nNeighbors });
		return json(result);
	} catch (err) {
		return json({ error: err.message }, { status: 500 });
	}
}
