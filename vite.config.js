import { defineConfig } from 'vite';

// Relative base so the build works from any path, including GitHub Pages'
// /<repo-name>/ project-site prefix.
export default defineConfig({
  base: './',
});
