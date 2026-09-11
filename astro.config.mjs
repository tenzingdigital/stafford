import { defineConfig } from 'astro/config';

export default defineConfig({
  // Relative asset paths so the built page works both as a hosted site and
  // as a self-contained preview.
  // 'assets' rather than the default '_astro': leading underscores are
  // reserved on some static hosts and preview services.
  build: { format: 'file', assets: 'assets' },
  devToolbar: { enabled: false },
});
