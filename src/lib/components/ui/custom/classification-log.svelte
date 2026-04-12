<script>
	import { cn } from '$lib/utils.js';
	import BackgroundCard from '$lib/components/ui/patterns/background-card/index.js';
	import Badge from '$lib/components/ui/primitives/badge/index.js';
	import { ScrollArea } from '$lib/components/ui/primitives/scroll-area/index.js';
	import TagIcon from '@lucide/svelte/icons/tag';

	let { classifications = [], class: className, ...restProps } = $props();

	let stats = $derived.by(() => {
		const drilling = classifications.filter((c) => c.label === 'DRILLING').length;
		const notDrilling = classifications.filter((c) => c.label === 'NOT_DRILLING').length;
		const total = classifications.length;
		return { drilling, notDrilling, total, drillingPct: total > 0 ? ((drilling / total) * 100).toFixed(1) : '0' };
	});
</script>

<BackgroundCard
	title="Classification"
	icon={TagIcon}
	class={cn('flex max-h-full flex-col gap-3 overflow-hidden', className)}
	{...restProps}
>
	{#if stats.total > 0}
		<div class="flex flex-wrap items-center gap-2 font-mono text-[10px]">
			<span class="text-muted-foreground">
				Windows: <span class="text-foreground">{stats.total}</span>
			</span>
			<span class="rounded-xs bg-[#22d3ee]/20 px-1.5 py-0.5 text-[#22d3ee]">
				Drilling: {stats.drilling} ({stats.drillingPct}%)
			</span>
			<span class="rounded-xs bg-[#f97316]/20 px-1.5 py-0.5 text-[#f97316]">
				Not: {stats.notDrilling}
			</span>
		</div>
	{/if}

	<ScrollArea class="min-h-0 flex-1">
		<div class="flex flex-col gap-1 pr-3">
			{#if classifications.length === 0}
				<p class="text-muted-foreground py-8 text-center text-sm">
					Start analysis to see classifications
				</p>
			{:else}
				{#each [...classifications].reverse() as cls, i (cls.id)}
					<div class="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-1 py-0.5 font-mono text-[10px]">
						<span class={cn(
							'w-20 rounded-xs px-1.5 py-0.5 text-center text-[9px]',
							cls.label === 'DRILLING'
								? 'bg-[#22d3ee]/20 text-[#22d3ee]'
								: 'bg-[#f97316]/20 text-[#f97316]'
						)}>
							{cls.label === 'DRILLING' ? 'DRILLING' : 'NOT_DRILL'}
						</span>
						<span class="text-muted-foreground text-[9px]">{cls.windowStart}–{cls.windowEnd}</span>
						<span class="text-muted-foreground text-[9px]">#{classifications.length - i}</span>
					</div>
				{/each}
			{/if}
		</div>
	</ScrollArea>
</BackgroundCard>
