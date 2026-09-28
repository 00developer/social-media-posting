"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireEncryptionKey = requireEncryptionKey;
// The 32-character AES-256-CBC key every service uses to encrypt/decrypt stored OAuth tokens. There is no safe
// fallback for this: the old default ('12345678901234567890123456789012') is checked into the public repo, so a
// deployment that forgot to set ENCRYPTION_KEY was silently encrypting every user's access token with a key
// anyone can read on GitHub. Every service that touches tokens must set the exact same real key before starting.
function requireEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key || key.length !== 32) {
        throw new Error('ENCRYPTION_KEY must be set in .env to a 32-character value before this service can start (see .env.example).');
    }
    return key;
}
