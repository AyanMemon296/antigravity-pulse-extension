import * as assert from 'assert';
import * as vscode from 'vscode';
import { AuthManager } from '../../auth';

suite('Security Audit Test Suite', () => {
	vscode.window.showInformationMessage('Start all security tests.');

	test('AuthManager properly stores and retrieves token', async () => {
		const context = {
            secrets: {
                store: async (key: string, value: string) => {},
                get: async (key: string) => {
                    if (key === 'antigravity_token') return 'test_token';
                    if (key === 'antigravity_token_expiry') return (Date.now() + 100000).toString();
                    return undefined;
                },
                delete: async (key: string) => {},
				onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
            }
        } as unknown as vscode.ExtensionContext;

		const authManager = new AuthManager(context.secrets);
		const result = await authManager.getToken();
		
		assert.strictEqual(result?.token, 'test_token');
	});

    test('AuthManager rejects expired tokens', async () => {
		const context = {
            secrets: {
                store: async (key: string, value: string) => {},
                get: async (key: string) => {
                    if (key === 'antigravity_token') return 'test_token';
                    // Return a token that expired 1 second ago
                    if (key === 'antigravity_token_expiry') return (Date.now() - 1000).toString();
                    return undefined;
                },
                delete: async (key: string) => {},
				onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
            }
        } as unknown as vscode.ExtensionContext;

		const authManager = new AuthManager(context.secrets);
		const result = await authManager.getToken();
		
		// Expected to be null since the token has expired
		assert.strictEqual(result, null);
	});
});
