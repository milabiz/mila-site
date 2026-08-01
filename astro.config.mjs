import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://milabiz.com',
  output: 'static',
  adapter: vercel(),
  integrations: [sitemap()],
  build: {
    assets: '_assets',
  },

  markdown: {
    /**
     * Prism, not the Shiki default: Shiki colours tokens with inline `style`
     * attributes, which a hash-based CSP cannot cover (inline style attributes
     * need 'unsafe-inline'). Prism emits class names instead, so code blocks
     * stay syntax-highlighted with the CSP fully strict. Token colours are in
     * global.css.
     */
    syntaxHighlight: 'prism',
  },

  security: {
    /**
     * Native CSP. Astro generates SHA-256 hashes for every script and style it
     * emits and injects a <meta http-equiv="Content-Security-Policy">, so the
     * inline theme script and any auto-inlined component scripts stay covered
     * without hand-maintained hashes drifting out of date on every edit.
     *
     * NOTE: `frame-ancestors` is ignored in a <meta> CSP — it only works as a
     * real HTTP response header. That directive, plus X-Frame-Options and the
     * rest, live in vercel.json. The two are complementary, not duplicates.
     */
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: https:",
        "font-src 'self'",
        "connect-src 'self' https://*.supabase.co",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ],
    },
  },
});
