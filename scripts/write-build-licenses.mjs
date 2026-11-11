import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const bundledNotices = {
  react: 'LICENSE',
  'react-dom': 'LICENSE',
  scheduler: 'LICENSE',
  vite: 'LICENSE.md',
  esbuild: 'LICENSE.md',
  rollup: 'LICENSE.md',
};

const notices = Object.entries(bundledNotices).map(([name, licenseFile]) => {
  const manifestPath = require.resolve(`${name}/package.json`);
  const { version } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const license = readFileSync(join(dirname(manifestPath), licenseFile), 'utf8');
  return `${name} ${version}\n\n${license.trimEnd()}`;
});

copyFileSync(new URL('../LICENSE', import.meta.url), new URL('../dist/LICENSE', import.meta.url));
writeFileSync(new URL('../dist/THIRD_PARTY_NOTICES.txt', import.meta.url), notices.join('\n\n---\n\n') + '\n');
