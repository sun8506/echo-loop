import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.echoloop.learner',
  appName: 'EchoLoop 学习',
  webDir: 'dist',
  backgroundColor: '#f4f2ec',
  android: {
    backgroundColor: '#f4f2ec',
    allowMixedContent: false,
  },
}

export default config
