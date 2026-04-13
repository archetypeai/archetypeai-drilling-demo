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
	import { fetchWells, fetchWellChunk, startSession, streamWindowToNewton, endSession } from '$lib/api/drilling.js';

	// Mirrors src/lib/server/newton.js DEFAULT_CONFIG; used for display in Live Evaluation.
	const DEFAULT_CONFIG = {
		windowSize: 64,
		stepSize: 64,
		nShotPerClass: 2000,
		nNeighbors: 3,
		metric: 'manhattan',
		weights: 'distance',
		algorithm: 'ball_tree'
	};

	const WINDOW_SIZE = DEFAULT_CONFIG.windowSize;
	const STEP_SIZE = DEFAULT_CONFIG.stepSize;

	const CHUNK_SIZE = 5000;

	let wells = $state([]);
	let selectedWell = $state(null);
	let wellData = $state([]);
	let wellTotal = $state(0);
	let loadedOffset = $state(0);
	let loadingChunk = $state(false);
	let playheadIndex = $state(0);
	let playing = $state(false);
	let playInterval = $state(null);

	let sessionId = $state(null);
	let sseUrl = $state(null);
	let sessionStatus = $state('idle');
	let setupStep = $state('');
	let advancedMode = $state(false);

	let classifications = $state([]);
	let streamCounter = $state(0);
	let expanded = $state(null);

	let sseSource = $state(null);

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

		await loadNextChunk(well.id, 0);
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
		// Load next chunk when playhead is within 1000 rows of loaded data
		if (selectedWell && loadedOffset < wellTotal && playheadIndex > loadedOffset - 1000) {
			loadNextChunk(selectedWell.id, loadedOffset);
		}
	}

	async function handleStart() {
		// Reuse existing session if available
		if (sessionId) {
			classifications = [];
			streamCounter = 0;
			return;
		}

		sessionStatus = 'connecting';
		setupStep = 'Starting...';

		try {
			const result = await startSession((step) => {
				setupStep = step;
			});
			sessionId = result.sessionId;
			sseUrl = result.sseUrl;
			sessionStatus = 'active';
			setupStep = '';

			startSSE();

			// Pre-stream first few windows so results are ready before Play
			preStreamWindows(5);
		} catch (err) {
			console.error('Session failed:', err);
			sessionStatus = 'error';
			setupStep = '';
		}
	}

	function parseSSELabel(event) {
		try {
			const parsed = JSON.parse(event.data);
			if (parsed.type === 'inference.result') {
				const raw = parsed.event_data?.response;
				if (typeof raw === 'string') return raw;
				if (Array.isArray(raw)) return raw[0];
				if (raw && typeof raw === 'object') return raw.class_name || raw.label || raw.prediction || JSON.stringify(raw);
			}
		} catch {
			// ignore parse errors
		}
		return null;
	}

	function connectSSE(url, onLabel) {
		const es = new EventSource(url);
		let reconnectAttempts = 0;

		es.onmessage = (event) => {
			reconnectAttempts = 0;
			const label = parseSSELabel(event);
			if (label) onLabel(String(label));
		};

		es.onerror = () => {
			reconnectAttempts++;
			if (reconnectAttempts > 5) {
				console.warn('SSE reconnect limit reached, closing');
				es.close();
				setTimeout(() => {
					if (sessionId) {
						console.log('Attempting SSE reconnect...');
						const newEs = connectSSE(url, onLabel);
						sseSource = newEs;
					}
				}, 3000);
			}
		};

		return es;
	}

	function startSSE() {
		if (!sseUrl) return;

		const url = `/api/sse-proxy?url=${encodeURIComponent(sseUrl)}`;
		sseSource = connectSSE(url, (label) => {
			const windowIdx = classifications.length;
			classifications = [
				...classifications,
				{
					id: crypto.randomUUID(),
					label,
					windowStart: windowIdx * STEP_SIZE,
					windowEnd: (windowIdx + 1) * STEP_SIZE
				}
			];
		});
	}

	async function preStreamWindows(count) {
		let waited = 0;
		while (wellData.length < WINDOW_SIZE && waited < 10000) {
			await new Promise((r) => setTimeout(r, 200));
			waited += 200;
		}
		if (!sessionId || wellData.length < WINDOW_SIZE) return;

		for (let i = 0; i < count; i++) {
			await streamNextWindow();
		}
	}

	async function streamNextWindow() {
		if (!sessionId || !wellData.length) return;

		const start = streamCounter * STEP_SIZE;
		const end = start + WINDOW_SIZE;
		if (start >= wellData.length) {
			playing = false;
			if (playInterval) clearInterval(playInterval);
			return;
		}

		const window = wellData.slice(start, Math.min(end, wellData.length));

		try {
			await streamWindowToNewton(sessionId, window);
			streamCounter++;
		} catch (err) {
			console.error('Stream failed:', err);
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
					streamNextWindow();
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

	async function handleStop() {
		handlePause();
		if (sseSource) {
			sseSource.close();
			sseSource = null;
		}
		if (sessionId) {
			try {
				await endSession(sessionId);
			} catch { /* ignore */ }
			sessionId = null;
		}
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
	<span class="text-muted-foreground font-mono text-sm tracking-wider uppercase">Drilling Monitor</span>
{/snippet}

<div
	class="bg-background text-foreground grid h-screen w-screen grid-rows-[auto_auto_auto_1fr] overflow-hidden"
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
			onclick={() => { advancedMode = !advancedMode; }}
		>
			<SettingsIcon class="size-3.5" />
		</Button>
	</Menubar>

	<div class="border-border flex items-center gap-6 border-b px-4 py-2">
		<WellSelector {wells} bind:selected={selectedWell} onselect={handleWellSelect} />
		{#if !sessionId}
			<div class="text-muted-foreground hidden items-center gap-4 text-xs lg:flex">
				<span><span class="bg-muted text-foreground mr-1 inline-flex size-5 items-center justify-center rounded-full font-mono text-[10px]">1</span> Select a well</span>
				<span><span class="bg-muted text-foreground mr-1 inline-flex size-5 items-center justify-center rounded-full font-mono text-[10px]">2</span> Start Analysis</span>
				<span><span class="bg-muted text-foreground mr-1 inline-flex size-5 items-center justify-center rounded-full font-mono text-[10px]">3</span> Press Play</span>
			</div>
		{/if}
	</div>

	<div class="border-border flex items-center gap-4 border-b px-4 py-2">
		<PlaybackControls
			{playing}
			current={playheadIndex}
			total={wellTotal}
			wellName={selectedWell?.shortName ?? ''}
			timestamp={wellData[playheadIndex]?.DATE_TIME ?? null}
			onplay={handlePlay}
			onpause={handlePause}
			onreset={handleReset}
		/>
	</div>

	<main class={cn(
		'grid gap-4 overflow-hidden p-4',
		advancedMode ? 'grid-cols-[3fr_1fr_2fr] grid-rows-[minmax(0,1fr)]' : 'grid-cols-[2fr_1fr] grid-rows-[minmax(0,1fr)]'
	)}>
		<RigDashboard
			rows={wellData}
			{playheadIndex}
			{classifications}
			currentState={classifications.length > 0 ? classifications[classifications.length - 1].label : null}
			wellIndex={wells.findIndex((w) => w.id === selectedWell?.id)}
			onexpand={() => toggleExpand('rig')}
			class="max-h-full overflow-hidden"
		/>

		<ClassificationLog {classifications} class="max-h-full" />

		{#if advancedMode}
			<div class="min-h-0 overflow-y-auto">
				<AccuracyPanel
					{classifications}
					rows={wellData}
					config={DEFAULT_CONFIG}
				/>
			</div>
		{/if}
	</main>
</div>

<!-- Fullscreen overlay -->
{#if expanded}
	<div class="bg-background fixed inset-0 z-50 flex flex-col overflow-hidden">
		<div class="border-border flex items-center justify-between border-b px-4 py-2">
			<span class="text-foreground font-mono text-sm uppercase tracking-wider">Drilling Rig</span>
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
				currentState={classifications.length > 0 ? classifications[classifications.length - 1].label : null}
				wellIndex={wells.findIndex((w) => w.id === selectedWell?.id)}
				class="h-full"
			/>
		</div>
	</div>
{/if}
