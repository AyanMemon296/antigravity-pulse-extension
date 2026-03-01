import * as vscode from 'vscode';
import { AntigravityApi, ModelQuota, QuotaSnapshot } from './api';

// ─── State ────────────────────────────────────────────────────────────────────

let agpStatusBarItem: vscode.StatusBarItem;
let pinnedModelLabel: string | null = null;
let currentSnapshot: QuotaSnapshot | null = null;
let refreshIntervalId: NodeJS.Timeout | undefined;
const api = new AntigravityApi();

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
	agpStatusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		10000
	);

	const commandId = 'antigravity-pulse.openDashboard';
	context.subscriptions.push(
		vscode.commands.registerCommand(commandId, () => openDashboard())
	);
	agpStatusBarItem.command = commandId;
	context.subscriptions.push(agpStatusBarItem);

	// Read initial refresh interval setting
	const config = vscode.workspace.getConfiguration('antigravity-pulse');
	const intervalMs = config.get<number>('refreshInterval', 120000);

	updatePulse();
	refreshIntervalId = setInterval(() => updatePulse(), intervalMs);

	// Listen for settings changes to update interval live
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('antigravity-pulse.refreshInterval')) {
			if (refreshIntervalId) { clearInterval(refreshIntervalId); }
			const newInterval = vscode.workspace.getConfiguration('antigravity-pulse').get<number>('refreshInterval', 120000);
			refreshIntervalId = setInterval(() => updatePulse(), newInterval);
		}
	}));

	agpStatusBarItem.show();
}

