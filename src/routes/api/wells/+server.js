import { json } from '@sveltejs/kit';
import { readdirSync } from 'fs';
import { resolve } from 'path';

export async function GET() {
	try {
		const wellsDir = resolve('static/data/wells');
		const files = readdirSync(wellsDir).filter((f) => f.endsWith('.csv'));
		const wells = files.map((f) => {
			const name = f.replace('.csv', '');
			// Extract well ID (e.g., "F-12" from "Norway-Statoil-15_9-F-12")
			const match = name.match(/F-[\w]+$/);
			const shortName = match ? match[0] : name;
			return { id: f, name, shortName };
		});
		return json({ wells });
	} catch (err) {
		return json({ error: err.message }, { status: 500 });
	}
}
