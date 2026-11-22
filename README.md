[![Competition](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![Prize pool](https://make.fun/badge/gta6-01/prize.svg)](https://make.fun/bounty/gta6-01)
[![Deadline](https://make.fun/badge/gta6-01/deadline.svg)](https://make.fun/bounty/gta6-01)

# Port Azura: Sunset Heat

An original open-world crime game built for the make.fun bounty
[Make GTA 6](https://make.fun/bounty/gta6-01). Everything here — the city of
Port Azura, its people, vehicles, story and art — is original; nothing is taken
from any commercial game.

You are Rook, a getaway driver fresh off the bus with $350 and a borrowed
phone. Fixer Marisol Vega has work: a pier pickup, a timed run to the Hotel
Azul, the six-checkpoint Sunset Circuit, a hot van to cool down and deliver,
and one last score at the marina office before the heat dies down. Earn cash,
build a name, and try not to meet the Port Azura PD up close.

## What's in the game

- A 3D sunset coastal city — 9×7 street grid, marina, beach, park and pier —
  explorable on foot and by car, with a third-person camera.
- Live traffic on the grid and pedestrians on the sidewalks; any car can be
  entered and driven (theft included, witnesses permitting).
- A wanted system: crimes raise your stars, police interceptors pursue, and
  staying out of sight cools the heat. Get boxed in and you are busted; get
  flattened and you wake up at the hospital — both cost cash.
- A four-mission story chain with beacons, objectives, timers and cash
  rewards, plus a repeatable checkpoint circuit in free roam.
- Punch combat, car damage and wrecks, player health and regeneration.
- HUD with cash, wanted stars, health and car condition, the current objective
  and a live minimap (traffic, police, mission marker).
- Start, pause, busted/wasted and story-complete screens; progress saves to
  localStorage and can be continued.
- Fully procedural sound (WebAudio): engine, sirens, ambience and effects.
  No audio files, no network requests, no build step.

## Controls

WASD move / drive · E enter or exit a car · F punch · Shift sprint ·
Space handbrake · P pause · M mute · mouse orbit (click the game to lock)

## Run it

```sh
node serve.ts          # serves game/ at http://localhost:8080
```

or serve the `game/` folder with any static file server and open
`game/index.html`. Deterministic screenshot scenes are available as
`?shot=start|play|chase|end&seed=1`.

## Hand-in

`node main.ts` copies `game/` and `screenshots/` to `/output` (or
`$MAKEFUN_OUTPUT_DIR`) and writes the `dossier.json` summary with the vendored
make.fun library in `vendor/makefun-game.ts`.

## Tech

three.js r160 (vendored as `game/vendor/three.min.js`, MIT) for rendering;
everything else is hand-written JavaScript with canvas-generated textures.
Screenshots in `screenshots/` are real renders of the game in headless Chrome.

## License

MIT — see `LICENSE`. three.js is MIT-licensed by its authors.
