<script>
	import { cn } from '$lib/utils.js';
	import BackgroundCard from '$lib/components/ui/patterns/background-card/index.js';
	import Badge from '$lib/components/ui/primitives/badge/index.js';
	import { ScrollArea } from '$lib/components/ui/primitives/scroll-area/index.js';
	import TargetIcon from '@lucide/svelte/icons/target';

	const ACTC_TO_LABEL = {
		'1': 'DRILLING',
		'2': 'DRILLING',
		'3': 'NOT_DRILLING',
		'4': 'NOT_DRILLING',
		'8': 'NOT_DRILLING',
		'9': 'NOT_DRILLING'
	};

	let {
		classifications = [],
		rows = [],
		windowSize = 25,
		stepSize = 25,
		config = {},
		class: className,
		...restProps
	} = $props();

	// For each classification, derive ground truth from ACTC in the same window
	let evaluated = $derived.by(() => {
		return classifications.map((cls) => {
			const windowRows = rows.slice(cls.windowStart, cls.windowEnd);
			const actcCounts = { DRILLING: 0, NOT_DRILLING: 0, UNKNOWN: 0 };

			for (const row of windowRows) {
				const actc = row?.ACTC?.trim();
				const label = ACTC_TO_LABEL[actc];
				if (label) actcCounts[label]++;
				else actcCounts.UNKNOWN++;
			}

			// Only evaluate unanimous windows (all rows same label)
			let groundTruth = null;
			const total = actcCounts.DRILLING + actcCounts.NOT_DRILLING;
			if (total > 0 && actcCounts.UNKNOWN === 0) {
				if (actcCounts.DRILLING === total) groundTruth = 'DRILLING';
				else if (actcCounts.NOT_DRILLING === total) groundTruth = 'NOT_DRILLING';
				// else: mixed window → skip
			}

			const correct = groundTruth ? cls.label === groundTruth : null;
			return { ...cls, groundTruth, correct, skipped: !groundTruth };
		});
	});

	let stats = $derived.by(() => {
		const scorable = evaluated.filter((e) => !e.skipped);
		const correct = scorable.filter((e) => e.correct).length;
		const incorrect = scorable.filter((e) => !e.correct).length;
		const total = scorable.length;
		const accuracy = total > 0 ? ((correct / total) * 100).toFixed(1) : '--';
		const skipped = evaluated.filter((e) => e.skipped).length;

		// Per-class breakdown
		const tp = scorable.filter((e) => e.label === 'DRILLING' && e.correct).length;
		const fp = scorable.filter((e) => e.label === 'DRILLING' && !e.correct).length;
		const fn = scorable.filter((e) => e.label === 'NOT_DRILLING' && e.groundTruth === 'DRILLING').length;
		const tn = scorable.filter((e) => e.label === 'NOT_DRILLING' && e.correct).length;

		const precision = tp + fp > 0 ? ((tp / (tp + fp)) * 100).toFixed(1) : '--';
		const recall = tp + fn > 0 ? ((tp / (tp + fn)) * 100).toFixed(1) : '--';

		return { correct, incorrect, total, accuracy, skipped, tp, fp, fn, tn, precision, recall };
	});

	// Rolling accuracy (last 20 windows)
	let rollingAccuracy = $derived.by(() => {
		const recent = evaluated.filter((e) => !e.skipped).slice(-20);
		if (recent.length === 0) return '--';
		const correct = recent.filter((e) => e.correct).length;
		return ((correct / recent.length) * 100).toFixed(1);
	});
</script>

<BackgroundCard
	title="Accuracy"
	icon={TargetIcon}
	class={cn('flex flex-col gap-3', className)}
	{...restProps}
