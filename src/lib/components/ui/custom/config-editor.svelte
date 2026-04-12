<script>
	import { cn } from '$lib/utils.js';
	import Badge from '$lib/components/ui/primitives/badge/index.js';
	import { Button } from '$lib/components/ui/primitives/button/index.js';

	let {
		label = 'A',
		color = '#22d3ee',
		config = $bindable({
			windowSize: 64,
			stepSize: 64,
			nNeighbors: 5,
			metric: 'euclidean',
			weights: 'uniform'
		}),
		running = false,
		accuracy = null,
		onstart,
		onstop,
		class: className,
		...restProps
	} = $props();

	const METRICS = ['euclidean', 'manhattan', 'cosine'];
	const WEIGHTS = ['uniform', 'distance'];
	const WINDOW_SIZES = [32, 64, 100, 128, 256];
	const K_VALUES = [3, 5, 7, 10, 15];
</script>

<div class={cn('border-border flex flex-col gap-2 rounded-xs border p-2', className)} {...restProps}>
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<span class="rounded-xs border px-1.5 py-0.5 font-mono text-xs" style="border-color: {color}; color: {color};">
				{label}
			</span>
			{#if accuracy !== null}
				<span class="font-mono text-sm" style="color: {color};">{accuracy}%</span>
			{/if}
		</div>
		{#if running}
			<Button variant="outline" size="sm" onclick={onstop}>Stop</Button>
		{:else}
			<Button variant="default" size="sm" onclick={onstart}>Run</Button>
		{/if}
	</div>

	<div class="grid grid-cols-2 gap-x-3 gap-y-1">
		<label class="text-muted-foreground text-[10px]">
			Window
			<select
				bind:value={config.windowSize}
				disabled={running}
				class="bg-card border-border mt-0.5 block w-full rounded-xs border px-1 py-0.5 font-mono text-[10px]"
			>
				{#each WINDOW_SIZES as ws}
					<option value={ws}>{ws}</option>
				{/each}
			</select>
		</label>

		<label class="text-muted-foreground text-[10px]">
			K neighbors
			<select
				bind:value={config.nNeighbors}
				disabled={running}
				class="bg-card border-border mt-0.5 block w-full rounded-xs border px-1 py-0.5 font-mono text-[10px]"
			>
				{#each K_VALUES as k}
					<option value={k}>{k}</option>
				{/each}
			</select>
		</label>

		<label class="text-muted-foreground text-[10px]">
			Metric
			<select
				bind:value={config.metric}
				disabled={running}
				class="bg-card border-border mt-0.5 block w-full rounded-xs border px-1 py-0.5 font-mono text-[10px]"
			>
				{#each METRICS as m}
					<option value={m}>{m}</option>
				{/each}
			</select>
		</label>

		<label class="text-muted-foreground text-[10px]">
			Weights
			<select
				bind:value={config.weights}
				disabled={running}
				class="bg-card border-border mt-0.5 block w-full rounded-xs border px-1 py-0.5 font-mono text-[10px]"
			>
				{#each WEIGHTS as w}
					<option value={w}>{w}</option>
				{/each}
			</select>
		</label>
	</div>
</div>
