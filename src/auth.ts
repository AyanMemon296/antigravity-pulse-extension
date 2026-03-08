import * as vscode from 'vscode';

export class AuthManager {
    constructor(private secretStorage: vscode.SecretStorage) {}

    /**
     * Securely saves the access token and its expiry timestamp using the OS keychain.
     * Fails loudly if the keychain is unavailable to prevent plain-text fallback.
     */
    async saveToken(token: string, expiryMs: number) {
        try {
            await this.secretStorage.store('antigravity_token', token);
            await this.secretStorage.store('antigravity_token_expiry', expiryMs.toString());
        } catch (error) {
            vscode.window.showErrorMessage('CRITICAL SECURITY ERROR: OS keychain not available. Refusing to store tokens insecurely.');
            throw new Error('Failed to securely store token in OS keychain. Refusing fallback.');
        }
    }

    /**
     * Retrieves the access token, ensuring it is not expired.
     * Returns null if no token is found or if the token has expired.
     */
    async getToken(): Promise<{ token: string; expiryMs: number } | null> {
        const token = await this.secretStorage.get('antigravity_token');
        const expiryStr = await this.secretStorage.get('antigravity_token_expiry');
        
        if (!token || !expiryStr) {
            return null;
        }

        const expiryMs = parseInt(expiryStr, 10);
        if (Date.now() > expiryMs) {
            // Token expired, clean up
            await this.clearSecrets();
            return null;
        }

        return { token, expiryMs };
    }

    /**
     * Clears stored secrets (e.g., on 401 Unauthorized or explicit logout).
     */
    async clearSecrets() {
        await this.secretStorage.delete('antigravity_token');
        await this.secretStorage.delete('antigravity_token_expiry');
    }
}
