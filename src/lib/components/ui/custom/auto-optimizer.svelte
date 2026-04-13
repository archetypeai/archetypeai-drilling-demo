<script>
	import { cn } from '$lib/utils.js';
	import BackgroundCard from '$lib/components/ui/patterns/background-card/index.js';
	import Badge from '$lib/components/ui/primitives/badge/index.js';
	import { Button } from '$lib/components/ui/primitives/button/index.js';
	import { ScrollArea } from '$lib/components/ui/primitives/scroll-area/index.js';
	import SpinnerIcon from '@lucide/svelte/icons/loader';
	import WandIcon from '@lucide/svelte/icons/wand-sparkles';
	import CheckIcon from '@lucide/svelte/icons/check';

	const ACTC_TO_LABEL = {
		'1': 'DRILLING', '2': 'DRILLING',
		'3': 'NOT_DRILLING', '4': 'NOT_DRILLING',
		'8': 'NOT_DRILLING', '9': 'NOT_DRILLING'
	};

	// Configs to search — focused set of promising combinations
	const SEARCH_CONFIGS = [
		{ windowSize: 32, nNeighbors: 3, metric: 'euclidean', weights: 'uniform' },
		{ windowSize: 32, nNeighbors: 5, metric: 'manhattan', weights: 'distance' },
		{ windowSize: 64, nNeighbors: 3, metric: 'euclidean', weights: 'uniform' },
		{ windowSize: 64, nNeighbors: 5, metric: 'euclidean', weights: 'uniform' },
		{ windowSize: 64, nNeighbors: 5, metric: 'manhattan', weights: 'distance' },
		{ windowSize: 64, nNeighbors: 7, metric: 'cosine', weights: 'uniform' },
		{ windowSize: 128, nNeighbors: 3, metric: 'euclidean', weights: 'uniform' },
		{ windowSize: 128, nNeighbors: 5, metric: 'euclidean', weights: 'distance' },
		{ windowSize: 128, nNeighbors: 5, metric: 'manhattan', weights: 'uniform' },
		{ windowSize: 128, nNeighbors: 7, metric: 'cosine', weights: 'distance' }
	];

	let {
		rows = [],
		running = $bindable(false),
		results = $bindable([]),
		onstartConfig,
		onstopConfig,
		onapplyConfig,
		class: className,
		...restProps
	} = $props();

	let currentIdx = $state(-1);
	let currentSession = $state(null);
	let windowsPerConfig = 20;

	function computeAccuracy(classifications, windowSize) {
		let correct = 0;
		let total = 0;
		for (const cls of classifications) {
			const windowRows = rows.slice(cls.windowStart, cls.windowEnd);
			const counts = { DRILLING: 0, NOT_DRILLING: 0 };
			for (const row of windowRows) {
				const label = ACTC_TO_LABEL[row?.ACTC?.trim()];
				if (label) counts[label]++;
			}
			const gt = counts.DRILLING + counts.NOT_DRILLING;
			if (gt === 0) continue;
			if (counts.DRILLING === gt) { total++; if (cls.label === 'DRILLING') correct++; }
			else if (counts.NOT_DRILLING === gt) { total++; if (cls.label === 'NOT_DRILLING') correct++; }
		}
		return { correct, total, accuracy: total > 0 ? ((correct / total) * 100).toFixed(1) : '0' };
	}

	let bestResult = $derived.by(() => {
		if (!results.length) return null;
		return results.reduce((best, r) => {
			const a = parseFloat(r.accuracy) || 0;
			const b = parseFloat(best.accuracy) || 0;
			return a > b ? r : best;
		});
	});

	function configLabel(cfg) {
		return `w${cfg.windowSize} k${cfg.nNeighbors} ${cfg.metric.slice(0, 3)} ${cfg.weights.slice(0, 4)}`;
	}

	export function receiveClassification(label, windowStart, windowEnd) {
		if (!running || currentIdx < 0 || currentIdx >= results.length) return;
		results[currentIdx].classifications = [
			...results[currentIdx].classifications,
			{ label, windowStart, windowEnd }
		];
		const stats = computeAccuracy(results[currentIdx].classifications, results[currentIdx].config.windowSize);
		results[currentIdx].accuracy = stats.accuracy;
		results[currentIdx].correct = stats.correct;
		results[currentIdx].total = stats.total;
		results = [...results];

		// Move to next config after enough windows
		if (results[currentIdx].classifications.length >= windowsPerConfig) {
			advanceToNext();
		}
	}

	async function startOptimization() {
		running = true;
		results = SEARCH_CONFIGS.map((cfg) => ({
			config: { ...cfg, stepSize: cfg.windowSize },
			classifications: [],
			accuracy: '--',
			correct: 0,
			total: 0,
			status: 'pending'
		}));
		currentIdx = 0;
		await runCurrentConfig();
	}

	let configTimeout = null;

	async function runCurrentConfig() {
		if (!running || currentIdx >= results.length) {
			running = false;
			return;
		}
		results[currentIdx].status = 'running';
		results = [...results];

		// Set a timeout — if we don't get enough results in 3 min, move on
		if (configTimeout) clearTimeout(configTimeout);
		configTimeout = setTimeout(() => {
			if (running && currentIdx < results.length && results[currentIdx].status === 'running') {
				console.log(`Config ${currentIdx} timed out, advancing`);
				advanceToNext();
			}
		}, 180000);

		try {
			await onstartConfig?.(results[currentIdx].config);
		} catch (err) {
			console.error('Config failed:', err);
			results[currentIdx].status = 'error';
			if (configTimeout) clearTimeout(configTimeout);
			advanceToNext();
		}
	}

	async function advanceToNext() {
		if (configTimeout) clearTimeout(configTimeout);
		if (!running) return;
		if (currentIdx >= 0 && currentIdx < results.length) {
			results[currentIdx].status = 'done';
			results = [...results];
			await onstopConfig?.();
		}
		currentIdx++;
		if (running && currentIdx < results.length) {
			await runCurrentConfig();
		} else {
			running = false;
		}
	}

	function stopOptimization() {
		running = false;
		if (configTimeout) clearTimeout(configTimeout);
		// Mark current running config as done
		if (currentIdx >= 0 && currentIdx < results.length && results[currentIdx].status === 'running') {
			results[currentIdx].status = 'done';
			results = [...results];
		}
		onstopConfig?.();
	}

	let roundNumber = $state(1);

	function generateNextRound() {
		// Take top 3 configs from current results
		const sorted = [...results]
			.filter((r) => r.status === 'done')
			.sort((a, b) => (parseFloat(b.accuracy) || 0) - (parseFloat(a.accuracy) || 0));
		const top = sorted.slice(0, 3).map((r) => r.config);
		if (!top.length) return [];

		const ALL_WINDOWS = [32, 48, 64, 96, 128, 192, 256];
		const ALL_K = [3, 5, 7, 10, 15];
		const ALL_METRICS = ['euclidean', 'manhattan', 'cosine'];
		const ALL_WEIGHTS = ['uniform', 'distance'];

		const tried = new Set(results.map((r) => configLabel(r.config)));
		const candidates = [];

		for (const base of top) {
			// Vary one param at a time from the best configs
			for (const ws of ALL_WINDOWS) {
				const c = { ...base, windowSize: ws, stepSize: ws };
				if (!tried.has(configLabel(c))) candidates.push(c);
			}
			for (const k of ALL_K) {
				const c = { ...base, nNeighbors: k };
				if (!tried.has(configLabel(c))) candidates.push(c);
			}
			for (const m of ALL_METRICS) {
				const c = { ...base, metric: m };
				if (!tried.has(configLabel(c))) candidates.push(c);
			}
			for (const w of ALL_WEIGHTS) {
				const c = { ...base, weights: w };
				if (!tried.has(configLabel(c))) candidates.push(c);
			}
		}

		// Deduplicate and take 10
		const seen = new Set();
		const unique = [];
		for (const c of candidates) {
			const key = configLabel(c);
			if (!seen.has(key)) {
				seen.add(key);
				unique.push(c);
			}
		}
		return unique.slice(0, 10);
	}

	async function runNextRound() {
		const nextConfigs = generateNextRound();
		if (!nextConfigs.length) return;

		roundNumber++;
		running = true;

		const newResults = nextConfigs.map((cfg) => ({
			config: { ...cfg, stepSize: cfg.windowSize },
			classifications: [],
			accuracy: '--',
			correct: 0,
			total: 0,
			status: 'pending'
		}));

		// Append to existing results
		const prevLength = results.length;
		results = [...results, ...newResults];
		currentIdx = prevLength;
		await runCurrentConfig();
	}
