export type SecurityPlatform = 'electron' | 'native' | 'web';

export interface SecurityState {
  platform: SecurityPlatform;
  /** True when local SQLite can be encrypted at rest on this platform. */
  supported: boolean;
  /** True when the user has enabled the lock and database encryption. */
  configured: boolean;
  /** True while the app is unlocked in this session. */
  unlocked: boolean;
  biometricsAvailable: boolean;
  biometricsEnabled: boolean;
}

export interface SecurityController {
  state(): Promise<SecurityState>;
  /** Enable app lock and migrate the local database to encrypted storage. */
  setup(pin: string): Promise<void>;
  /** Verify a PIN/password and unlock the local database. */
  unlock(pin: string): Promise<boolean>;
  /** Unlock using the platform biometric prompt; resolves false on cancel/failure. */
  unlockWithBiometric(): Promise<boolean>;
  /** Lock immediately; the database must not be readable afterwards. */
  lock(): Promise<void>;
  /** Enable/disable biometric convenience unlock. Requires the current PIN. */
  setBiometric(enabled: boolean, pin: string): Promise<void>;
  changePin(currentPin: string, newPin: string): Promise<void>;
  /** Decrypt the database and remove the lock. Requires explicit user intent. */
  disable(pin: string): Promise<void>;
  /**
   * Only used by platform adapters that open SQLite inside the renderer.
   * Electron returns null because its main process holds the key and gates IPC.
   */
  databaseKey(): Promise<string | null>;
}
