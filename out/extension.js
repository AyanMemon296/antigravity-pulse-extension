"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
const vscode = require("vscode");
let agpStatusBarItem;
// Store the name of the model currently "pinned" to the status bar
let pinnedModelLabel = null;
let currentQuotas = null;
function activate(context) {
    // Use a very high priority (10000) so it doesn't get hidden
    agpStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000);
    const commandId = "antigravity-pulse.openDashboard";
    context.subscriptions.push(vscode.commands.registerCommand(commandId, () => openDashboard()));
    agpStatusBarItem.command = commandId;
    context.subscriptions.push(agpStatusBarItem);
    updatePulse();
    setInterval(() => updatePulse(), 120000);
    agpStatusBarItem.show();
    vscode.window.showInformationMessage("Antigravity Pulse Activated!");
}
async function updatePulse() {
    let data = null;
    try {
        const response = await fetch("http://127.0.0.1:31415/metrics/quota");
        if (response.ok) {
            data = await response.json();
        }
        else {
            throw new Error(`HTTP ${response.status}`);
        }
    }
    catch (err) {
        agpStatusBarItem.text = `$(error) AGP Offline`;
        agpStatusBarItem.tooltip = `Error connecting to local metric server: ${err.message || String(err)}`;
        agpStatusBarItem.show();
        currentQuotas = null;
        return; // Stop rendering UI if we have no data
    }
    currentQuotas = data;
    // Render Status Bar Text
    let statusText = `$(rocket) AGP`;
    if (pinnedModelLabel && data) {
        // Find the percentage for the pinned model
        let pct = 100;
        let label = "";
        if (pinnedModelLabel.includes("High")) {
            pct = data.gemini_pro_high_pct;
            label = "Gemini Pro";
        }
        else if (pinnedModelLabel.includes("Low")) {
            pct = data.gemini_pro_low_pct;
            label = "Gemini Pro";
        }
        else if (pinnedModelLabel.includes("Flash")) {
            pct = data.gemini_flash_pct;
            label = "Gemini Flash";
        }
        else if (pinnedModelLabel.includes("Sonnet")) {
            pct = data.claude_sonnet_pct;
            label = "Claude Sonnet";
        }
        else if (pinnedModelLabel.includes("Opus")) {
            pct = data.claude_opus_pct;
            label = "Claude Opus";
        }
        else if (pinnedModelLabel.includes("GPT")) {
            pct = data.gpt_oss_pct;
            label = "GPT-OSS";
        }
        statusText = `$(rocket) ${label} ${pct ?? 'N/A'}%`;
    }
    agpStatusBarItem.text = statusText;
    // Render 6-row hover Markdown
    const hoverContent = new vscode.MarkdownString();
    hoverContent.isTrusted = true;
    hoverContent.supportThemeIcons = true;
    hoverContent.appendMarkdown(`### Model Quota Overview\n\n`);
    hoverContent.appendMarkdown(`| Model | % | Reset |\n| :--- | :--- | :--- |\n`);
    if (data) {
        hoverContent.appendMarkdown(`| **Gemini 3.1 Pro (High)** | ${data.gemini_pro_high_pct ?? 'N/A'}% | ${data.gemini_pro_high_reset ?? 'N/A'} |\n`);
        hoverContent.appendMarkdown(`| **Gemini 3.1 Pro (Low)** | ${data.gemini_pro_low_pct ?? 'N/A'}% | ${data.gemini_pro_low_reset ?? 'N/A'} |\n`);
        hoverContent.appendMarkdown(`| **Gemini 3 Flash** | ${data.gemini_flash_pct ?? 'N/A'}% | ${data.gemini_flash_reset ?? 'N/A'} |\n`);
        hoverContent.appendMarkdown(`| **Claude Sonnet 4.6** | ${data.claude_sonnet_pct ?? 'N/A'}% | ${data.claude_sonnet_reset ?? 'N/A'} |\n`);
        hoverContent.appendMarkdown(`| **Claude Opus 4.6** | ${data.claude_opus_pct ?? 'N/A'}% | ${data.claude_opus_reset ?? 'N/A'} |\n`);
        hoverContent.appendMarkdown(`| **GPT-OSS 120B** | ${data.gpt_oss_pct ?? 'N/A'}% | ${data.gpt_oss_reset ?? 'N/A'} |\n`);
    }
    agpStatusBarItem.tooltip = hoverContent;
    agpStatusBarItem.show();
}
async function openDashboard() {
    let items = [];
    try {
        const response = await fetch("http://127.0.0.1:31415/metrics/quota/detailed");
        if (response.ok) {
            const detailedData = await response.json();
            // Map the payload to QuickPickItems
            // Assuming the endpoint returns an array of [{ label, description, detail }, ...]
            items = detailedData.map((item) => ({
                label: item.label || 'Unknown Model',
                description: String(item.description || item.pct || 'N/A%'),
                detail: String(item.detail || `Resets in: ${item.reset || 'N/A'}`)
            }));
        }
        else {
            throw new Error("Failed to fetch detailed quotas");
        }
    }
    catch (e) {
        // If fetching detailed data fails, fallback to rendering the simple data we already have
        const d = currentQuotas;
        if (d) {
            items = [
                { label: "Gemini 3.1 Pro (High)", description: `${d.gemini_pro_high_pct ?? 'N/A'}%`, detail: `Resets in: ${d.gemini_pro_high_reset ?? 'N/A'}` },
                { label: "Gemini 3.1 Pro (Low)", description: `${d.gemini_pro_low_pct ?? 'N/A'}%`, detail: `Resets in: ${d.gemini_pro_low_reset ?? 'N/A'}` },
                { label: "Gemini 3 Flash", description: `${d.gemini_flash_pct ?? 'N/A'}%`, detail: `Resets in: ${d.gemini_flash_reset ?? 'N/A'}` },
                { label: "Claude Sonnet 4.6 (Thinking)", description: `${d.claude_sonnet_pct ?? 'N/A'}%`, detail: `Resets in: ${d.claude_sonnet_reset ?? 'N/A'}` },
                { label: "Claude Opus 4.6 (Thinking)", description: `${d.claude_opus_pct ?? 'N/A'}%`, detail: `Resets in: ${d.claude_opus_reset ?? 'N/A'}` },
                { label: "GPT-OSS 120B (Medium)", description: `${d.gpt_oss_pct ?? 'N/A'}%`, detail: `Resets in: ${d.gpt_oss_reset ?? 'N/A'}` },
            ];
        }
        else {
            vscode.window.showErrorMessage("Antigravity server is offline. Could not fetch models.");
            return; // Stop if there's no data at all
        }
    }
    const quickPick = vscode.window.createQuickPick();
    quickPick.title = "Model Quotas (Click to Pin to Status Bar)";
    quickPick.placeholder = "Search or select a model to pin to your status bar";
    quickPick.items = items;
    // Highlight the currently pinned model with an icon
    if (pinnedModelLabel) {
        quickPick.activeItems = quickPick.items.filter(i => i.label === pinnedModelLabel);
        quickPick.items = quickPick.items.map(i => {
            if (i.label === pinnedModelLabel) {
                return { ...i, label: `$(check) ${i.label}` };
            }
            return i;
        });
    }
    quickPick.onDidChangeSelection(selection => {
        if (selection[0]) {
            // Remove visual checkmark if it exists
            const cleanLabel = selection[0].label.replace('$(check) ', '');
            // Toggle logic: If clicking the one already pinned, unpin it. Otherwise pin it.
            if (pinnedModelLabel === cleanLabel) {
                pinnedModelLabel = null;
            }
            else {
                pinnedModelLabel = cleanLabel;
            }
            // Immediately refresh UI and close pick
            updatePulse();
            quickPick.hide();
        }
    });
    quickPick.show();
}
//# sourceMappingURL=extension.js.map