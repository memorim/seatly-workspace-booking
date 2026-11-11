import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('.neon-build', { recursive: true });
const result = await build({
  entryPoints: ['server/neon-entry.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  write: false,
  minify: true,
  external: ['pg-native'],
  banner: {
    js: "import{createRequire as ___cr}from'node:module';import{fileURLToPath as ___f}from'node:url';import{dirname as ___d}from'node:path';const require=___cr(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);",
  },
});
const files = { 'index.mjs': result.outputFiles[0].contents };
for (const name of ['postgres.sql', 'booking-constraints.sql'])
  files[name] = new Uint8Array(await readFile('server/' + name));
async function add(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = directory + '/' + entry.name;
    if (path === 'dist/photos') continue;
    if (entry.isDirectory()) await add(path);
    else files[path] = new Uint8Array(await readFile(path));
  }
}
await add('dist');
const archive = zipSync(files, { level: 9 });
await writeFile(resolve('.neon-build/seatly.zip'), archive);
console.log(
  JSON.stringify({
    artifact: '.neon-build/seatly.zip',
    bytes: archive.length,
    files: Object.keys(files).length,
  }),
);
