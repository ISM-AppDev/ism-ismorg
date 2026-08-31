// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// The catalog is served from a sub-path of an existing domain:
//   https://ismorg.com/solutions        — public build (PUBLIC_BUILD=1)
//   https://ismorg.com/solutions/team   — full build (TEAM_BUILD=1), password-gated
// `base` prefixes every generated link/asset; nginx maps each path to its dir.
const SITE = 'https://ismorg.com';
const BASE = process.env.TEAM_BUILD === '1' ? '/solutions/team' : '/solutions';

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  build: {
    // emit /solutions/foo/index.html so clean URLs work behind nginx
    format: 'directory',
  },
  integrations: [mdx()],
  // Until the catalog is made public it sits behind HTTP basic-auth and is
  // marked noindex in the <head>. No sitemap on purpose.
});
