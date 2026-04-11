import { json } from '@sveltejs/kit';
import { readdirSync, createReadStream } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';

const DATA_DIR = resolve('static/data/wells');

// Cache well metadata so we don't re-scan on every request
let cachedWells = null;

async function scanWells() {
	if (cachedWells) return cachedWells;

	const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.csv'));
	const wells = [];

	for (const f of files) {
		const name = f.replace('.csv', '').replace(/\$47\$/g, '');
		const match = name.match(/F-[\w]+$/);
		const shortName = match ? match[0] : name;

		// Count ACTC codes to compute drilling %
		let total = 0;
		let drilling = 0;

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
					if (code === '1' || code === '2') drilling++;
				}
			});
			rl.on('close', res);
			rl.on('error', rej);
		});

		const drillingPct = total > 0 ? ((drilling / total) * 100).toFixed(1) : '0';

		wells.push({ id: f, name, shortName, total, drilling, drillingPct: parseFloat(drillingPct) });
	}

	// Sort by drilling % descending
	wells.sort((a, b) => b.drillingPct - a.drillingPct);
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
