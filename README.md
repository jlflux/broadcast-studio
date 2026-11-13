# Broadcast Studio

Scorebug, lower-third graphics, score ticker and stat keeper for high school football and basketball streams in OBS. Run the game from a laptop, phone or OBS dock; the overlay updates in OBS within about a second.

It runs on Vercel with a Neon Postgres database (the same setup as the Homewood football scorebug), or entirely on one laptop with no internet (`npm run local`).

## What's in it

| Page | What it does |
|---|---|
| `/control` | Control panel: score, clocks, down & distance, fouls/bonus, possession, banners, graphics, ticker, teams, style, and scoreboard serial import |
| `/stats` | Stat keeper: rosters, tap-player-then-action stat entry, box score, play-by-play. Sends the score (and basketball team fouls) to the scorebug |
| `/overlay` | The OBS Browser Source (1920 × 1080, transparent) |

**Scorebug.** Football and basketball, each with its own saved game, so switching sports keeps both games. Two layouts: a wide **broadcast bar** and a compact **corner box**, placed in any of six positions with size and nudge controls. It shows timeouts, possession, down & distance or a status (FLAG, TIMEOUT, REVIEW…), the play clock or shot clock, team fouls, and a BONUS tag. Clocks run on the server's time, so every screen agrees. Basketball shows tenths under a minute.

**Banners.** A message bar attached to the bug ("TOUCHDOWN {TEAM}", "3-POINTER"…), in a team's color, with a timer to hide it on its own.

**Graphics.** Player lower third (photo or jersey number, name, position, stat line), team stat comparison, and message/sponsor cards with an image. Save presets for one-click reuse. **Load player card** and **Load team stats** fill a graphic straight from the stat keeper, and the stat keeper's box score has an **On air** button on every player.

**Ticker.** The `jlflux/ticker` score ticker, run from the panel instead of `config.js`. It reads Google Sheets (the same template, `ticker-sheet-template.csv`), ESPN scoreboards, games typed into the panel, and optionally the game on the scorebug. Corner box or bottom bar.

**Scoreboard data.** Reads the press-box scoreboard controller (FairPlay, Daktronics, etc.) over RS-232 through Chrome's Web Serial API: no local server or driver install beyond the USB-serial adapter. Map each value to a byte offset once (ASCII, BCD or binary). A live hex view highlights the bytes that change, and mappings can be saved and exported.

**Team library.** Save team names, colors and logos and load them onto either side. Rosters save to the library per sport too.

## Launch on Vercel

1. Create a GitHub repo from this folder and import it into Vercel (root directory, **Other** framework preset).
2. Connect a Neon Postgres database through the Vercel Marketplace, or set `DATABASE_URL` to a Neon connection string. The app creates its table (`studio_docs`) on first use.
3. Set `SCOREBUG_ADMIN_PASSWORD` to a random password of at least 20 characters. Redeploy after changing environment variables.
4. Open the production URL and sign in.

Use the production URL in OBS. If Vercel Deployment Protection is on for production, OBS will get Vercel's sign-in page instead of the overlay.

## Add it to OBS

1. In the control panel, open **Style → OBS sources** (or click **Copy OBS URL** at the top).
2. In OBS add a **Browser Source**, paste the full URL (it ends in `#key=…`), set **1920 × 1080**, and leave "Shutdown source when not visible" **unchecked**.
3. Optional: use the split URLs (`?layers=bug,banner`, `?layers=graphic`, `?layers=ticker`) as separate sources so you can hide or move layers in OBS.
4. Optional: add the control panel as an OBS **Custom Browser Dock**.

The overlay key gives read-only access to what's on air. It changes if you change the password.

## Run it on one laptop (no internet)

```bash
npm install
SCOREBUG_ADMIN_PASSWORD=pick-a-long-password-here npm run local
```

Open `http://localhost:3000/control`. Data is saved in `./data`. To let a tablet on the same network run the stat keeper, start it with `HOST=0.0.0.0`; then anyone on that network who has the password can change the game.

## Game night notes

- **One score source.** The stat keeper's **Send score to scorebug** and the scoreboard import can both write the score. Pick one, or turn off the stat keeper's auto-send when the scoreboard feed is running. If the stat keeper and the bug ever disagree, a yellow bar offers **Set scorebug to stats**.
- **Next period** advances the quarter and resets the game clock. Football also restores timeouts at the half; basketball also resets team fouls (NFHS quarter fouls) and the shot clock.
- **Swap sides** flips teams, scores, timeouts, fouls and possession, and the stat keeper's teams and plays with them.
- **Keyboard shortcuts** (turn on in the control panel): Space game clock, X play/shot clock, R reset play/shot clock, B scorebug, Esc clear graphic and banner, 1/2 add a point. Stat keeper: U undo, Esc deselect.
- The stat keeper keeps a backup of the last cleared game in the browser, and **Download backup** saves the whole game as JSON.

## Mapping a scoreboard controller

1. Connect the controller's serial output to the laptop with a USB-to-RS232 adapter (some need a null-modem adapter).
2. **Scoreboard data → Connect…**, pick the port, and try 9600 baud first.
3. Watch **Last frame**. If frames come in as one long run, set the start byte, end byte or frame length until each frame is the same size.
4. Run the clock and change the score on the controller. The bytes that change light up. Enter their offsets in **Field mapping** and check the **Decoded** column.
5. Tick **Send to scorebug**. Save the mapping with a name so you can load it next game.

## Development

```bash
npm test                                   # API, stat engine, roster parser, serial decoding
LOCAL_PG_URL=postgres://… npm test         # also runs the API test against real Postgres
```

Everything is vanilla JS modules with no build step. Bundled third-party files: Barlow Condensed (SIL Open Font License, `public/fonts`) and pdf.js (Apache-2.0, `public/vendor`) for reading roster PDFs. Scanned PDFs have no text to read; paste the roster instead.

**Requirements:** OBS 28 or newer. Scoreboard import needs Chrome or Edge on a desktop. The overlay checks for changes about every 0.8 seconds.
