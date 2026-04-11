<script>
	import { cn } from '$lib/utils.js';
	import { Button } from '$lib/components/ui/primitives/button/index.js';
	import Badge from '$lib/components/ui/primitives/badge/index.js';

	let { wells = [], selected = $bindable(null), onselect, class: className, ...restProps } = $props();
</script>

<div class={cn('flex flex-wrap gap-1.5', className)} {...restProps}>
	{#each wells as well (well.id)}
		<Button
			variant={selected?.id === well.id ? 'default' : 'outline'}
			size="sm"
			onclick={() => {
				selected = well;
				onselect?.(well);
			}}
		>
			{well.shortName}
			<Badge variant="outline" class="ml-1 px-1 py-0 text-[9px] opacity-60">
				{well.drillingPct}%
			</Badge>
		</Button>
	{/each}
</div>
