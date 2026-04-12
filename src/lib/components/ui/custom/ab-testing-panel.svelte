<script>
	import { cn } from '$lib/utils.js';
	import BackgroundCard from '$lib/components/ui/patterns/background-card/index.js';
	import Badge from '$lib/components/ui/primitives/badge/index.js';
	import ConfigEditor from './config-editor.svelte';
	import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';

	const ACTC_TO_LABEL = {
		'1': 'DRILLING', '2': 'DRILLING',
		'3': 'NOT_DRILLING', '4': 'NOT_DRILLING',
		'8': 'NOT_DRILLING', '9': 'NOT_DRILLING'
	};

	import CheckIcon from '@lucide/svelte/icons/check';

	let {
		rows = [],
		sessionsData = $bindable({ a: null, b: null }),
		onstartSession,
		onstopSession,
		onapplyConfig,
		class: className,
		...restProps
	} = $props();

	let configA = $state({ windowSize: 64, stepSize: 64, nNeighbors: 5, metric: 'euclidean', weights: 'uniform' });
	let configB = $state({ windowSize: 64, stepSize: 64, nNeighbors: 3, metric: 'manhattan', weights: 'distance' });

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
			// Unanimous only
			if (counts.DRILLING === gt) {
				total++;
				if (cls.label === 'DRILLING') correct++;
			} else if (counts.NOT_DRILLING === gt) {
				total++;
				if (cls.label === 'NOT_DRILLING') correct++;
			}
		}
		return total > 0 ? ((correct / total) * 100).toFixed(1) : '--';
	}

	let accuracyA = $derived(
		sessionsData.a?.classifications ? computeAccuracy(sessionsData.a.classifications, configA.windowSize) : '--'
	);
	let accuracyB = $derived(
		sessionsData.b?.classifications ? computeAccuracy(sessionsData.b.classifications, configB.windowSize) : '--'
	);

	let winner = $derived.by(() => {
		const a = parseFloat(accuracyA);
		const b = parseFloat(accuracyB);
		if (isNaN(a) || isNaN(b)) return null;
		if (a > b) return 'A';
		if (b > a) return 'B';
		return 'tie';
	});

	// Guided suggestion based on error patterns
	let suggestion = $derived.by(() => {
		const aData = sessionsData.a?.classifications ?? [];
		const bData = sessionsData.b?.classifications ?? [];
		const totalWindows = Math.max(aData.length, bData.length);
		if (totalWindows < 10) return null;

		const a = parseFloat(accuracyA) || 0;
		const b = parseFloat(accuracyB) || 0;
		const best = a >= b ? configA : configB;
		const bestAcc = Math.max(a, b);
		const suggestions = [];

		if (bestAcc < 30) {
			if (best.windowSize < 128) {
				suggestions.push(`Try window size ${best.windowSize * 2} — larger windows capture more signal pattern`);
			}
			if (best.nNeighbors > 3) {
				suggestions.push(`Try k=${best.nNeighbors - 2} — fewer neighbors may reduce noise`);
			}
		}

		if (best.metric === 'euclidean') {
			suggestions.push(`Try cosine metric — may work better for normalized embeddings`);
		} else if (best.metric === 'manhattan') {
			suggestions.push(`Try euclidean metric — standard distance for embedding spaces`);
		}

		if (best.weights === 'uniform') {
			suggestions.push(`Try distance weights — closer neighbors get stronger vote`);
		}

		if (bestAcc > 50 && best.windowSize > 32) {
			suggestions.push(`Try window size ${Math.floor(best.windowSize / 2)} — you might maintain accuracy with faster inference`);
		}

		return suggestions.length > 0 ? suggestions : null;
	});
</script>

<BackgroundCard
	title="A/B Testing"
	icon={FlaskConicalIcon}
	class={cn('flex max-h-full flex-col gap-3 overflow-hidden', className)}
	{...restProps}
>
	<div class="grid grid-cols-2 gap-2">
		<ConfigEditor
			label="A"
			color="#22d3ee"
			bind:config={configA}
			running={!!sessionsData.a?.sessionId}
			accuracy={accuracyA !== '--' ? accuracyA : null}
			onstart={() => onstartSession?.('a', { ...configA, stepSize: configA.windowSize })}
			onstop={() => onstopSession?.('a')}
		/>
		<ConfigEditor
			label="B"
			color="#facc15"
			bind:config={configB}
			running={!!sessionsData.b?.sessionId}
			accuracy={accuracyB !== '--' ? accuracyB : null}
			onstart={() => onstartSession?.('b', { ...configB, stepSize: configB.windowSize })}
			onstop={() => onstopSession?.('b')}
		/>
	</div>

	<!-- Comparison -->
	{#if accuracyA !== '--' || accuracyB !== '--'}
		<div class="border-border flex flex-wrap items-center gap-2 rounded-xs border p-1.5 font-mono text-[9px]">
			<span class="text-[#22d3ee]">A:{accuracyA}%<span class="text-muted-foreground">({sessionsData.a?.classifications?.length ?? 0}w)</span></span>
			<span class="text-muted-foreground">vs</span>
			<span class="text-[#facc15]">B:{accuracyB}%<span class="text-muted-foreground">({sessionsData.b?.classifications?.length ?? 0}w)</span></span>
			{#if winner === 'A'}
				<Button variant="default" size="sm" class="ml-auto text-[9px]" onclick={() => onapplyConfig?.({ ...configA, stepSize: configA.windowSize })}>Apply A</Button>
			{:else if winner === 'B'}
				<Button variant="default" size="sm" class="ml-auto text-[9px]" onclick={() => onapplyConfig?.({ ...configB, stepSize: configB.windowSize })}>Apply B</Button>
			{:else if winner === 'tie'}
				<span class="text-muted-foreground ml-auto">Tie</span>
			{/if}
		</div>
	{/if}

	<!-- Guided suggestions -->
	{#if suggestion}
		<div class="border-border rounded-xs border p-1.5">
			<p class="text-muted-foreground mb-0.5 text-[8px] font-medium">Suggestions:</p>
			{#each suggestion.slice(0, 3) as s}
				<p class="text-foreground text-[8px]">• {s}</p>
			{/each}
		</div>
	{/if}
</BackgroundCard>
