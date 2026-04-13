<script>
	import { cn } from '$lib/utils.js';
	import { Button } from '$lib/components/ui/primitives/button/index.js';

	let {
		open = $bindable(false),
		title = 'Confirm',
		onconfirm,
		oncancel,
		children,
		class: className,
		...restProps
	} = $props();

	function handleConfirm() {
		onconfirm?.();
		open = false;
	}

	function handleCancel() {
		oncancel?.();
		open = false;
	}

	function handleBackdrop(e) {
		if (e.target === e.currentTarget) handleCancel();
	}

	function handleKeydown(e) {
		if (e.key === 'Escape') handleCancel();
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
		style="width: 100vw; height: 100vh; top: 0; left: 0;"
		onclick={handleBackdrop}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class={cn('bg-card border-border mx-4 w-full max-w-lg rounded-xs border p-6 shadow-lg', className)} {...restProps}>
			<h3 class="text-foreground mb-3 font-mono text-base font-normal uppercase tracking-wider">{title}</h3>

			<div class="mb-6">
				{@render children?.()}
			</div>

			<div class="flex justify-end gap-2">
				<Button variant="outline" size="sm" onclick={handleCancel}>Cancel</Button>
				<Button variant="default" size="sm" onclick={handleConfirm}>Apply & Restart</Button>
			</div>
		</div>
	</div>
{/if}
