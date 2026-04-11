<script>
	import { cn } from '$lib/utils.js';
	import BackgroundCard from '$lib/components/ui/patterns/background-card/index.js';
	import Badge from '$lib/components/ui/primitives/badge/index.js';
	import { Button } from '$lib/components/ui/primitives/button/index.js';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import ActivityIcon from '@lucide/svelte/icons/activity';

	const LEFT_CHANNELS = [
		{ key: 'BPOS', label: 'Block Position', unit: 'm', color: '#818cf8' },
		{ key: 'DBTM', label: 'Bit Depth', unit: 'm', color: '#fb923c' },
		{ key: 'HDTH', label: 'Hole Depth', unit: 'm', color: '#94a3b8' },
		{ key: 'FLWI', label: 'Flow In', unit: 'L/min', color: '#f472b6' },
		{ key: 'ACTC', label: 'Activity Code', unit: '', color: '#e879f9', isACTC: true }
	];

	const RIGHT_CHANNELS = [
		{ key: 'ROP', label: 'Penetration Rate', unit: 'm/h', color: '#22d3ee' },
		{ key: 'RPM', label: 'Rotary Speed', unit: 'rpm', color: '#facc15' },
		{ key: 'SPPA', label: 'Standpipe Press.', unit: 'kPa', color: '#f97316' },
		{ key: 'WOB', label: 'Weight on Bit', unit: 'kkgf', color: '#a78bfa' },
		{ key: 'HKLD', label: 'Hookload', unit: 'kkgf', color: '#34d399' }
	];

	const ACTC_LABELS = {
		'1': 'Drilling', '2': 'Reaming', '3': 'Off Bottom',
		'4': 'In Slips', '5': 'Unknown', '8': 'Trip In Slips',
		'9': 'Shut In', '20': 'Tripping', '-1': 'N/A', '': '--'
	};

	let {
		rows = [],
		playheadIndex = 0,
		classifications = [],
		currentState = null,
		onexpand,
		class: className,
		...restProps
	} = $props();

	let displayRows = $derived(rows.slice(0, playheadIndex + 1));

	function currentValue(key, isACTC = false) {
		if (!displayRows.length) return '--';
		const raw = displayRows[displayRows.length - 1]?.[key] ?? '';
		if (isACTC) return ACTC_LABELS[raw] ?? raw ?? '--';
		const val = parseFloat(raw);
		return isNaN(val) ? '--' : val.toFixed(1);
	}

	// Build sparkline path for a channel (last 200 points)
	function sparkline(key, w, h) {
		const tail = displayRows.slice(-200);
		if (tail.length < 2) return '';
		const vals = tail.map((r) => parseFloat(r[key])).filter((v) => !isNaN(v));
		if (vals.length < 2) return '';
		const min = Math.min(...vals);
		const max = Math.max(...vals);
		const range = max - min || 1;
		const points = vals.map((v, i) => {
			const x = (i / (vals.length - 1)) * w;
			const y = h - ((v - min) / range) * h;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});
		return 'M' + points.join(' L');
	}

	let lastClassification = $derived(
		classifications.length > 0 ? classifications[classifications.length - 1] : null
	);
</script>

<BackgroundCard
	title="Drilling Rig"
	icon={ActivityIcon}
	class={cn('flex max-h-full flex-col gap-2 overflow-hidden', className)}
	{...restProps}
