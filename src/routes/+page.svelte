<script>
	import Menubar from '$lib/components/ui/patterns/menubar/index.js';
	import { Button } from '$lib/components/ui/primitives/button/index.js';
	import StatusBadge from '$lib/components/ui/patterns/status-badge/status-badge.svelte';
	import WellSelector from '$lib/components/ui/custom/well-selector.svelte';
	import SensorChart from '$lib/components/ui/custom/sensor-chart.svelte';
	import ClassificationLog from '$lib/components/ui/custom/classification-log.svelte';
	import PlaybackControls from '$lib/components/ui/custom/playback-controls.svelte';
	import MinimizeIcon from '@lucide/svelte/icons/minimize-2';
	import { fetchWells, fetchWellData, startSession, streamWindowToNewton, endSession } from '$lib/api/drilling.js';

	const WINDOW_SIZE = 100;
	const STEP_SIZE = 100;

	let wells = $state([]);
	let selectedWell = $state(null);
	let wellData = $state([]);
	let playheadIndex = $state(0);
	let playing = $state(false);
	let playInterval = $state(null);

	let sessionId = $state(null);
	let sseUrl = $state(null);
	let apiKey = $state(null);
	let sessionStatus = $state('idle');
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
		if (playInterval) clearInterval(playInterval);

		try {
			wellData = await fetchWellData(well.id);
		} catch (err) {
			console.error('Failed to load well data:', err);
			wellData = [];
		}
	}

	async function handleStart() {
		if (sessionId) return;
		sessionStatus = 'connecting';

		try {
			const result = await startSession();
			sessionId = result.sessionId;
			sseUrl = result.sseUrl;
			apiKey = result.apiKey;
			sessionStatus = 'active';

			// Start SSE consumer
			startSSE();
		} catch (err) {
			console.error('Session failed:', err);
			sessionStatus = 'error';
		}
	}

	function startSSE() {
		if (!sseUrl || !apiKey) return;

		const es = new EventSource(`/api/sse-proxy?url=${encodeURIComponent(sseUrl)}`);

		es.onmessage = (event) => {
			try {
				const parsed = JSON.parse(event.data);

				if (parsed.type === 'inference.result') {
					const label = parsed.event_data?.response;
					if (label) {
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
					}
				}
			} catch {
				// ignore parse errors
			}
		};

		es.onerror = () => {
			// SSE will auto-reconnect
		};

		sseSource = es;
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

		// Advance playhead and stream windows
		playInterval = setInterval(() => {
			if (playheadIndex < wellData.length - 1) {
				playheadIndex = Math.min(playheadIndex + 20, wellData.length - 1);
			}

			// Stream a window when playhead passes the next window boundary
			const nextWindowStart = streamCounter * STEP_SIZE;
			if (sessionId && playheadIndex >= nextWindowStart + WINDOW_SIZE) {
				streamNextWindow();
			}

			if (playheadIndex >= wellData.length - 1) {
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
			{#if !sessionId}
				<Button variant="default" size="sm" onclick={handleStart} disabled={!selectedWell}>
					Start Analysis
				</Button>
			{:else}
				<Button variant="outline" size="sm" onclick={handleStop}>Stop</Button>
			{/if}
		</div>
	</Menubar>

	<div class="border-border border-b px-4 py-2">
		<WellSelector {wells} bind:selected={selectedWell} onselect={handleWellSelect} />
	</div>

	<div class="border-border border-b px-4 py-2">
		<PlaybackControls
			{playing}
			current={playheadIndex}
			total={wellData.length}
			wellName={selectedWell?.shortName ?? ''}
			onplay={handlePlay}
			onpause={handlePause}
			onreset={handleReset}
		/>
	</div>

	<main class="grid grid-cols-2 grid-rows-1 gap-4 overflow-hidden p-4">
		<SensorChart
			rows={wellData}
			{playheadIndex}
			{classifications}
			onexpand={() => toggleExpand('sensor')}
			class="max-h-full overflow-hidden"
		/>

		<ClassificationLog {classifications} class="max-h-full" />
	</main>
</div>

<!-- Fullscreen overlay -->
{#if expanded}
	<div class="bg-background fixed inset-0 z-50 flex flex-col overflow-hidden">
		<div class="border-border flex items-center justify-between border-b px-4 py-2">
			<span class="text-foreground font-mono text-sm uppercase tracking-wider">Sensor Data</span>
			<Button variant="outline" size="sm" onclick={() => (expanded = null)}>
				<MinimizeIcon class="size-3.5" />
				Close
			</Button>
		</div>
		<div class="min-h-0 flex-1 p-4">
			<SensorChart rows={wellData} {playheadIndex} {classifications} class="h-full" />
		</div>
	</div>
{/if}
