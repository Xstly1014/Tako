export default defineNuxtConfig({
  compatibilityDate: '2026-10-29',
  devtools: { enabled: false },
  telemetry: false,
  routeRules: {
    '/workspace': { ssr: false },
    '/publish': { ssr: false },
    '/works/**': { headers: { 'cache-control': 'no-store' } },
  },
  runtimeConfig: { publicationApiBase: 'http://api:8080', public: { publicationEnabled: false } },
  app: { head: { title: 'Tako · 有脑洞，就开写', htmlAttrs: { lang: 'zh-CN' } } },
  typescript: { strict: true },
  css: ['~/assets/main.css'],
})
