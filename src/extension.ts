import * as vscode from 'vscode';
import { AuthManager } from './auth';

// ─── State ────────────────────────────────────────────────────────────────────

let agpStatusBarItem: vscode.StatusBarItem;
export let authManager: AuthManager;
export let extensionGlobalStorageUri: vscode.Uri;

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
	authManager = new AuthManager(context.secrets);
	extensionGlobalStorageUri = context.globalStorageUri;

	const commandId = 'antigravity-pulse-monitor.openDashboard';
	context.subscriptions.push(
		vscode.commands.registerCommand(commandId, () => showSunsetNotice())
	);

	// Setup Passive Sunset Badge
	agpStatusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		10000
	);
	agpStatusBarItem.command = commandId;
	agpStatusBarItem.text = `$(info) AGP Sunset`;
	agpStatusBarItem.tooltip = new vscode.MarkdownString(
		`**Antigravity Pulse — Officially Sunset**\n\n` +
		`Native quota tracking is now integrated into the Antigravity model picker.\n\n` +
		`You can safely uninstall this extension.`
	);
	agpStatusBarItem.show();
	context.subscriptions.push(agpStatusBarItem);
}

export function deactivate() {
	// Clean shutdown — no background timers to cancel
}

// ─── Sunset Dialog ────────────────────────────────────────────────────────────

function showSunsetNotice() {
	vscode.window.showInformationMessage(
		'Antigravity Pulse Monitor is now deprecated: Native quota tracking is directly integrated into the Antigravity IDE model picker. You can safely uninstall this extension.',
		'Got It'
	);
}
