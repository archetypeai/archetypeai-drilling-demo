import { json } from '@sveltejs/kit';
import {
	createDrillingSessionWithProgress,
	destroySession,
	getSSEUrl,
	getApiKey
} from '$lib/server/newton.js';

export async function GET({ url }) {
	const encoder = new TextEncoder();

	// Parse config from query params
	const config = {};
	if (url.searchParams.has('windowSize')) config.windowSize = parseInt(url.searchParams.get('windowSize'));
	if (url.searchParams.has('stepSize')) config.stepSize = parseInt(url.searchParams.get('stepSize'));
	if (url.searchParams.has('nNeighbors')) config.nNeighbors = parseInt(url.searchParams.get('nNeighbors'));
	if (url.searchParams.has('metric')) config.metric = url.searchParams.get('metric');
	if (url.searchParams.has('weights')) config.weights = url.searchParams.get('weights');
	if (url.searchParams.has('algorithm')) config.algorithm = url.searchParams.get('algorithm');

	const stream = new ReadableStream({
		async start(controller) {
			function sendStep(step) {
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify({ type: 'step', step })}\n\n`)
				);
			}

			try {
				const { sessionId, lensId } = await createDrillingSessionWithProgress(sendStep, config);

				controller.enqueue(
					encoder.encode(
						`data: ${JSON.stringify({
							type: 'done',
							sessionId,
							lensId,
							sseUrl: getSSEUrl(sessionId),
							apiKey: getApiKey(),
							config
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
