import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mykhata.app',
  appName: 'MyKhata',
  webDir: 'dist',
  loggingBehavior: 'production',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: true,
      androidBiometric: {
        // App-level biometrics are handled by @aparajita/capacitor-biometric-auth,
        // not by the SQLite plugin's own prompt.
        biometricAuth: false,
      },
    },
  },
};

export default config;