</script>

<BackgroundCard
	title="Auto Optimizer"
	icon={WandIcon}
	class={cn('flex max-h-full flex-col gap-3 overflow-hidden', className)}
	{...restProps}
>
	<p class="text-muted-foreground text-[10px]">
		{results.length > 0 ? `${results.length} configs tested` : `Tries 10 configs`} ({windowsPerConfig} windows each, ~3 min/config) · Round {roundNumber}
	</p>

	{#if !running && results.length === 0}
		<div class="flex flex-col items-center gap-3 py-4">
			<Button variant="default" onclick={startOptimization}>
				<WandIcon class="size-4" aria-hidden="true" />
				Start Optimization
			</Button>
		</div>
	{:else}
		<div class="flex items-center gap-2">
			{#if running}
				<Badge variant="outline" class="bg-atai-warning/20 font-mono text-[10px]">
					<SpinnerIcon class="mr-1 size-3 animate-spin" />
					Testing {currentIdx + 1}/{results.length}
				</Badge>
				<Button variant="outline" size="sm" onclick={stopOptimization}>Stop</Button>
			{:else}
				<Badge variant="outline" class="bg-atai-good/20 font-mono text-[10px]">
					R{roundNumber} done
				</Badge>
				<Button variant="outline" size="sm" onclick={runNextRound}>
					Explore more
				</Button>
				<Button variant="ghost" size="sm" onclick={startOptimization}>Reset</Button>
			{/if}
		</div>

		<!-- Best result -->
		{#if bestResult && parseFloat(bestResult.accuracy) > 0}
			<div class="border-atai-good/30 bg-atai-good/5 flex items-center justify-between rounded-xs border p-2">
				<div>
					<p class="text-atai-good font-mono text-sm font-medium">{bestResult.accuracy}% accuracy</p>
					<p class="text-muted-foreground font-mono text-[10px]">{configLabel(bestResult.config)}</p>
				</div>
				<Button
					variant="default"
					size="sm"
					onclick={() => onapplyConfig?.(bestResult.config)}
				>
					<CheckIcon class="size-3" aria-hidden="true" />
					Use this
				</Button>
			</div>
		{/if}

		<!-- Results leaderboard -->
		<ScrollArea class="min-h-0 flex-1">
			<div class="flex flex-col gap-1 pr-3">
				{#each [...results].sort((a, b) => (parseFloat(b.accuracy) || 0) - (parseFloat(a.accuracy) || 0)) as r, i (configLabel(r.config))}
					<div class="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-xs px-2 py-1 font-mono text-[10px]">
						<span class="w-8 text-right">
							{#if r.status === 'running'}
								<SpinnerIcon class="text-atai-warning inline size-3 animate-spin" />
							{:else if r.status === 'done'}
								<span class={parseFloat(r.accuracy) > 0 ? 'text-foreground' : 'text-muted-foreground'}>
									{r.accuracy}%
								</span>
							{:else if r.status === 'error'}
								<span class="text-atai-critical">err</span>
							{:else}
								<span class="text-muted-foreground">--</span>
							{/if}
						</span>
						<span class="text-muted-foreground truncate">{configLabel(r.config)}</span>
						<span class="text-muted-foreground">{r.classifications.length}w</span>
					</div>
				{/each}
			</div>
		</ScrollArea>
	{/if}
</BackgroundCard>
