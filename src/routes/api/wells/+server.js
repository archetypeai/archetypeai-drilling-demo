import { json } from '@sveltejs/kit';
import { readdirSync } from 'fs';
import { resolve } from 'path';

const DATA_DIR = resolve('static/data/wells');

export async function GET() {
	try {
		const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.csv'));
		const wells = files.map((f) => {
			const name = f.replace('.csv', '').replace(/\$47\$/g, '');
			const match = name.match(/F-[\w]+$/);
			const shortName = match ? match[0] : name;
			return { id: f, name, shortName };
		});
		return json({ wells });
	} catch (err) {
		return json({ error: err.message }, { status: 500 });
	}
}
