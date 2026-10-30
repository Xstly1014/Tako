export default defineNuxtConfig({
  compatibilityDate: '2026-10-29',
  devtools: { enabled: false },
  telemetry: false,
  routeRules: {
    '/workspace': { ssr: false },
    '/account': { ssr: false },
    '/publish': { ssr: false },
    '/my-works': { ssr: false },
    '/works/**': { headers: { 'cache-control': 'no-store' } },
    '/community': { headers: { 'cache-control': 'no-store' } },
    '/ops/curation': { ssr: false },
  },
  runtimeConfig: {
    publicationApiBase: 'http://api:8080',
    public: { publicationEnabled: false, environment: 'local' },
  },
  app: { head: { title: 'Tako · 有脑洞，就开写', htmlAttrs: { lang: 'zh-CN' } } },
  typescript: { strict: true },
  css: ['~/assets/main.css'],
})
