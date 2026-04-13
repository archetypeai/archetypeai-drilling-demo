<script>
	import { cn } from '$lib/utils.js';
	import Menubar from '$lib/components/ui/patterns/menubar/index.js';
	import { Button } from '$lib/components/ui/primitives/button/index.js';
	import StatusBadge from '$lib/components/ui/patterns/status-badge/status-badge.svelte';
	import WellSelector from '$lib/components/ui/custom/well-selector.svelte';
	import RigDashboard from '$lib/components/ui/custom/rig-dashboard.svelte';
	import ClassificationLog from '$lib/components/ui/custom/classification-log.svelte';
	import AccuracyPanel from '$lib/components/ui/custom/accuracy-panel.svelte';
	import ABTestingPanel from '$lib/components/ui/custom/ab-testing-panel.svelte';
	import AutoOptimizer from '$lib/components/ui/custom/auto-optimizer.svelte';
	import ConfirmModal from '$lib/components/ui/custom/confirm-modal.svelte';
	import PlaybackControls from '$lib/components/ui/custom/playback-controls.svelte';
	import MinimizeIcon from '@lucide/svelte/icons/minimize-2';
	import SpinnerIcon from '@lucide/svelte/icons/loader';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import WandIcon from '@lucide/svelte/icons/wand-sparkles';
	import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
	import { fetchWells, fetchWellChunk, startSession, streamWindowToNewton, endSession } from '$lib/api/drilling.js';

	const DEFAULT_CONFIG = {
		windowSize: 64,
		stepSize: 64,
		nShotPerClass: 2000,
		nNeighbors: 5,
		metric: 'euclidean',
		algorithm: 'ball_tree'
	};
	const CONFIG_KEY = 'newton-drilling-config';

	function loadSavedConfig() {
		if (typeof localStorage === 'undefined') return { ...DEFAULT_CONFIG };
		try {
			const saved = localStorage.getItem(CONFIG_KEY);
			if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved), saved: true };
		} catch {}
		return { ...DEFAULT_CONFIG };
	}

	function saveConfig(config) {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
		} catch {}
	}

	const savedConfig = loadSavedConfig();
	const WINDOW_SIZE = savedConfig.windowSize;
	const STEP_SIZE = savedConfig.stepSize;

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
	let apiKey = $state(null);
	let sessionStatus = $state('idle');
	let setupStep = $state('');
	let advancedMode = $state(false);

	let currentConfig = $state({ ...savedConfig });

	// Config apply modal
	let showApplyModal = $state(false);
	let pendingConfig = $state(null);
	let classifications = $state([]);
	let streamCounter = $state(0);
	let expanded = $state(null);

	let sseSource = $state(null);

	// A/B testing state
	let abSessions = $state({ a: null, b: null });

	// Optimizer state
	let advancedTab = $state('manual'); // 'manual' | 'auto'
	let optimizerRunning = $state(false);
	let optimizerResults = $state([]);
	let optimizerRef = $state(null);
	let optimizerSession = $state(null);
	let optimizerSseSource = $state(null);

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
			// Just reset playback state for the new well
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
			apiKey = result.apiKey;
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
		} catch {}
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
				// Try a fresh connection after a delay
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
		// Wait for well data to be available
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

		// Advance playhead and stream windows
		playInterval = setInterval(() => {
			if (playheadIndex < wellData.length - 1) {
				playheadIndex = Math.min(playheadIndex + 20, wellData.length - 1);
			}

			// Load more data when approaching the end of loaded rows
			maybeLoadMore();

			// Stream windows to keep up with playhead
			if (sessionId) {
				const nextWindowStart = streamCounter * STEP_SIZE;
				if (playheadIndex >= nextWindowStart) {
					streamNextWindow();
				}
			}

			// Stream to A/B test sessions
			streamToABSessions();

			// Only stop if we've reached the end of ALL data (not just loaded data)
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

	// A/B testing: start a session with specific config
	async function handleABStart(slot, config) {
		try {
			const result = await startSession(() => {}, config);
			const sseUrl = `/api/sse-proxy?url=${encodeURIComponent(result.sseUrl)}`;

			abSessions = {
				...abSessions,
				[slot]: {
					sessionId: result.sessionId,
					sseUrl: result.sseUrl,
					sseSource: null,
					config,
					classifications: [],
					streamCounter: 0
				}
			};

			const sseEs = connectSSE(sseUrl, (label) => {
				if (abSessions[slot]) {
					const windowIdx = abSessions[slot].classifications.length;
					const stepSize = config.windowSize;
					abSessions[slot].classifications = [
						...abSessions[slot].classifications,
						{
							id: crypto.randomUUID(),
							label,
							windowStart: windowIdx * stepSize,
							windowEnd: (windowIdx + 1) * stepSize
						}
					];
					abSessions = { ...abSessions };
				}
			});
			abSessions[slot].sseSource = sseEs;

			// Wait for n-shot processing then pre-stream windows
			await new Promise((r) => setTimeout(r, 3000));

			if (wellData.length >= config.windowSize) {
				for (let i = 0; i < 10 && (i + 1) * config.windowSize <= wellData.length; i++) {
					const start = i * config.windowSize;
					const windowRows = wellData.slice(start, start + config.windowSize);
					await streamWindowToNewton(result.sessionId, windowRows);
					if (abSessions[slot]) abSessions[slot].streamCounter = i + 1;
					await new Promise((r) => setTimeout(r, 200));
				}
			}
		} catch (err) {
			console.error(`A/B session ${slot} failed:`, err);
		}
	}

	async function handleABStop(slot) {
		const session = abSessions[slot];
		if (!session) return;
		if (session.sseSource) session.sseSource.close();
		if (session.sessionId) {
			try { await endSession(session.sessionId); } catch {}
		}
		abSessions = { ...abSessions, [slot]: null };
	}

	// Auto optimizer: start a config
	async function handleOptimizerStart(config) {
		// Pause main session SSE to avoid competing consumers
		if (sseSource) {
			console.log('[OPTIMIZER] pausing main SSE');
			sseSource.close();
			sseSource = null;
		}

		// Clean up previous optimizer session
		if (optimizerSseSource) optimizerSseSource.close();
		if (optimizerSession) {
			try { await endSession(optimizerSession); } catch {}
		}

		const result = await startSession(() => {}, config);
		optimizerSession = result.sessionId;
		console.log('[OPTIMIZER] session:', result.sessionId, 'sseUrl:', result.sseUrl);
		console.log('[OPTIMIZER] main session:', sessionId, 'main sseUrl:', sseUrl);

		const sseProxyUrl = `/api/sse-proxy?url=${encodeURIComponent(result.sseUrl)}`;
		const es = new EventSource(sseProxyUrl);
		optimizerSseSource = es;

		es.onmessage = (event) => {
			const label = parseSSELabel(event);
			if (!label) return;
			console.log('[OPTIMIZER SSE] received:', label);
			const idx = optimizerResults.findIndex((r) => r.status === 'running');
			if (idx >= 0 && optimizerRef) {
				const stepSize = optimizerResults[idx].config.windowSize;
				const windowIdx = optimizerResults[idx].classifications.length;
				optimizerRef.receiveClassification(
					label,
					windowIdx * stepSize,
					(windowIdx + 1) * stepSize
				);
			} else {
				console.warn('[OPTIMIZER SSE] no running config, idx:', idx);
			}
		};

		es.onopen = () => {
			console.log('[OPTIMIZER SSE] connection opened');
		};

		es.onerror = (e) => {
			console.warn('[OPTIMIZER SSE] error, readyState:', es.readyState);
		};

		// Wait for SSE connection to open and n-shot processing to complete
		console.log('[OPTIMIZER] waiting for SSE + n-shot processing...');
		await new Promise((resolve) => {
			const check = setInterval(() => {
				if (es.readyState === EventSource.OPEN) {
					clearInterval(check);
					// Extra time for n-shot processing
					setTimeout(resolve, 5000);
				}
			}, 500);
			// Fallback: proceed after 30s even if not open
			setTimeout(() => { clearInterval(check); resolve(); }, 30000);
		});
		console.log('[OPTIMIZER] SSE ready, streaming windows with 2s delays...');

		// Stream windows gradually (not burst) — matching A/B pattern
		const windowSize = config.windowSize;
		for (let i = 0; i < 20 && i * windowSize + windowSize <= wellData.length; i++) {
			if (!optimizerSession) break; // stopped
			const start = i * windowSize;
			const windowRows = wellData.slice(start, start + windowSize);
			await streamWindowToNewton(result.sessionId, windowRows);
			console.log(`[OPTIMIZER] streamed window ${i + 1}/20`);
			// Longer delay between windows — give Newton time to process and respond
			await new Promise((r) => setTimeout(r, 2000));
		}
		console.log('[OPTIMIZER] all windows streamed, waiting for results...');
	}

	async function handleOptimizerStop() {
		if (optimizerSseSource) { optimizerSseSource.close(); optimizerSseSource = null; }
		if (optimizerSession) {
			try { await endSession(optimizerSession); } catch {}
			optimizerSession = null;
		}
		// Reconnect main SSE if session is still active
		if (sessionId && sseUrl && !sseSource) {
			console.log('[OPTIMIZER] reconnecting main SSE');
			startSSE();
		}
	}

	function handleApplyConfig(config) {
		pendingConfig = { ...config, stepSize: config.stepSize || config.windowSize };
		showApplyModal = true;
	}

	async function confirmApplyConfig() {
		if (!pendingConfig) return;

		// Stop current main session
		await handleStop();

		// Update config and persist to localStorage
		currentConfig = {
			...currentConfig,
			windowSize: pendingConfig.windowSize,
			stepSize: pendingConfig.stepSize,
			nNeighbors: pendingConfig.nNeighbors,
			metric: pendingConfig.metric,
			weights: pendingConfig.weights || 'uniform',
			algorithm: pendingConfig.algorithm || 'ball_tree'
		};
		saveConfig(currentConfig);

		// Reset state
		classifications = [];
		streamCounter = 0;
		playheadIndex = 0;

		// Start new session with the applied config
		sessionStatus = 'connecting';
		setupStep = 'Applying new config...';

		try {
			const result = await startSession((step) => { setupStep = step; }, pendingConfig);
			sessionId = result.sessionId;
			sseUrl = result.sseUrl;
			apiKey = result.apiKey;
			sessionStatus = 'active';
			setupStep = '';
			startSSE();
			preStreamWindows(5);

			// Auto-play after applying config
			handlePlay();
		} catch (err) {
			console.error('Session failed:', err);
			sessionStatus = 'error';
			setupStep = '';
		}

		pendingConfig = null;
	}

	// Stream data to A/B sessions during playback
	function streamToABSessions() {
		for (const slot of ['a', 'b']) {
			const session = abSessions[slot];
			if (!session?.sessionId) continue;
			const stepSize = session.config.windowSize;
			const nextStart = session.streamCounter * stepSize;
			if (playheadIndex >= nextStart && nextStart + stepSize <= wellData.length) {
				const windowRows = wellData.slice(nextStart, nextStart + stepSize);
				streamWindowToNewton(session.sessionId, windowRows);
				session.streamCounter++;
			}
		}
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
		advancedMode ? 'grid-cols-[3fr_2fr_2fr_2fr] grid-rows-[minmax(0,1fr)]' : 'grid-cols-[2fr_1fr] grid-rows-[minmax(0,1fr)]'
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
					windowSize={WINDOW_SIZE}
					stepSize={STEP_SIZE}
					config={currentConfig}
				/>
			</div>

			<div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
				<div class="flex gap-1">
					<Button
						variant={advancedTab === 'manual' ? 'default' : 'outline'}
						size="sm"
						onclick={() => (advancedTab = 'manual')}
					>
						<FlaskConicalIcon class="size-3" aria-hidden="true" />
						Manual A/B
					</Button>
					<Button
						variant={advancedTab === 'auto' ? 'default' : 'outline'}
						size="sm"
						onclick={() => (advancedTab = 'auto')}
					>
						<WandIcon class="size-3" aria-hidden="true" />
						Auto Optimize
					</Button>
				</div>

				{#if advancedTab === 'manual'}
					<ABTestingPanel
						rows={wellData}
						bind:sessionsData={abSessions}
						onstartSession={handleABStart}
						onstopSession={handleABStop}
						onapplyConfig={handleApplyConfig}
						class="min-h-0 flex-1"
					/>
				{:else}
					<AutoOptimizer
						bind:this={optimizerRef}
						rows={wellData}
						bind:running={optimizerRunning}
						bind:results={optimizerResults}
						onstartConfig={handleOptimizerStart}
						onstopConfig={handleOptimizerStop}
						onapplyConfig={handleApplyConfig}
						class="min-h-0 flex-1"
					/>
				{/if}
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

<!-- Apply config confirmation modal (inline to avoid grid containment) -->
{#if showApplyModal && pendingConfig}
	<div
		style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);"
		onclick={(e) => { if (e.target === e.currentTarget) showApplyModal = false; }}
		onkeydown={(e) => { if (e.key === 'Escape') showApplyModal = false; }}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div style="background:var(--card);border:1px solid var(--border);border-radius:2px;padding:24px;width:420px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
			<h3 class="text-foreground mb-4 font-mono text-base uppercase tracking-wider">Apply Config</h3>
			<p class="text-foreground mb-3 text-sm">
				This will stop the current session and restart with the new config:
			</p>
			<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 16px;font-family:var(--font-mono);font-size:14px;margin-bottom:16px;">
				<span class="text-muted-foreground">Window size</span><span class="text-foreground">{pendingConfig.windowSize}</span>
				<span class="text-muted-foreground">Step size</span><span class="text-foreground">{pendingConfig.stepSize || pendingConfig.windowSize}</span>
				<span class="text-muted-foreground">K neighbors</span><span class="text-foreground">{pendingConfig.nNeighbors}</span>
				<span class="text-muted-foreground">Metric</span><span class="text-foreground">{pendingConfig.metric}</span>
				<span class="text-muted-foreground">Weights</span><span class="text-foreground">{pendingConfig.weights}</span>
			</div>
			<p class="text-muted-foreground mb-4 text-xs">
				Playback will reset. Classification history will be cleared. Config will be saved for next app load.
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="outline" size="sm" onclick={() => (showApplyModal = false)}>Cancel</Button>
				<Button variant="default" size="sm" onclick={() => { showApplyModal = false; confirmApplyConfig(); }}>Apply & Restart</Button>
			</div>
		</div>
	</div>
{/if}