>
	<!-- Overall accuracy gauge -->
	<div class="flex flex-wrap items-center gap-3">
		<div class="flex flex-col items-center">
			<span class="text-foreground font-mono text-xl font-medium">
				{stats.accuracy}{stats.accuracy !== '--' ? '%' : ''}
			</span>
			<span class="text-muted-foreground text-[9px]">Overall</span>
		</div>
		<div class="flex flex-col items-center">
			<span class="text-foreground font-mono text-xl font-medium">
				{rollingAccuracy}{rollingAccuracy !== '--' ? '%' : ''}
			</span>
			<span class="text-muted-foreground text-[9px]">Rolling</span>
		</div>
		<div class="flex flex-col gap-0.5">
			<div class="flex gap-2 font-mono text-[9px]">
				<span class="text-atai-good">{stats.correct} correct</span>
				<span class="text-atai-critical">{stats.incorrect} wrong</span>
				{#if stats.skipped > 0}
					<span class="text-muted-foreground">{stats.skipped} skipped</span>
				{/if}
			</div>
			<div class="flex gap-2 font-mono text-[10px]">
				<span class="text-muted-foreground">Precision: {stats.precision}%</span>
				<span class="text-muted-foreground">Recall: {stats.recall}%</span>
			</div>
		</div>
	</div>

	<!-- Confusion matrix -->
	{#if stats.total > 0}
		<div class="border-border rounded-xs border p-2">
			<p class="text-muted-foreground mb-1 text-[10px]">Confusion Matrix (predicted vs actual)</p>
			<div class="grid grid-cols-[auto_1fr_1fr] gap-1 font-mono text-[10px]">
				<span></span>
				<span class="text-muted-foreground text-center">Actual Drill</span>
				<span class="text-muted-foreground text-center">Actual Not</span>
				<span class="text-muted-foreground">Pred Drill</span>
				<span class="text-atai-good text-center">{stats.tp} TP</span>
				<span class="text-atai-critical text-center">{stats.fp} FP</span>
				<span class="text-muted-foreground">Pred Not</span>
				<span class="text-atai-critical text-center">{stats.fn} FN</span>
				<span class="text-atai-good text-center">{stats.tn} TN</span>
			</div>
		</div>
	{/if}

	<!-- Current config -->
	<div class="border-border rounded-xs border p-2">
		<div class="mb-1 flex items-center justify-between">
			<p class="text-muted-foreground text-[10px]">Current Config</p>
			{#if config.saved}
				<span class="text-atai-neutral text-[9px]">saved</span>
			{/if}
		</div>
		<div class="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[10px]">
			<span class="text-muted-foreground">Window size</span>
			<span class="text-foreground">{config.windowSize ?? 25}</span>
			<span class="text-muted-foreground">Step size</span>
			<span class="text-foreground">{config.stepSize ?? 25}</span>
			<span class="text-muted-foreground">N-shot/class</span>
			<span class="text-foreground">{config.nShotPerClass ?? 500}</span>
			<span class="text-muted-foreground">K neighbors</span>
			<span class="text-foreground">{config.nNeighbors ?? 5}</span>
			<span class="text-muted-foreground">Metric</span>
			<span class="text-foreground">{config.metric ?? 'manhattan'}</span>
			<span class="text-muted-foreground">Algorithm</span>
			<span class="text-foreground">{config.algorithm ?? 'ball_tree'}</span>
		</div>
	</div>

	<!-- Recent predictions with correctness -->
	<ScrollArea class="min-h-0 flex-1">
		<div class="flex flex-col gap-0.5 pr-3">
			{#each [...evaluated].reverse().slice(0, 50) as e (e.id)}
				<div class="grid grid-cols-[auto_auto_auto_1fr] items-center gap-2 px-1 py-0.5 font-mono text-[10px]">
					{#if e.skipped}
						<span class="text-muted-foreground">?</span>
					{:else if e.correct}
						<span class="text-atai-good">✓</span>
					{:else}
						<span class="text-atai-critical">✗</span>
					{/if}
					<Badge
						variant="outline"
						class={cn(
							'w-24 justify-center text-[9px]',
							e.label === 'DRILLING' ? 'bg-[#22d3ee]/20' : 'bg-[#f97316]/20'
						)}
					>
						{e.label}
					</Badge>
					<span class="text-muted-foreground">
						{e.groundTruth ? (e.groundTruth === e.label ? '=' : '≠') : '?'} {e.groundTruth ?? 'unknown'}
					</span>
					<span class="text-muted-foreground text-right">W {e.windowStart}-{e.windowEnd}</span>
				</div>
			{/each}
		</div>
	</ScrollArea>
</BackgroundCard>
