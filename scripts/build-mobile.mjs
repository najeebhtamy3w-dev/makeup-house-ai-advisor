// Builds the on-device app bundle (dist-mobile/) used by Capacitor for the Android APK.
// - copies the existing web UI unchanged (minus the service worker, which is not needed inside the app)
// - bundles mobile/src/worker.ts (the shared server routes + SQLite WASM) and mobile/src/client.ts (the /api bridge)
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-mobile');
rmSync(out, { recursive: true, force: true }); mkdirSync(join(out, 'local'), { recursive: true });
cpSync(join(root, 'web'), out, { recursive: true, filter: (p) => !p.endsWith('/sw.js') && !p.includes('/ui-shots') });

// index.html: load the bridge before the app module
const idx = readFileSync(join(out, 'index.html'), 'utf8').replace('<script type="module" src="/js/app.js"></script>', '<script src="/local/client.js"></script>\n<script type="module" src="/js/app.js"></script>');
if (!idx.includes('/local/client.js')) throw new Error('index.html: app script tag not found');
writeFileSync(join(out, 'index.html'), idx);

const migrations = readdirSync(join(root, 'server/migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => [f, readFileSync(join(root, 'server/migrations', f), 'utf8')]);
const plugin = {
  name: 'mh-mobile',
  setup(b) {
    b.onResolve({ filter: /^mh:migrations$/ }, () => ({ path: 'mh:migrations', namespace: 'mh' }));
    b.onLoad({ filter: /.*/, namespace: 'mh' }, () => ({ contents: 'export default ' + JSON.stringify(migrations), loader: 'js' }));
    b.onResolve({ filter: /^node:crypto$/ }, () => ({ path: join(root, 'mobile/src/shims/crypto.ts') }));
    b.onResolve({ filter: /^node:zlib$/ }, () => ({ path: join(root, 'mobile/src/shims/zlib.ts') }));
    // the shared routes import ./db.ts (node:sqlite) — on the device that module is mobile/src/db.ts (SQLite WASM)
    b.onResolve({ filter: /db\.ts$/ }, (a) => (resolve(a.resolveDir, a.path) === join(root, 'server/src/db.ts') ? { path: join(root, 'mobile/src/db.ts') } : undefined));
    b.onResolve({ filter: /^node:/ }, (a) => ({ errors: [{ text: `Node module ${a.path} is not available on the device (imported by ${a.importer})` }] }));
  },
};
await build({ entryPoints: [join(root, 'mobile/src/worker.ts')], outfile: join(out, 'local/worker.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, sourcemap: false, plugins: [plugin], inject: [join(root, 'mobile/src/shims/buffer-global.ts')], logLevel: 'warning' });
await build({ entryPoints: [join(root, 'mobile/src/client.ts')], outfile: join(out, 'local/client.js'), bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, logLevel: 'warning' });
const wasmDir = join(root, 'node_modules/@sqlite.org/sqlite-wasm/dist');
copyFileSync(join(wasmDir, 'sqlite3.wasm'), join(out, 'local/sqlite3.wasm'));
const visionNotices=join(root,'android/app/src/main/assets/native-vision');mkdirSync(visionNotices,{recursive:true});
for(const name of ['THIRD_PARTY_NOTICES.txt','LLAMA-LICENSE.txt','MODEL-LICENSE.txt'])copyFileSync(join(root,'docs/v3.2/vision-probe',name),join(visionNotices,name));
for (const manifest of ['model-manifest.json','vision-manifest.json']) copyFileSync(join(root,'native',manifest),join(root,'android/app/src/main/assets',manifest));
console.log('dist-mobile ready:', readdirSync(join(out, 'local')).join(', '));
