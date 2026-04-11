import { json } from '@sveltejs/kit';
import {
	createDrillingSessionWithProgress,
	destroySession,
	getSSEUrl,
	getApiKey
} from '$lib/server/newton.js';

export async function GET() {
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			function sendStep(step) {
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify({ type: 'step', step })}\n\n`)
				);
			}

			try {
				sendStep('Cleaning stale lenses...');
				const { sessionId, lensId } = await createDrillingSessionWithProgress(sendStep);

				controller.enqueue(
					encoder.encode(
						`data: ${JSON.stringify({
							type: 'done',
							sessionId,
							lensId,
							sseUrl: getSSEUrl(sessionId),
							apiKey: getApiKey()
						})}\n\n`
					)
				);
			} catch (err) {
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`)
				);
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
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
