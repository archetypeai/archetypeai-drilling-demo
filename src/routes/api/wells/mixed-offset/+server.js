import { json } from '@sveltejs/kit';
import { createReadStream } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';

const DATA_DIR = resolve('static/data/wells');

const ACTC_DRILLING = new Set(['1', '2']);
const ACTC_NOT_DRILLING = new Set(['3', '4', '8', '9']);

export async function GET({ url }) {
	const well = url.searchParams.get('well');
	const windowSize = parseInt(url.searchParams.get('windowSize') || '128', 10);
	const numWindows = parseInt(url.searchParams.get('numWindows') || '100', 10);

	if (!well) {
		return json({ error: 'Missing well parameter' }, { status: 400 });
	}

	try {
		const filePath = resolve(DATA_DIR, well);
		const scanSize = numWindows * windowSize;

		// Read ACTC column
		const actcValues = [];
		await new Promise((res, rej) => {
			const rl = createInterface({
				input: createReadStream(filePath, { encoding: 'utf8' }),
				crlfDelay: Infinity
			});
			let headers = null;
			let actcIdx = -1;

			rl.on('line', (line) => {
				if (!headers) {
					headers = line.split(',').map((h) => h.trim());
					actcIdx = headers.indexOf('ACTC');
					return;
				}
				if (actcIdx >= 0) {
					actcValues.push(line.split(',')[actcIdx]?.trim() ?? '');
				}
			});
			rl.on('close', res);
			rl.on('error', rej);
		});

		// Score each candidate offset by counting *unanimous windows* with both
		// classes, not raw row balance. This avoids steering into transition zones
		// where w128 windows straddle drilling↔not-drilling boundaries and get
		// skipped from evaluation.
		let bestOffset = 0;
		let bestScore = -1;
		let bestDrillW = 0;
		let bestNotW = 0;
		let bestSkipW = 0;
		const step = Math.max(1, windowSize * 10);

		for (let offset = 0; offset + scanSize <= actcValues.length; offset += step) {
			let drillWindows = 0;
			let notWindows = 0;

			for (let w = 0; w < numWindows; w++) {
				const wStart = offset + w * windowSize;
				const wEnd = wStart + windowSize;
				let d = 0;
				let n = 0;
				let u = 0;
				for (let i = wStart; i < wEnd; i++) {
					if (ACTC_DRILLING.has(actcValues[i])) d++;
					else if (ACTC_NOT_DRILLING.has(actcValues[i])) n++;
					else u++;
				}
				// Only count unanimous windows (no unknowns, all same class)
				if (u === 0 && d > 0 && n === 0) drillWindows++;
				else if (u === 0 && n > 0 && d === 0) notWindows++;
			}

			// Score = minority unanimous class count — maximize it
			const score = Math.min(drillWindows, notWindows);
			if (score > bestScore) {
				bestScore = score;
				bestOffset = offset;
				bestDrillW = drillWindows;
				bestNotW = notWindows;
				bestSkipW = numWindows - drillWindows - notWindows;
			}
			// Good enough: at least 30% of windows are the minority class
			if (drillWindows + notWindows > 0 && score / (drillWindows + notWindows) >= 0.3) break;
		}

		return json({
			offset: bestOffset,
			drillWindows: bestDrillW,
			notDrillWindows: bestNotW,
			skippedWindows: bestSkipW,
			totalRows: actcValues.length
		});
	} catch (err) {
		return json({ error: err.message }, { status: 500 });
	}
}