export function deactivate() {
	if (refreshIntervalId) {
		clearInterval(refreshIntervalId);
	}
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

/** Format remaining time until reset as "Xh Ym" or "Ready" */
function formatTimeRemaining(resetMs: number): string {
	if (!resetMs || resetMs <= 0) { return 'N/A'; }
	const diff = resetMs - Date.now();
	if (diff <= 0) { return 'Ready'; }
	const totalMins = Math.ceil(diff / 60000);
	if (totalMins < 60) { return `${totalMins}m`; }
	const hours = Math.floor(totalMins / 60);
	const mins = totalMins % 60;
	return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/** Format a reset timestamp into local date+time string, e.g. "02/03/2026 21:39" */
function formatResetDate(resetMs: number): string {
	if (!resetMs || resetMs <= 0) { return 'N/A'; }
	const d = new Date(resetMs);
	const day = String(d.getDate()).padStart(2, '0');
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const year = d.getFullYear();
	const hour = String(d.getHours()).padStart(2, '0');
	const min = String(d.getMinutes()).padStart(2, '0');
	return `${day}/${month}/${year} ${hour}:${min}`;
}

/** Format a fraction (0–1) as a rounded percentage string e.g. "92%" */
function formatPct(fraction: number): string {
	return `${Math.round(fraction * 100)}%`;
}

// ─── Core Refresh ─────────────────────────────────────────────────────────────

async function updatePulse() {
	try {
		currentSnapshot = await api.fetchQuota();
	} catch (err: any) {
		// Graceful offline state
		agpStatusBarItem.text = `$(error) AGP Offline`;
		agpStatusBarItem.tooltip = new vscode.MarkdownString(
			`**Antigravity Pulse** — Offline\n\n` +
			`Could not reach the Antigravity language server.\n\n` +
			`_Make sure Antigravity IDE is running._`
		);
		agpStatusBarItem.show();
		
		// If user enabled noisy notifications in settings, show an error popup
		const showNotifs = vscode.workspace.getConfiguration('antigravity-pulse').get<boolean>('showNotifications', false);
		if (showNotifs && currentSnapshot !== null) { 
			// Check currentSnapshot !== null to prevent spamming notifications on every 2 min tick if already offline
			vscode.window.showErrorMessage(`Antigravity Pulse Offline: Could not reach the language server.`);
		}

		currentSnapshot = null;
		return;
	}

	renderStatusBar(currentSnapshot);
	renderTooltip(currentSnapshot);
	agpStatusBarItem.show();
}

// ─── Status Bar Text ──────────────────────────────────────────────────────────

function renderStatusBar(snapshot: QuotaSnapshot) {
	if (!pinnedModelLabel) {
		agpStatusBarItem.text = `$(rocket) AGP`;
		return;
	}

	const model = snapshot.models.find(m => m.label === pinnedModelLabel);
	if (model) {
		const pct = Math.round(model.remainingFraction * 100);
		// Pick a colour icon based on remaining quota
		const icon = pct > 50 ? '$(rocket)' : pct > 20 ? '$(warning)' : '$(error)';
		agpStatusBarItem.text = `${icon} ${model.label} ${pct}%`;
	} else {
		agpStatusBarItem.text = `$(rocket) AGP`;
	}
}

// ─── Hover Tooltip ────────────────────────────────────────────────────────────

function renderTooltip(snapshot: QuotaSnapshot) {
	const md = new vscode.MarkdownString();
	md.isTrusted = true;
	md.supportThemeIcons = true;

	md.appendMarkdown(`👤 **${snapshot.email}**\n\n`);
	md.appendMarkdown(`### Model Quota Overview\n\n`);
	md.appendMarkdown(`| Model | Remaining | Resets In |\n| :--- | :---: | :--- |\n`);

	for (const m of snapshot.models) {
		const pct = formatPct(m.remainingFraction);
		const reset = formatTimeRemaining(m.resetTime);
		md.appendMarkdown(`| **${m.label}** | ${pct} | ${reset} |\n`);
	}

	md.appendMarkdown(`\n_Click to open dashboard · Refreshes every 2 min_`);
	agpStatusBarItem.tooltip = md;
}

// ─── Dashboard (QuickPick) ────────────────────────────────────────────────────

async function openDashboard() {
	// Use stale snapshot immediately so the picker opens instantly,
	// then trigger a background refresh for next open
	if (!currentSnapshot) {
		try {
			// Show a loading indicator while we fetch for the first time
			agpStatusBarItem.text = `$(sync~spin) AGP`;
			currentSnapshot = await api.fetchQuota();
			renderStatusBar(currentSnapshot);
		} catch (err: any) {
			vscode.window.showErrorMessage(
				`Antigravity Pulse: Cannot open dashboard — ${err.message ?? 'Language server is offline.'}`
			);
			agpStatusBarItem.text = `$(error) AGP Offline`;
			return;
		}
	}

	const snapshot = currentSnapshot;

	const items: vscode.QuickPickItem[] = snapshot.models.map((m: ModelQuota) => {
		const pct = formatPct(m.remainingFraction);
		const remaining = formatTimeRemaining(m.resetTime);
		const resetDate = formatResetDate(m.resetTime);
		const isPinned = pinnedModelLabel === m.label;
		return {
			label: isPinned ? `$(check) ${m.label}` : m.label,
			description: pct,
			detail: remaining !== 'N/A'
				? `Resets in: ${remaining}  (${resetDate})`
				: 'Reset time unavailable'
		};
	});

	const quickPick = vscode.window.createQuickPick();
	quickPick.title = `Antigravity Pulse — 👤 ${snapshot.email}`;
	quickPick.placeholder = 'Click a model to pin it to the status bar (click again to unpin)';
	quickPick.items = items;
	quickPick.matchOnDescription = true;
	quickPick.matchOnDetail = false;

	// Pre-select the currently pinned model
	if (pinnedModelLabel) {
		quickPick.activeItems = quickPick.items.filter(i =>
			i.label.replace('$(check) ', '') === pinnedModelLabel
		);
	}

	quickPick.onDidChangeSelection(selection => {
		if (selection[0]) {
			const cleanLabel = selection[0].label.replace('$(check) ', '');
			// Toggle: clicking the pinned model unpins it
			pinnedModelLabel = (pinnedModelLabel === cleanLabel) ? null : cleanLabel;
			renderStatusBar(snapshot);
			renderTooltip(snapshot);
			quickPick.hide();
		}
	});

	quickPick.show();

	// Silently refresh in background after showing stale data
	api.fetchQuota().then(fresh => {
		currentSnapshot = fresh;
	}).catch(() => { /* ignore background refresh errors */ });
}
