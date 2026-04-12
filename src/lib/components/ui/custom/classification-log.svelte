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
			<Badge variant="outline" class="bg-[#22d3ee]/20 font-mono text-[10px]">
				Drill: {stats.drilling} ({stats.drillingPct}%)
			</Badge>
			<Badge variant="outline" class="bg-[#f97316]/20 font-mono text-[10px]">
				Not: {stats.notDrilling}
			</Badge>
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
					<div class="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-2 py-1">
						<Badge
							variant="outline"
							class={cn(
								'w-28 justify-center font-mono text-[10px]',
								cls.label === 'DRILLING'
									? 'bg-[#22d3ee]/20'
									: 'bg-[#f97316]/20'
							)}
						>
							{cls.label}
						</Badge>
						<span class="text-muted-foreground font-mono text-[10px]">
							Window {cls.windowStart}–{cls.windowEnd}
						</span>
						<span class="text-muted-foreground font-mono text-[10px]">
							#{classifications.length - i}
						</span>
					</div>
				{/each}
			{/if}
		</div>
	</ScrollArea>
</BackgroundCard>
