import { spawn } from 'child_process';
import * as https from 'https';

// ─── Public Interfaces ────────────────────────────────────────────────────────

export interface ModelQuota {
	label: string;
	modelId: string;
	remainingFraction: number;
	resetTime: number; // Unix timestamp ms
}

export interface QuotaSnapshot {
	email: string;
	models: ModelQuota[];
}

// ─── Internal Types ───────────────────────────────────────────────────────────

interface ProcessDetails {
	pid: number;
	csrfToken: string;
}

// ─── AntigravityApi Class ─────────────────────────────────────────────────────

export class AntigravityApi {

	// Cache discovered connection details to avoid re-running PowerShell every tick
	private cachedPid: number | null = null;
	private cachedCsrfToken: string | null = null;
	private cachedPort: number | null = null;

	// ─── Step 1: Shell Execution ───────────────────────────────────────────────

	/**
	 * Spawns an external process and resolves with its full stdout.
	 * Passing exe + args[] separately avoids ALL quoting and escaping issues.
	 */
	private runCommand(exe: string, args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const proc = spawn(exe, args, { shell: false });
			let stdout = '';
			let stderr = '';
			proc.stdout.on('data', (d: Buffer) => stdout += d.toString());
			proc.stderr.on('data', (d: Buffer) => stderr += d.toString());
			proc.on('close', (code: number) => {
				// We resolve even on non-zero exit for commands like Get-NetTCPConnection
				// that may return exit code 1 when no results, but still produce usable stdout
				resolve(stdout.trim());
			});
			proc.on('error', reject);
		});
	}

	// ─── Step 2: Process Discovery ─────────────────────────────────────────────

	/**
	 * Finds the Antigravity language server process and extracts the CSRF token.
	 *
	 * Key design decisions (from studying ag-usage-main and AntigravityQuota-main):
	 *  - Use pipe-delimited output "PID|CommandLine" instead of ConvertTo-Json
	 *    because ConvertTo-Json truncates long CommandLine strings.
	 *  - Filter for \antigravity\ in the path to distinguish the Antigravity IDE
	 *    process from the VS Code Codeium extension (both run language_server_windows_x64.exe).
	 */
	private async discoverProcess(): Promise<ProcessDetails> {
		// Pipe-delimited: "ProcessId|CommandLine" — no JSON, no truncation
		const psScript =
			`Get-CimInstance Win32_Process ` +
			`-Filter "name='language_server_windows_x64.exe'" ` +
			`| Select-Object ProcessId, CommandLine ` +
			`| ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`;

		const output = await this.runCommand('powershell', [
			'-NoProfile',
			'-NonInteractive',
			'-Command',
			psScript
		]);

		if (!output) {
			throw new Error('Antigravity language server process not found. Is Antigravity running?');
		}

		const lines = output.split(/\r?\n/).filter(l => l.trim().length > 0);

		for (const line of lines) {
			const separatorIndex = line.indexOf('|');
			if (separatorIndex === -1) { continue; }

			const pidStr = line.substring(0, separatorIndex).trim();
			const cmd = line.substring(separatorIndex + 1).trim();
			const pid = parseInt(pidStr, 10);

			if (isNaN(pid) || !cmd) { continue; }

			// Filter: must belong to Antigravity IDE, not VS Code Codeium extension
			const cmdLower = cmd.toLowerCase();
			const isAntigravity =
				/--app_data_dir\s+antigravity\b/i.test(cmd) ||
				cmdLower.includes('\\antigravity\\') ||
				cmdLower.includes('/antigravity/');

			if (!isAntigravity) { continue; }

			// Extract the CSRF token — handles both quoted and unquoted values
			const tokenMatch =
				cmd.match(/--csrf_token[=\s]+"([^"]+)"/i) ||
				cmd.match(/--csrf_token[=\s]+'([^']+)'/i) ||
				cmd.match(/--csrf_token[=\s]+([\w-]+)/i);

			if (tokenMatch?.[1]) {
				return { pid, csrfToken: tokenMatch[1].trim() };
			}
		}

		throw new Error('Antigravity process found but CSRF token could not be extracted from its command line.');
	}

	// ─── Step 3: Port Discovery ────────────────────────────────────────────────

	/**
	 * Returns all TCP ports the given PID is listening on.
	 * Uses Get-NetTCPConnection with a plain text fallback to netstat.
	 */
	private async discoverPorts(pid: number): Promise<number[]> {
		// Primary: PowerShell Get-NetTCPConnection
		try {
			const psScript =
				`Get-NetTCPConnection -OwningProcess ${pid} -State Listen ` +
				`-ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort`;

			const output = await this.runCommand('powershell', [
				'-NoProfile',
				'-NonInteractive',
				'-Command',
				psScript
			]);

			const ports = output
				.split(/\r?\n/)
				.map(l => parseInt(l.trim(), 10))
				.filter(p => !isNaN(p) && p > 0 && p < 65536);

			if (ports.length > 0) { return ports; }
		} catch (_) {
			// Fall through to netstat
		}

		// Fallback: netstat
		const netstatOutput = await this.runCommand('netstat', ['-ano', '-p', 'tcp']);
		const ports: number[] = [];
		for (const line of netstatOutput.split(/\r?\n/)) {
			const parts = line.trim().split(/\s+/);
			if (parts.length < 5) { continue; }
			if (parseInt(parts[parts.length - 1], 10) !== pid) { continue; }
			if (!parts[1]?.includes('LISTEN') && !parts[3]?.includes('LISTEN') && !line.includes('LISTENING')) { continue; }
			const localAddr = parts[1] || '';
			const colonIdx = localAddr.lastIndexOf(':');
			if (colonIdx !== -1) {
				const port = parseInt(localAddr.substring(colonIdx + 1), 10);
				if (!isNaN(port) && port > 0) { ports.push(port); }
			}
		}

		return ports;
	}

	// ─── Step 4: HTTPS Request ─────────────────────────────────────────────────

	/**
	 * Makes an HTTPS POST request to the Antigravity language server's GetUserStatus endpoint.
	 *
	 * CRITICAL: rejectUnauthorized MUST be false.
	 * The local server generates a self-signed TLS certificate dynamically.
	 * Standard HTTPS will reject this cert and drop the connection silently.
	 */
	private makeRequest(port: number, csrfToken: string): Promise<any> {
		return new Promise((resolve, reject) => {
			// Body matches what AntigravityQuota-main sends exactly
			const body = JSON.stringify({
				metadata: {
					ideName: 'antigravity',
					extensionName: 'antigravity',
					locale: 'en'
				}
			});

			const options: https.RequestOptions = {
				hostname: '127.0.0.1',
				port,
				path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(body),
					'X-Codeium-Csrf-Token': csrfToken,
					'Connect-Protocol-Version': '1'
				},
				rejectUnauthorized: false, // MUST be false — self-signed local TLS cert
				timeout: 5000
			};

			const req = https.request(options, res => {
				let data = '';
				res.on('data', (chunk: string) => data += chunk);
				res.on('end', () => {
					if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
						try {
							resolve(JSON.parse(data));
						} catch {
							reject(new Error('Failed to parse JSON response from language server.'));
						}
					} else {
						reject(new Error(`HTTP ${res.statusCode} from port ${port}`));
					}
				});
			});

			req.on('error', reject);
			req.on('timeout', () => {
				req.destroy();
				reject(new Error(`Connection to port ${port} timed out.`));
			});

			req.write(body);
			req.end();
		});
	}

	// ─── Step 5: Orchestration ─────────────────────────────────────────────────

	/**
	 * Fetches the raw JSON payload from the language server.
	 * Caches PID, token, and port to avoid re-running PowerShell every poll cycle.
	 * Clears cache and retries once if the cached port stops responding.
	 */
	private async fetchRawPayload(): Promise<any> {
		// Fast path: try the already-known working port
		if (this.cachedPort !== null && this.cachedCsrfToken !== null) {
			try {
				return await this.makeRequest(this.cachedPort, this.cachedCsrfToken);
			} catch {
				// Server may have restarted — clear the cache and fall through to rediscover
				this.cachedPid = null;
				this.cachedCsrfToken = null;
				this.cachedPort = null;
			}
		}

		// Discover process (PID + CSRF token)
		const { pid, csrfToken } = await this.discoverProcess();
		this.cachedPid = pid;
		this.cachedCsrfToken = csrfToken;

		// Discover all listening ports for that PID
		const ports = await this.discoverPorts(pid);
		if (ports.length === 0) {
			throw new Error(`No listening ports found for Antigravity process (PID ${pid}).`);
		}

		// Probe each port until one responds correctly
		const errors: string[] = [];
		for (const port of ports) {
			try {
				const payload = await this.makeRequest(port, csrfToken);
				this.cachedPort = port; // Cache the working port
				return payload;
			} catch (e: any) {
				errors.push(`port ${port}: ${e.message}`);
			}
		}

		throw new Error(
			`Could not connect to Antigravity API. PID=${pid}, tried ${ports.join(', ')}. ` +
			`Errors: [${errors.join(' | ')}]`
		);
	}

	// ─── Step 6: Payload Parsing ───────────────────────────────────────────────

	/**
	 * Converts the raw server response into our clean QuotaSnapshot format.
	 */
	private parsePayload(raw: any): QuotaSnapshot {
		const userStatus = raw?.userStatus ?? {};
		const email: string = userStatus.email ?? userStatus.name ?? 'Unknown User';

		const rawModels: any[] = userStatus.cascadeModelConfigData?.clientModelConfigs ?? [];

		const models: ModelQuota[] = rawModels
			.filter((m: any) => m?.quotaInfo !== undefined)
			.map((m: any) => {
				const resetTimeStr: string | undefined = m.quotaInfo?.resetTime;
				const resetTime = resetTimeStr ? new Date(resetTimeStr).getTime() : 0;

				const fraction = m.quotaInfo?.remainingFraction;
				let remainingFraction = 1; // Default to full if unknown

				if (typeof fraction === 'number' && isFinite(fraction)) {
					remainingFraction = fraction;
				} else if (fraction === undefined && resetTime > Date.now()) {
					// Protobuf v3 quirk: exact 0.0 floats get omitted from JSON payloads.
					// If the fraction is missing but there is an active reset throttle in the future, it is 0%.
					remainingFraction = 0;
				}

				return {
					label: m.label ?? 'Unknown Model',
					modelId: m.modelOrAlias?.model ?? 'unknown',
					remainingFraction,
					resetTime
				};
			});

		return { email, models };
	}

	// ─── Public API ────────────────────────────────────────────────────────────

	/**
	 * Fetches and returns the latest quota snapshot from the local Antigravity server.
	 */
	public async fetchQuota(): Promise<QuotaSnapshot> {
		const raw = await this.fetchRawPayload();
		return this.parsePayload(raw);
	}
}
