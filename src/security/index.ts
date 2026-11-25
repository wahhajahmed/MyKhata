import { Capacitor } from '@capacitor/core';
import { electronSecurity } from './electronSecurity';
import { webSecurity } from './webSecurity';
import type { SecurityController } from './types';

/**
 * Selects the platform security implementation once at startup.
 * Desktop keys stay in Electron's main process; native keys stay in the OS
 * keystore; browser mode only gates the UI (see webSecurity docs).
 */
export async function securityController(): Promise<SecurityController> {
  if (window.electronAPI) return electronSecurity;
  if (Capacitor.isNativePlatform()) return (await import('./nativeAuth')).nativeSecurity;
  return webSecurity;
}