>
	<div class="flex items-center gap-2">
		<p class="text-muted-foreground text-[10px]">
			Volve oil field, North Sea (Equinor) · 9 surface sensors · Live values + sparklines
		</p>
		{#if currentState}
			<Badge
				variant="outline"
				class={cn(
					'font-mono text-[10px]',
					currentState === 'DRILLING' ? 'bg-[#22d3ee]/20' : 'bg-[#f97316]/20'
				)}
			>
				{currentState}
			</Badge>
		{/if}
		{#if onexpand}
			<div class="ml-auto">
				<Button variant="ghost" size="icon-sm" aria-label="Fullscreen" onclick={onexpand}>
					<Maximize2Icon class="size-3.5" />
				</Button>
			</div>
		{/if}
	</div>

	<div class="grid min-h-0 flex-1 grid-cols-[1fr_auto_1fr] gap-3">
		<!-- Left sensors -->
		<div class="flex flex-col justify-center gap-2">
			{#each LEFT_CHANNELS as ch (ch.key)}
				<div class="border-border rounded-xs border p-2">
					<div class="flex items-baseline justify-between">
						<span class="text-muted-foreground text-[10px]">{ch.label}</span>
						<span class="font-mono text-sm" style:color={ch.color}>
							{currentValue(ch.key, ch.isACTC)} {#if ch.unit}<span class="text-muted-foreground text-[9px]">{ch.unit}</span>{/if}
						</span>
					</div>
					<svg class="mt-1 h-6 w-full" viewBox="0 0 120 24" preserveAspectRatio="none">
						<path d={sparkline(ch.key, 120, 24)} fill="none" stroke={ch.color} stroke-width="1.5" opacity="0.8" />
					</svg>
				</div>
			{/each}
		</div>

		<!-- Center rig illustration -->
		<div class="flex flex-col items-center justify-center">
			<svg viewBox="0 0 120 200" class="h-full max-h-64 w-auto" preserveAspectRatio="xMidYMid meet">
				<!-- Derrick tower -->
				<line x1="60" y1="10" x2="30" y2="140" stroke="var(--color-muted-foreground)" stroke-width="2" />
				<line x1="60" y1="10" x2="90" y2="140" stroke="var(--color-muted-foreground)" stroke-width="2" />
				<!-- Cross braces -->
				<line x1="38" y1="50" x2="82" y2="50" stroke="var(--color-muted-foreground)" stroke-width="1" opacity="0.5" />
				<line x1="42" y1="80" x2="78" y2="80" stroke="var(--color-muted-foreground)" stroke-width="1" opacity="0.5" />
				<line x1="46" y1="110" x2="74" y2="110" stroke="var(--color-muted-foreground)" stroke-width="1" opacity="0.5" />
				<!-- Crown block -->
				<rect x="50" y="6" width="20" height="10" rx="2" fill="var(--color-muted-foreground)" opacity="0.6" />
				<!-- Traveling block -->
				<rect x="52" y="30" width="16" height="12" rx="2" fill="var(--color-muted-foreground)" />
				<!-- Drill line -->
				<line x1="60" y1="16" x2="60" y2="30" stroke="var(--color-muted-foreground)" stroke-width="1.5" />
				<!-- Kelly / drill string -->
				<rect x="57" y="42" width="6" height="96" rx="1" fill={lastClassification?.label === 'DRILLING' ? '#22d3ee' : lastClassification ? '#f97316' : 'var(--color-muted-foreground)'} opacity="0.7" />
				<!-- Rotary table -->
				<rect x="35" y="138" width="50" height="8" rx="2" fill="var(--color-muted-foreground)" />
				<!-- Substructure -->
				<rect x="25" y="146" width="70" height="6" rx="1" fill="var(--color-muted-foreground)" opacity="0.4" />
				<!-- Drill bit -->
				<polygon points="55,138 65,138 62,145 58,145" fill={lastClassification?.label === 'DRILLING' ? '#22d3ee' : lastClassification ? '#f97316' : 'var(--color-muted-foreground)'} opacity="0.8" />
				<!-- Ground surface -->
				<line x1="10" y1="146" x2="110" y2="146" stroke="var(--color-border)" stroke-width="1" />
				<!-- Wellbore -->
				<rect x="56" y="146" width="8" height="50" rx="1" fill="var(--color-card)" stroke="var(--color-border)" stroke-width="0.5" />
				<!-- Mud pit -->
				<rect x="92" y="130" width="20" height="16" rx="2" fill="var(--color-muted-foreground)" opacity="0.3" />
				<text x="102" y="141" text-anchor="middle" fill="var(--color-muted-foreground)" font-size="6" font-family="var(--font-mono)">MUD</text>
				<!-- Mud line -->
				<path d="M92,138 L80,138 L80,148 L56,148" fill="none" stroke="var(--color-muted-foreground)" stroke-width="1" opacity="0.3" stroke-dasharray="3,2" />
				<!-- Status label -->
				{#if lastClassification}
					<text x="60" y="190" text-anchor="middle" fill={lastClassification.label === 'DRILLING' ? '#22d3ee' : '#f97316'} font-size="9" font-family="var(--font-mono)" font-weight="bold">
						{lastClassification.label}
					</text>
				{:else}
					<text x="60" y="190" text-anchor="middle" fill="var(--color-muted-foreground)" font-size="9" font-family="var(--font-mono)">
						AWAITING DATA
					</text>
				{/if}
			</svg>
		</div>

		<!-- Right sensors -->
		<div class="flex flex-col justify-center gap-2">
			{#each RIGHT_CHANNELS as ch (ch.key)}
				<div class="border-border rounded-xs border p-2">
					<div class="flex items-baseline justify-between">
						<span class="text-muted-foreground text-[10px]">{ch.label}</span>
						<span class="font-mono text-sm" style:color={ch.color}>
							{currentValue(ch.key)} <span class="text-muted-foreground text-[9px]">{ch.unit}</span>
						</span>
					</div>
					<svg class="mt-1 h-6 w-full" viewBox="0 0 120 24" preserveAspectRatio="none">
						<path d={sparkline(ch.key, 120, 24)} fill="none" stroke={ch.color} stroke-width="1.5" opacity="0.8" />
					</svg>
				</div>
			{/each}
		</div>
	</div>
</BackgroundCard>
