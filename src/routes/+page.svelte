<script>
	import { cn } from '$lib/utils.js';
	import Menubar from '$lib/components/ui/patterns/menubar/index.js';
	import { Button } from '$lib/components/ui/primitives/button/index.js';
	import StatusBadge from '$lib/components/ui/patterns/status-badge/status-badge.svelte';
	import WellSelector from '$lib/components/ui/custom/well-selector.svelte';
	import RigDashboard from '$lib/components/ui/custom/rig-dashboard.svelte';
	import ClassificationLog from '$lib/components/ui/custom/classification-log.svelte';
	import AccuracyPanel from '$lib/components/ui/custom/accuracy-panel.svelte';
	import PlaybackControls from '$lib/components/ui/custom/playback-controls.svelte';
	import MinimizeIcon from '@lucide/svelte/icons/minimize-2';
	import SpinnerIcon from '@lucide/svelte/icons/loader';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import {
		fetchWells,
		fetchWellChunk,
		fetchMixedOffset,
		classifyWindow
	} from '$lib/api/drilling.js';

	// Mirrors src/lib/server/newton.js DEFAULT_CONFIG; used for display in Live Evaluation.
	const DEFAULT_CONFIG = {
		windowSize: 128,
		stepSize: 128,
		nShotPerClass: 2000,
		nNeighbors: 3,
		metric: 'euclidean',
		weights: 'uniform',
		algorithm: 'ball_tree'
	};

	const WINDOW_SIZE = DEFAULT_CONFIG.windowSize;
	const STEP_SIZE = DEFAULT_CONFIG.stepSize;

	const CHUNK_SIZE = 5000;

	let wells = $state([]);
	let selectedWell = $state(null);
	let wellData = $state([]);
	let wellTotal = $state(0);
	let dataStartOffset = $state(0);
	let loadedOffset = $state(0);
	let loadingChunk = $state(false);
	let playheadIndex = $state(0);
	let playing = $state(false);
	let playInterval = $state(null);

	let sessionId = $state(null);
	let sessionStatus = $state('idle');
	let setupStep = $state('');
	let advancedMode = $state(false);

	let classifications = $state([]);
	let streamCounter = $state(0);
	let expanded = $state(null);

	// Direct Query is synchronous and slower than the playback tick, so guard
	// against overlapping /api/classify calls — classify windows one at a time.
	let classifying = $state(false);

	async function loadWells() {
		try {
			const data = await fetchWells();
			wells = data.wells;
		} catch (err) {
			console.error('Failed to load wells:', err);
		}
	}

	async function handleWellSelect(well) {
		selectedWell = well;
		playheadIndex = 0;
		classifications = [];
		streamCounter = 0;
		playing = false;
		loadedOffset = 0;
		wellData = [];
		wellTotal = 0;
		if (playInterval) clearInterval(playInterval);

		// Auto-seek to the section with the best drilling/not-drilling mix
		// so the demo starts with both classes visible, not a long single-class stretch.
		const mixed = await fetchMixedOffset(well.id, WINDOW_SIZE);
		dataStartOffset = mixed.offset || 0;

		await loadNextChunk(well.id, dataStartOffset);
		playheadIndex = 0;
	}

	async function loadNextChunk(wellFile, offset) {
		if (loadingChunk) return;
		loadingChunk = true;
		try {
			const data = await fetchWellChunk(wellFile || selectedWell?.id, offset, CHUNK_SIZE);
			wellData = [...wellData, ...data.rows];
			wellTotal = data.total;
			loadedOffset = offset + data.rows.length;
		} catch (err) {
			console.error('Failed to load chunk:', err);
		} finally {
			loadingChunk = false;
		}
	}

	function maybeLoadMore() {
		// Load next chunk when playhead is within 1000 rows of the end of loaded data.
		// Compare against wellData.length (local) not loadedOffset (absolute file position)
		// because playheadIndex is a local index into wellData.
		if (selectedWell && loadedOffset < wellTotal && playheadIndex > wellData.length - 1000) {
			loadNextChunk(selectedWell.id, loadedOffset);
		}
	}

	async function handleStart() {
		// No lens session — Direct Query is stateless. "Start" just arms the
		// analysis: reset state and pre-classify a few windows so the first
		// verdicts are ready before Play.
		if (sessionId) {
			classifications = [];
			streamCounter = 0;
			return;
		}

		sessionStatus = 'active';
		sessionId = 'direct-query';
		setupStep = '';
		classifications = [];
		streamCounter = 0;

		// Pre-classify first few windows so results are ready before Play.
		preClassifyWindows(3);
	}

	async function preClassifyWindows(count) {
		let waited = 0;
		while (wellData.length < WINDOW_SIZE && waited < 10000) {
			await new Promise((r) => setTimeout(r, 200));
			waited += 200;
		}
		if (!sessionId || wellData.length < WINDOW_SIZE) return;

		for (let i = 0; i < count; i++) {
			await classifyNextWindow();
		}
	}

	// Classify the next window via Direct Query and append the verdict.
	// Serialized via `classifying` so playback never fans out concurrent calls.
	async function classifyNextWindow() {
		if (!sessionId || !wellData.length || classifying) return;

		const start = streamCounter * STEP_SIZE;
		const end = start + WINDOW_SIZE;
		if (end > wellData.length) return; // wait until a full window is loaded

		const window = wellData.slice(start, end);
		classifying = true;
		try {
			const result = await classifyWindow(window, DEFAULT_CONFIG.nNeighbors);
			classifications = [
				...classifications,
				{
					id: crypto.randomUUID(),
					label: result.label,
					votes: result.votes,
					neighbors: result.neighbors,
					windowStart: start,
					windowEnd: end
				}
			];
			streamCounter++;
		} catch (err) {
			console.error('Classify failed:', err);
		} finally {
			classifying = false;
		}
	}

	function handlePlay() {
		if (!wellData.length) return;
		playing = true;

		playInterval = setInterval(() => {
			if (playheadIndex < wellData.length - 1) {
				playheadIndex = Math.min(playheadIndex + 20, wellData.length - 1);
			}

			maybeLoadMore();

			if (sessionId) {
				const nextWindowStart = streamCounter * STEP_SIZE;
				if (playheadIndex >= nextWindowStart) {
					classifyNextWindow();
				}
			}

			if (playheadIndex >= wellData.length - 1 && loadedOffset >= wellTotal) {
				playing = false;
				clearInterval(playInterval);
			}
		}, 100);
	}

	function handlePause() {
		playing = false;
		if (playInterval) clearInterval(playInterval);
	}

	function handleReset() {
		playing = false;
		if (playInterval) clearInterval(playInterval);
		playheadIndex = 0;
		streamCounter = 0;
		classifications = [];
	}

	function handleStop() {
		handlePause();
		sessionId = null;
		sessionStatus = 'idle';
	}

	function toggleExpand(panel) {
		expanded = expanded === panel ? null : panel;
	}

	$effect(() => {
		loadWells();
	});
