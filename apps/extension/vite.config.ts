import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const webEnvironmentDirectory = fileURLToPath(new URL('../web', import.meta.url))
const localWebAppUrl = 'http://127.0.0.1:3100'
const localHostPermissions = ['http://127.0.0.1:3100/*', 'http://localhost:3100/*']
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const icons = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' }

function webAppOrigin(value: string, isProduction: boolean) {
  const invalidOrigin = isProduction
    ? 'NEXT_PUBLIC_SITE_URL must be the hosted HTTPS dashboard origin. Use build:dev for the local dashboard.'
    : 'NEXT_PUBLIC_SITE_URL must be a full HTTP or HTTPS dashboard origin.'
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(invalidOrigin)
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error(invalidOrigin)
  }
  const hostname = url.hostname.replace(/\.$/, '')
  const isLoopback = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127(?:\.\d+){3}$/.test(hostname)
  if (isProduction && (url.protocol !== 'https:' || isLoopback || hostname === '0.0.0.0')) {
    throw new Error(invalidOrigin)
  }
  return url.origin
}

function manifestPlugin(isProduction: boolean, supabaseUrl: string): Plugin {
  // Only the project this build talks to. Localhost is only allowed in
  // development builds, never in a release.
  const supabaseHosts =
    supabaseUrl && (!isProduction || supabaseUrl.startsWith('https://')) ? [`${new URL(supabaseUrl).origin}/*`] : []

  return {
    name: 'rolesave-manifest',
    generateBundle() {
      const manifest = {
        manifest_version: 3,
        name: 'RoleSave Application Tracker',
        description: 'Save job descriptions to the private RoleSave dashboard.',
        version,
        minimum_chrome_version: '116',
        icons,
        background: { service_worker: 'background.js', type: 'module' },
        permissions: ['activeTab', 'pageCapture', 'scripting', 'storage'],
        host_permissions: [...supabaseHosts, ...(isProduction ? [] : localHostPermissions)],
        action: { default_icon: icons, default_title: 'Save job to RoleSave', default_popup: 'index.html' },
      }
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) })
    },
  }
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, webEnvironmentDirectory, '')
  const isProduction = mode === 'production'

  const read = (name: string) => process.env[name] || environment[name] || ''

  const supabaseUrl = read('NEXT_PUBLIC_SUPABASE_URL')
  // The legacy anon key name is accepted, matching the web app.
  const supabaseKey = read('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || read('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  // A development build follows the local dashboard even if .env.local names
  // a release site. A build command can explicitly select another local port.
  const siteUrl = isProduction ? read('NEXT_PUBLIC_SITE_URL') : process.env.NEXT_PUBLIC_SITE_URL || localWebAppUrl

  if (isProduction) {
    const missing = [
      !supabaseUrl && 'NEXT_PUBLIC_SUPABASE_URL',
      !supabaseKey && 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      !siteUrl && 'NEXT_PUBLIC_SITE_URL',
    ].filter(Boolean)
    if (missing.length > 0) {
      throw new Error(`${missing.join(', ')} must be set for a production extension build. Use build:dev for the local dashboard.`)
    }
    if (!supabaseUrl.startsWith('https://')) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL must use HTTPS for a production extension build.')
    }
  }

  const webAppUrl = webAppOrigin(siteUrl, isProduction)

  return {
    plugins: [react(), manifestPlugin(isProduction, supabaseUrl)],
    build: {
      rollupOptions: {
        input: { popup: 'index.html', background: 'src/background.ts' },
        // The manifest names the background script, so its file name must not change.
        output: { entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js') },
      },
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabaseKey),
      'import.meta.env.VITE_WEB_APP_URL': JSON.stringify(webAppUrl),
    },
  }
})
