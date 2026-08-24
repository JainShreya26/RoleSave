import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const webEnvironmentDirectory = fileURLToPath(new URL('../web', import.meta.url))

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, webEnvironmentDirectory, '')

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(environment.NEXT_PUBLIC_SUPABASE_URL ?? ''),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(
        environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
      ),
    },
  }
})
