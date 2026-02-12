import crypto from 'crypto';
import { env } from '../config/env.js';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
/**
 * Derive a key from the encryption key using PBKDF2
 */
function deriveKey(salt) {
    if (!env.ENCRYPTION_KEY) {
        throw new Error('ENCRYPTION_KEY not configured');
    }
    return crypto.pbkdf2Sync(env.ENCRYPTION_KEY, salt, 100000, KEY_LENGTH, 'sha512');
}
/**
 * Encrypt a string value
 */
export function encrypt(text) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = deriveKey(salt);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    // Return: salt:iv:tag:encrypted
    return [
        salt.toString('hex'),
        iv.toString('hex'),
        tag.toString('hex'),
        encrypted,
    ].join(':');
}
/**
 * Decrypt an encrypted string value
 */
export function decrypt(encryptedData) {
    const parts = encryptedData.split(':');
    if (parts.length !== 4) {
        throw new Error('Invalid encrypted data format');
    }
    const [saltHex, ivHex, tagHex, encrypted] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const key = deriveKey(salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
