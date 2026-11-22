// Port Azura: Sunset Heat — the hand-in program for make.fun's gta6-01 bounty.
// Node 22, standard library only. It copies the static game in game/ and the
// maker's screenshots in screenshots/ into the output directory (MAKEFUN_OUTPUT_DIR
// stands in for /output outside the grader) and writes dossier.json there with
// buildDossier from the vendored make.fun library, under the scorer's own caps,
// so the dossier is byte for byte the one the gate rebuilds.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

console.log('Port Azura: Sunset Heat handed in to ' + out);
