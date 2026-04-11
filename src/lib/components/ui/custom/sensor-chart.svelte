<script>
	import { cn } from '$lib/utils.js';
	import BackgroundCard from '$lib/components/ui/patterns/background-card/index.js';
	import { Button } from '$lib/components/ui/primitives/button/index.js';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';

	const CHANNELS = [
		{ key: 'ROP', color: '#22d3ee', label: 'Rate of Penetration (m/h)' },
		{ key: 'RPM', color: '#facc15', label: 'Rotary Speed (rpm)' },
		{ key: 'SPPA', color: '#f97316', label: 'Standpipe Pressure (kPa)' },
		{ key: 'WOB', color: '#a78bfa', label: 'Weight on Bit (kkgf)' },
		{ key: 'HKLD', color: '#34d399', label: 'Hookload (kkgf)' },
		{ key: 'FLWI', color: '#f472b6', label: 'Flow In (L/min)' },
		{ key: 'BPOS', color: '#818cf8', label: 'Block Position (m)' },
		{ key: 'DBTM', color: '#fb923c', label: 'Bit Depth (m)' },
		{ key: 'HDTH', color: '#94a3b8', label: 'Hole Depth (m)' }
	];

	let {
		rows = [],
		playheadIndex = 0,
		classifications = [],
		onexpand,
		class: className,
		...restProps
	} = $props();

	let containerRef = $state(null);
	let W = $state(800);
	let H = $state(300);
	const PAD = { top: 10, right: 10, bottom: 25, left: 50 };

	$effect(() => {
		if (!containerRef) return;
		const ro = new ResizeObserver((entries) => {
			const { width, height } = entries[0].contentRect;
			if (width > 0 && height > 0) { W = width; H = height; }
		});
		ro.observe(containerRef);
		return () => ro.disconnect();
	});

	let plotW = $derived(W - PAD.left - PAD.right);
	let plotH = $derived(H - PAD.top - PAD.bottom);

	// Show up to playheadIndex rows
	let displayRows = $derived(rows.slice(0, playheadIndex + 1));

	// Normalize each channel independently for display
	let channelRanges = $derived.by(() => {
		const ranges = {};
		for (const ch of CHANNELS) {
			const vals = displayRows.map((r) => parseFloat(r[ch.key])).filter((v) => !isNaN(v));
			ranges[ch.key] = {
				min: vals.length ? Math.min(...vals) : 0,
				max: vals.length ? Math.max(...vals) : 1
			};
		}
		return ranges;
	});

	function x(i) { return PAD.left + (i / Math.max(1, displayRows.length - 1)) * plotW; }
	function yNorm(val, key) {
		const range = channelRanges[key];
		const span = range.max - range.min || 1;
		return PAD.top + plotH - ((val - range.min) / span) * plotH;
	}

	let linePaths = $derived(
		CHANNELS.map((ch) => {
			const points = displayRows
				.map((r, i) => {
					const v = parseFloat(r[ch.key]);
					return !isNaN(v) ? `${x(i)},${yNorm(v, ch.key)}` : null;
				})
				.filter(Boolean);
			return { ...ch, d: points.length > 1 ? 'M' + points.join(' L') : '' };
		})
	);

	// Draw classification bands at the bottom
	let classificationBands = $derived.by(() => {
		if (!classifications.length || !displayRows.length) return [];
		const bandH = 8;
		const bandY = H - PAD.bottom + 2;
		return classifications
			.filter((c) => c.windowEnd <= playheadIndex)
			.map((c) => ({
				x: x(c.windowStart),
				width: Math.max(2, x(c.windowEnd) - x(c.windowStart)),
				y: bandY,
				height: bandH,
				color: c.label === 'DRILLING' ? '#22d3ee' : '#f97316',
				label: c.label
			}));
	});
</script>

<BackgroundCard
	title="Sensor Data"
	icon={ActivityIcon}
	class={cn('flex max-h-full flex-col gap-3 overflow-hidden', className)}
	{...restProps}
>
	<p class="text-muted-foreground text-[10px]">
		Volve oil field, North Sea (Equinor, 2007-2016) · Drilling rig surface sensors · Newton classifies each 25-sample window as drilling (bit cutting rock) or not drilling (tripping, circulating, shut-in)
	</p>
	<div class="flex items-center gap-1">
		<div class="flex flex-wrap gap-x-3 gap-y-1">
			{#each CHANNELS as ch}
				<div class="flex items-center gap-1">
					<div class="h-0.5 w-3 rounded-full" style:background={ch.color}></div>
					<span class="text-muted-foreground text-[10px]">{ch.key}</span>
				</div>
			{/each}
			{#if classifications.length > 0}
				<span class="text-muted-foreground text-[10px]">|</span>
				<div class="flex items-center gap-1">
					<div class="h-2 w-3 rounded-xs bg-[#22d3ee]"></div>
					<span class="text-muted-foreground text-[10px]">Drilling</span>
				</div>
				<div class="flex items-center gap-1">
					<div class="h-2 w-3 rounded-xs bg-[#f97316]"></div>
					<span class="text-muted-foreground text-[10px]">Not Drilling</span>
				</div>
			{/if}
		</div>
		{#if onexpand}
			<div class="ml-auto">
				<Button variant="ghost" size="icon-sm" aria-label="Fullscreen" onclick={onexpand}>
					<Maximize2Icon class="size-3.5" />
				</Button>
			</div>
		{/if}
	</div>

	<div bind:this={containerRef} class="min-h-0 w-full flex-1">
		{#if displayRows.length < 2}
			<p class="text-muted-foreground py-8 text-center text-sm">Select a well to view data</p>
		{:else}
			<svg viewBox="0 0 {W} {H}" width={W} height={H}>
				{#each linePaths as line}
					{#if line.d}
						<path d={line.d} fill="none" stroke={line.color} stroke-width="1" opacity="0.7" />
					{/if}
				{/each}

				<!-- Classification bands -->
				{#each classificationBands as band}
					<rect
						x={band.x}
						y={band.y}
						width={band.width}
						height={band.height}
						fill={band.color}
						opacity="0.8"
						rx="1"
					>
						<title>{band.label}</title>
					</rect>
				{/each}

				<!-- Playhead line -->
				{#if displayRows.length > 0}
					<line
						x1={x(displayRows.length - 1)}
						y1={PAD.top}
						x2={x(displayRows.length - 1)}
						y2={H - PAD.bottom + 12}
						stroke="var(--color-foreground)"
						stroke-width="1"
						opacity="0.4"
						stroke-dasharray="3,2"
					/>
				{/if}
			</svg>
		{/if}
	</div>
</BackgroundCard>
