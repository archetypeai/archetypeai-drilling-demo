import { json } from '@sveltejs/kit';
import {
	createDrillingSession,
	destroySession,
	getSSEUrl,
	getApiKey
} from '$lib/server/newton.js';

export async function POST() {
	try {
		const { sessionId, lensId } = await createDrillingSession();
		return json({
			sessionId,
			lensId,
			sseUrl: getSSEUrl(sessionId),
			apiKey: getApiKey()
		});
	} catch (err) {
		return json({ error: err.message }, { status: 500 });
	}
}

export async function DELETE({ request }) {
	try {
		const { sessionId } = await request.json();
		await destroySession(sessionId);
		return json({ ok: true });
	} catch (err) {
		return json({ error: err.message }, { status: 500 });
	}
}
