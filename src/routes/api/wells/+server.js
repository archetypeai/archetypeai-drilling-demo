import { json } from '@sveltejs/kit';
import { readdirSync, createReadStream } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';
import { REFERENCE_WELLS } from '$lib/reference-wells.js';

const DATA_DIR = resolve('static/data/wells');

// Cache well metadata so we don't re-scan on every request
let cachedWells = null;

async function scanWells() {
	if (cachedWells) return cachedWells;

	// Exclude the held-out reference wells — they build the KNN library, so
	// classifying them would be leakage. Every selectable well is unseen.
	const files = readdirSync(DATA_DIR).filter(
		(f) => f.endsWith('.csv') && !REFERENCE_WELLS.includes(f)
	);
	const wells = [];

	for (const f of files) {
		const name = f.replace('.csv', '').replace(/\$47\$/g, '');
		const match = name.match(/F-[\w]+$/);
		const shortName = match ? match[0] : name;

		// Count ACTC codes to compute drilling %, not-drilling %, and class balance
		let total = 0;
		let drilling = 0;
		let notDrilling = 0;

		const ACTC_DRILLING = new Set(['1', '2']);
		const ACTC_NOT_DRILLING = new Set(['3', '4', '8', '9']);

		await new Promise((res, rej) => {
			const rl = createInterface({
				input: createReadStream(resolve(DATA_DIR, f), { encoding: 'utf8' }),
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
				total++;
				if (actcIdx >= 0) {
					const code = line.split(',')[actcIdx]?.trim();
					if (ACTC_DRILLING.has(code)) drilling++;
					else if (ACTC_NOT_DRILLING.has(code)) notDrilling++;
				}
			});
			rl.on('close', res);
			rl.on('error', rej);
		});

		const labeled = drilling + notDrilling;
		const drillingPct = total > 0 ? ((drilling / total) * 100).toFixed(1) : '0';
		// Class balance: 0 = single-class, 0.5 = perfectly balanced.
		// Wells with better balance produce more meaningful Live Evaluation
		// results and higher F1 in the demo.
		const balance = labeled > 0 ? Math.min(drilling, notDrilling) / labeled : 0;

		wells.push({
			id: f,
			name,
			shortName,
			total,
			drilling,
			notDrilling,
			drillingPct: parseFloat(drillingPct),
			balance: parseFloat(balance.toFixed(3))
		});
	}

	// Sort by class balance descending — wells with both drilling and
	// not-drilling activity show the most interesting Newton results.
	// Single-class wells (F-15B, F-15A, etc.) sort to the end.
	wells.sort((a, b) => b.balance - a.balance);
	cachedWells = wells;
	return wells;
}

export async function GET() {
	try {
		const wells = await scanWells();
		return json({ wells });
	} catch (err) {
		return json({ error: err.message }, { status: 500 });
	}
}