</script>

{#snippet partnerSnippet()}
	<span class="font-mono text-sm tracking-wider text-muted-foreground uppercase"
		>Drilling Monitor</span
	>
{/snippet}

<div
	class="grid h-screen w-screen grid-rows-[auto_auto_auto_1fr] overflow-hidden bg-background text-foreground"
>
	<Menubar partnerLogo={partnerSnippet}>
		<div class="flex items-center gap-3">
			{#if sessionStatus === 'active'}
				<StatusBadge label="Newton" percentage={100} initial="N" />
			{/if}
			{#if sessionStatus === 'connecting'}
				<Button variant="default" size="sm" disabled>
					<SpinnerIcon class="size-3.5 animate-spin" />
					{setupStep || 'Connecting...'}
				</Button>
			{:else if !sessionId}
				<Button variant="default" size="sm" onclick={handleStart} disabled={!selectedWell}>
					Start Analysis
				</Button>
			{:else}
				<Button variant="outline" size="sm" onclick={handleStop}>Stop</Button>
			{/if}
		</div>
		<Button
			variant={advancedMode ? 'default' : 'ghost'}
			size="icon-sm"
			aria-label="Toggle advanced mode"
			onclick={() => {
				advancedMode = !advancedMode;
			}}
		>
			<SettingsIcon class="size-3.5" />
		</Button>
	</Menubar>

	<div class="flex items-center gap-6 border-b border-border px-4 py-2">
		<WellSelector {wells} bind:selected={selectedWell} onselect={handleWellSelect} />
		{#if !sessionId}
			<div class="hidden items-center gap-4 text-xs text-muted-foreground lg:flex">
				<span
					><span
						class="mr-1 inline-flex size-5 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-foreground"
						>1</span
					> Select a well</span
				>
				<span
					><span
						class="mr-1 inline-flex size-5 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-foreground"
						>2</span
					> Start Analysis</span
				>
				<span
					><span
						class="mr-1 inline-flex size-5 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-foreground"
						>3</span
					> Press Play</span
				>
			</div>
		{/if}
	</div>

	<div class="flex items-center gap-4 border-b border-border px-4 py-2">
		<PlaybackControls
			{playing}
			current={dataStartOffset + playheadIndex}
			total={wellTotal}
			wellName={selectedWell?.shortName ?? ''}
			timestamp={wellData[playheadIndex]?.DATE_TIME ?? null}
			onplay={handlePlay}
			onpause={handlePause}
			onreset={handleReset}
		/>
	</div>

	<main
		class={cn(
			'grid gap-4 overflow-hidden p-4',
			advancedMode
				? 'grid-cols-[3fr_1fr_2fr] grid-rows-[minmax(0,1fr)]'
				: 'grid-cols-[2fr_1fr] grid-rows-[minmax(0,1fr)]'
		)}
	>
		<RigDashboard
			rows={wellData}
			{playheadIndex}
			{classifications}
			currentState={classifications.length > 0
				? classifications[classifications.length - 1].label
				: null}
			wellIndex={wells.findIndex((w) => w.id === selectedWell?.id)}
			onexpand={() => toggleExpand('rig')}
			class="max-h-full overflow-hidden"
		/>

		<ClassificationLog {classifications} class="max-h-full" />

		{#if advancedMode}
			<div class="min-h-0 overflow-y-auto">
				<AccuracyPanel {classifications} rows={wellData} config={DEFAULT_CONFIG} />
			</div>
		{/if}
	</main>
</div>

<!-- Fullscreen overlay -->
{#if expanded}
	<div class="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background">
		<div class="flex items-center justify-between border-b border-border px-4 py-2">
			<span class="font-mono text-sm tracking-wider text-foreground uppercase">Drilling Rig</span>
			<Button variant="outline" size="sm" onclick={() => (expanded = null)}>
				<MinimizeIcon class="size-3.5" />
				Close
			</Button>
		</div>
		<div class="min-h-0 flex-1 p-4">
			<RigDashboard
				rows={wellData}
				{playheadIndex}
				{classifications}
				currentState={classifications.length > 0
					? classifications[classifications.length - 1].label
					: null}
				wellIndex={wells.findIndex((w) => w.id === selectedWell?.id)}
				class="h-full"
			/>
		</div>
	</div>
{/if}
