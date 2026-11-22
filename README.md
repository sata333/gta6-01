# Port Azura: Sunset Heat

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/sata333/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/sata333/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An original open-world crime game for make.fun's **gta6-01** bounty, built with
three.js (vendored) and plain static files — no build step, no network requests.
Everything is fictional: the city of Port Azura, its people, cars and story were
created for this entry. Nothing comes from any commercial game.

You are **Rook**, a getaway driver in the sunset coastal city of Port Azura.
Fixer **Marisol Vega** has four jobs for you: a pier pickup against the clock,
the six-gate Sunset Circuit, a very hot red van, and a last stand at the marina
office — followed by a 4-star escape to Casa Segura. Between jobs the city is
yours: steal cars, dodge the Port Azura PD, and build your bankroll from $350.

## Features

- **A living city**: a 9×7 street grid with ~94 instanced buildings with
  procedural lit-window facades, sidewalks, a park, a parking lot, beach,
  marina pier with moored boats, and the sea — all under a sunset sky with a
  low sun, warm fog and shadows that follow you.
- **On foot and behind the wheel**: third-person character with mouse-orbit
  and auto-follow camera, sprinting, and any car stealable with **E** — arcade
  driving with speed-sensitive steering, handbrake turns, spinning/steering
  wheels, car health, dents and wrecks.
- **Traffic and pedestrians**: AI cars cruise the grid lane by lane,
  intersection to intersection, braking for obstacles; pedestrians stroll
  sidewalk loops, pause, flee danger and get knocked down (they get up).
- **Wanted system and police**: crimes raise heat — witnesses scale it — shown
  as 0–5 stars. Up to five PD interceptors spawn on the grid, pursue with
  target leading, flash their light bars, sound a procedural siren and box
  you in until the bust meter fills. BUSTED costs bail; WASTED costs a clinic
  bill; both respawn you in the city.
- **Four story missions plus free roam**: beacon-guided objectives with
  distances and timers, cash rewards, and a repeatable $200 Sunset Circuit
  rematch after the story.
- **HUD and minimap**: cash, wanted stars, health and vehicle bars,
  speedometer, objective tracker, interaction prompts, bust meter, banners —
  and a live canvas minimap with streets, shoreline, traffic dots, flashing
  police, a pulsing mission marker and the player arrow.
- **Procedural sound**: WebAudio-synthesised engine hum that tracks speed,
  a two-tone siren, an ambient pad, and checkpoint/cash/punch/crash effects.
  No audio files.
- **Save**: progress (cash, mission, position, health) persists in
  localStorage; Continue from the start screen.

## Controls

| Input | Action |
| --- | --- |
| W A S D / arrows | Move / drive |
| Mouse (click canvas to lock) | Camera |
| Shift | Sprint |
| E | Enter / exit car |
| Space | Handbrake |
| F or mouse click | Punch |
| R | Start the Sunset Circuit rematch (when offered) |
| P | Pause |
| M | Mute |

## Run it locally

```sh
node serve.ts
```

then open the local address it prints (port 8080) in a desktop browser.
The game is the static `game/` folder; any static file server works.

Deterministic screenshot modes for the bundled screenshots:
`game/index.html?shot=start|play|chase|end&seed=1` — a seeded city, a warmed-up
simulation, and composed scenes (start screen over the city, a mid-drive
mission run, a 3-star chase, the story-complete screen).

## Hand-in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and writes
`dossier.json` with `buildDossier` from `vendor/makefun-game.ts` under the
scorer's caps. `shots.json` lists the four screenshots and the shot-mode query
that produced each.

## License

MIT — see `LICENSE`. three.js (in `game/vendor/`) is MIT-licensed by its authors.
