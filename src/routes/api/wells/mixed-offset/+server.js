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

		let bestOffset = 0;
		let bestMix = 0;
		const step = Math.max(1, windowSize * 10);

		for (let offset = 0; offset + scanSize <= actcValues.length; offset += step) {
			let drilling = 0;
			let notDrilling = 0;
			for (let i = offset; i < offset + scanSize; i++) {
				if (ACTC_DRILLING.has(actcValues[i])) drilling++;
				else if (ACTC_NOT_DRILLING.has(actcValues[i])) notDrilling++;
			}
			const total = drilling + notDrilling;
			if (total === 0) continue;
			const mix = Math.min(drilling, notDrilling) / total;
			if (mix > bestMix) {
				bestMix = mix;
				bestOffset = offset;
			}
			if (bestMix >= 0.45) break;
		}

		return json({
			offset: bestOffset,
			mix: parseFloat((bestMix * 100).toFixed(1)),
			totalRows: actcValues.length
		});
	} catch (err) {
		return json({ error: err.message }, { status: 500 });
	}
}
