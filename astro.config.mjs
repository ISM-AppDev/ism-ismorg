// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// The catalog is served from a sub-path of an existing domain:
//   https://ismorg.com/solutions
// `base` makes Astro prefix every generated link and asset with /solutions.
// nginx maps `location /solutions/` -> this project's `dist/`.
const SITE = 'https://ismorg.com';
const BASE = '/solutions';

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
