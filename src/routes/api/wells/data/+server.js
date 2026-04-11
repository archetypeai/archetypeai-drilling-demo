import { json } from '@sveltejs/kit';
import { createReadStream } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';

const DATA_DIR = resolve('static/data/wells');

// In-memory cache for the currently loaded well (avoids re-reading on every chunk request)
let cachedWell = null;
let cachedRows = null;
let cachedHeaders = null;

async function loadWell(wellFile) {
	if (cachedWell === wellFile && cachedRows) {
		return { headers: cachedHeaders, rows: cachedRows };
	}

	// Find the file — try DATA_DIR first, handle $47$ encoding in filenames
	let filePath = resolve(DATA_DIR, wellFile);

	const headers = [];
	const rows = [];

	await new Promise((resolve, reject) => {
		const rl = createInterface({
			input: createReadStream(filePath, { encoding: 'utf8' }),
			crlfDelay: Infinity
		});

		let isFirst = true;
		rl.on('line', (line) => {
			if (isFirst) {
				headers.push(...line.split(',').map((h) => h.trim()));
				isFirst = false;
			} else {
				const values = line.split(',');
				const row = {};
				headers.forEach((h, i) => {
					row[h] = values[i]?.trim() ?? '';
				});
				rows.push(row);
			}
		});
		rl.on('close', resolve);
		rl.on('error', reject);
	});

	cachedWell = wellFile;
	cachedRows = rows;
	cachedHeaders = headers;

	return { headers, rows };
}

export async function GET({ url }) {
	const well = url.searchParams.get('well');
	const offset = parseInt(url.searchParams.get('offset') || '0', 10);
	const limit = parseInt(url.searchParams.get('limit') || '5000', 10);

	if (!well) {
		return json({ error: 'Missing well parameter' }, { status: 400 });
	}

	try {
		const { headers, rows } = await loadWell(well);
		const chunk = rows.slice(offset, offset + limit);

		return json({
			headers,
			rows: chunk,
			total: rows.length,
			offset,
			hasMore: offset + limit < rows.length
		});
	} catch (err) {
		return json({ error: err.message }, { status: 500 });
	}
}
