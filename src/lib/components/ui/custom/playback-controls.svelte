<script>
	import { cn } from '$lib/utils.js';
	import { Button } from '$lib/components/ui/primitives/button/index.js';
	import Badge from '$lib/components/ui/primitives/badge/index.js';
	import PlayIcon from '@lucide/svelte/icons/play';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';

	let {
		playing = false,
		current = 0,
		total = 0,
		wellName = '',
		timestamp = null,
		onplay,
		onpause,
		onreset,
		class: className,
		...restProps
	} = $props();

	let progress = $derived(total > 0 ? ((current / total) * 100).toFixed(1) : '0');

	let formattedTime = $derived.by(() => {
		if (!timestamp) return '';
		const ts = parseInt(timestamp);
		if (isNaN(ts)) return '';
		const d = new Date(ts * 1000);
		return d.toLocaleString('en-US', {
			year: 'numeric', month: 'short', day: 'numeric',
			hour: '2-digit', minute: '2-digit', second: '2-digit',
			hour12: false
		});
	});
</script>

<div class={cn('flex items-center gap-3', className)} {...restProps}>
	{#if playing}
		<Button variant="outline" size="icon-sm" aria-label="Pause" onclick={onpause}>
			<PauseIcon class="size-3.5" />
		</Button>
	{:else}
		<Button variant="outline" size="icon-sm" aria-label="Play" onclick={onplay}>
			<PlayIcon class="size-3.5" />
		</Button>
	{/if}
	<Button variant="outline" size="icon-sm" aria-label="Reset" onclick={onreset}>
		<RotateCcwIcon class="size-3.5" />
	</Button>

	<div class="bg-muted h-1.5 min-w-24 flex-1 rounded-full">
		<div
			class="bg-atai-neutral h-1.5 rounded-full transition-all"
			style:width="{progress}%"
		></div>
	</div>

	<span class="text-muted-foreground font-mono text-[10px] whitespace-nowrap">
		{current.toLocaleString()} / {total.toLocaleString()}
	</span>

	{#if formattedTime}
		<Badge variant="outline" class="font-mono text-[10px]">{formattedTime}</Badge>
	{/if}

	{#if wellName}
		<Badge variant="outline" class="font-mono text-[10px]">{wellName}</Badge>
	{/if}
</div>
