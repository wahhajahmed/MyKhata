import type { SecurityController, SecurityState } from './types';

type ElectronAuthState = SecurityState;

function auth(): NonNullable<NonNullable<Window['electronAPI']>['auth']> {
  const api = window.electronAPI?.auth;
  if (!api) throw new Error('Desktop security bridge is unavailable');
  return api;
}

export const electronSecurity: SecurityController = {
  async state() {
    return await auth().status() as ElectronAuthState;
  },
  async setup(pin) {
    await auth().setup(pin);
  },
  async unlock(pin) {
    return await auth().unlock(pin);
  },
  async unlockWithBiometric() {
    return false;
  },
  async lock() {
    await auth().lock();
  },
  async setBiometric(enabled, pin) {
    await auth().setBiometric(enabled, pin);
  },
  async changePin(currentPin, newPin) {
    await auth().changePin(currentPin, newPin);
  },
  async disable(pin) {
    await auth().disable(pin);
  },
  async databaseKey() {
    // Electron keys stay in the main process; db IPC is gated there.
    return null;
  },
};
