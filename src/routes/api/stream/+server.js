import { json } from '@sveltejs/kit';
import { streamWindow, DATA_COLUMNS, WINDOW_SIZE, STEP_SIZE } from '$lib/server/newton.js';

export async function POST({ request }) {
	try {
		const { sessionId, rows } = await request.json();
		if (!sessionId || !rows || !rows.length) {
			return json({ error: 'Missing sessionId or rows' }, { status: 400 });
		}

		// Transpose rows to channel-first format: [[col1_vals], [col2_vals], ...]
		const sensorData = DATA_COLUMNS.map((col) =>
			rows.map((row) => {
				const val = parseFloat(row[col]);
				return isNaN(val) ? 0 : val;
			})
		);

		await streamWindow(sessionId, sensorData, Date.now());
		return json({ ok: true, windowSize: rows.length });
	} catch (err) {
		return json({ error: err.message }, { status: 500 });
	}
}
