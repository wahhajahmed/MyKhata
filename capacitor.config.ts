import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mykhata.app',
  appName: 'MyKhata',
  webDir: 'dist',
  loggingBehavior: 'production',
  android: {
    allowMixedContent: false,
  },
};

export default config;
