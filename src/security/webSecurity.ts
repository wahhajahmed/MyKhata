import type { SecurityController, SecurityState } from './types';
import { createPinVerifier, verifyPinVerifier, type PinVerifier } from './pin';

const KEY = 'mykhata.web.lock';
let unlocked = false;

interface WebLockRecord {
  verifier: PinVerifier;
  configuredAt: string;
}

function read(): WebLockRecord | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) as WebLockRecord : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Browser development fallback. It gates the UI but cannot encrypt IndexedDB;
 * database-at-rest encryption is only available in the desktop/native builds.
 */
export const webSecurity: SecurityController = {
  async state(): Promise<SecurityState> {
    const record = read();
    return {
      platform: 'web',
      supported: false,
      configured: Boolean(record),
      unlocked: !record || unlocked,
      biometricsAvailable: false,
      biometricsEnabled: false,
    };
  },
  async setup(pin) {
    localStorage.setItem(KEY, JSON.stringify({ verifier: await createPinVerifier(pin), configuredAt: new Date().toISOString() } satisfies WebLockRecord));
    unlocked = true;
  },
  async unlock(pin) {
    const record = read();
    if (!record) return true;
    unlocked = await verifyPinVerifier(pin, record.verifier);
    return unlocked;
  },
  async unlockWithBiometric() {
    return false;
  },
  async lock() {
    unlocked = false;
  },
  async setBiometric() {
    throw new Error('Biometric unlock is not available in the browser');
  },
  async changePin(currentPin, newPin) {
    const record = read();
    if (!record || !(await verifyPinVerifier(currentPin, record.verifier))) throw new Error('Incorrect PIN');
    localStorage.setItem(KEY, JSON.stringify({ verifier: await createPinVerifier(newPin), configuredAt: new Date().toISOString() } satisfies WebLockRecord));
  },
  async disable(pin) {
    const record = read();
    if (!record || !(await verifyPinVerifier(pin, record.verifier))) throw new Error('Incorrect PIN');
    localStorage.removeItem(KEY);
    unlocked = false;
  },
  async databaseKey() {
    return null;
  },
};
