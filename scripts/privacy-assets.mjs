// Copies Private Withdraw's runtime files into place after npm install (they're too big to commit):
//  - Privacy Cash's zero-knowledge circuit (~19MB) → public/circuit2, fetched by the browser only when used
//  - the hasher's WebAssembly next to its browser build (Next.js can't resolve it otherwise)
import { cpSync, existsSync, mkdirSync } from 'node:fs';

const copy = (from, to) => {
  if (!existsSync(from)) return console.warn('[privacy-assets] missing', from);
  cpSync(from, to, { recursive: true });
};
mkdirSync('public/circuit2', { recursive: true });
copy('node_modules/privacycash/circuit2', 'public/circuit2');
const h = 'node_modules/@lightprotocol/hasher.rs/dist';
for (const f of ['hasher_wasm_simd_bg.wasm', 'light_wasm_hasher_bg.wasm']) copy(`${h}/${f}`, `${h}/browser-fat/es/${f}`);
