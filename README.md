# Broadcast Studio

Scorebug, lower-third graphics, full-screen graphics, branded wipes, score ticker, stat keeper and printable spotting boards for high school football and basketball streams in OBS. Run the game from a laptop, phone or OBS dock; the overlay updates in OBS within about a second.

It runs on Vercel with a Neon Postgres database (the same setup as the Homewood football scorebug), or entirely on one laptop with no internet (`npm run local`).

## What's in it

| Page | What it does |
|---|---|
| `/control` | Control panel. **Live** is one game screen: each team's score, timeouts, fouls and roster on its side; clock, stat pad and game situation in the middle; program monitor across the top. Also: **Box score & plays** (line score, team stats, box score with On air buttons, play-by-play with delete, Save PDF, CSV export, backup/restore, new stat game) for the active game, stat graphics, graphics, ticker, teams, team builder, style, and scoreboard serial import |
| `/stats` | Stat keeper: rosters, tap-player-then-action stat entry, box score, play-by-play. Sends the score (and basketball team fouls) to the scorebug. Play entry is also built into the control panel's Live tab; the box score, play-by-play and rosters are in its **Box score & plays** tab. Open `/stats` on its own for a second screen or tablet |
| `/overlay` | The OBS Browser Source (1920 × 1080, transparent) |
| `/spotting` | Printable spotting boards for the announcers, built from the saved teams and rosters |
| `/scoresheet` | Basketball scoresheet for the broadcast table: season stats, fouls, points and running score, filled from the stat keeper |
| `/gamecast` | Virtual gamecast for games without video: enter each play and it draws on a digital field. Its OBS source is `/gamecast?output=1#key=…` |

**Scorebug.** Football and basketball, each with its own saved game, so switching sports keeps both games. Four layouts: a wide **broadcast bar**, a slim **ribbon bar** (name plates, team-color logo tiles and score slabs around an angled clock tile), **team cards + clock tile** (two team cards meeting at a raised clock tile), and a compact **corner box**. Ribbon and badge use a name plate / card color you set in Style. All layouts can be placed in any of six positions with size and nudge controls. It shows timeouts, possession, down & distance or a status (FLAG, TIMEOUT, REVIEW…), the play clock or shot clock, team fouls, and a BONUS tag. Clocks run on the server's time, so every screen agrees. Basketball shows tenths under a minute.

**Banners.** A message bar attached to the bug ("TOUCHDOWN {TEAM}", "3-POINTER"…), in a team's color, with a timer to hide it on its own.

**Graphics.** Player lower third (photo or jersey number, name, position, stat line), team stat comparison, and message/sponsor cards with an image. Save presets for one-click reuse. **Load player card** and **Load team stats** fill a graphic straight from the stat keeper, and the stat keeper's box score has an **On air** button on every player.

**Stat graphics (basketball).** The control panel's **Stat graphics** tab turns the stat keeper's numbers into ready-made graphics. Tap a player to see their graphics with the numbers filled in: game line, scoring, three-pointers, free throws, this quarter, rebounds, assists, steals and blocks, double-doubles and fouls. Team graphics sit below: team stats, this quarter, shooting, game leaders, scoring by quarter, each team's leading scorers and the current run (4-0 or more). Tap one to see it in the preview, then **Take live**, or hit **Take** on a row to skip the preview. The numbers are locked in when you take a graphic, so they don't change while it's on air; take it again to update it. **Edit in Graphics tab** opens it in the graphic editor first.

**Player photos.** Photos fill a fixed box on the left of player graphics (about square, as tall as the card), so a tall or wide picture never makes a graphic bigger. The whole photo is kept; you choose which part shows. In the stat keeper's **Rosters** tab, tap a player's photo to pick **Up/down** (top, center, bottom) and **Left/right** (left, center, right). The Graphics tab in the control panel has the same choices for a photo you upload there.

**Full-screens.** The control panel's **Full-screens** tab has five full-screen graphics: **Matchup** (both logos, names, rankings and records, with the event and venue), **Lineup** (pick up to 5 basketball starters for photo cards, or up to 12 football players for a list, in the order you tap them), **Keys to the game** (up to five, for one team or both), **Score & stats** (the scorebug's score, the score by quarter when the stat keeper matches it, and team stats) and **Leaders** (each team's top player in points, rebounds, assists and steals, or passing, rushing, receiving and tackles). The matchup can carry a clock for people tuning in early: a countdown to the start time (it reads "Starting soon" at zero), or the scorebug's game clock for a pregame countdown run on the scoreboard. Leave the label blank on stat screens and it reads Halftime, Final or the quarter. See it in the preview, then **Take full-screen**. With **Wipe in and out** on, it goes up and comes down under a wipe. The scorebug, banner and lower thirds step aside while it's up; a corner ticker hides and a bottom-bar ticker stays. Numbers are locked in when you take it.

**Transitions (wipes).** Branded wipes in the team or studio colors: **Slash**, **Stripes** or **Iris**, normal (1.4 s) or fast (1 s), with the team logo (or your studio logo) in the middle. Pick the style, speed and studio logo in **Style → Transitions & full-screens**. On Live, the **Transition** card plays a wipe in the studio color or either team's color (**W** on the keyboard). Wipes are scheduled about a second ahead on the server's clock, so every overlay plays them at the same moment.

**OBS connection.** In **Style → OBS connection**, connect to OBS's WebSocket server (OBS 28+: **Tools → WebSocket Server Settings**). The Transition card then shows a button for each OBS scene: press one and OBS switches to that scene while the wipe covers the screen. Set the OBS scene transition to **Cut**, and put the overlay (or the **Full-screens + wipes** source) in every scene with **Add Existing** so the wipe carries across the switch. The address and password are saved in this browser only.

**Spotting boards.** `/spotting` (or **Spotting boards ↗** at the top of the control panel) prints boards from the teams and rosters in the Team builder, starting with today's game. Football prints a page per team, by number or split into offense and defense (two-way players show on both sides; specialists along the bottom). Basketball fits both teams on one page, or one per page. Letter or 11 × 17. Each player shows number, name, position, year, and optionally height and weight, a pronunciation and a note. Fill those in under **Board details** (plus the head coach and a line of team notes); they save to the team's roster, so they're there the next time you play that team. Pasted and imported rosters keep height and weight when they have them.

**Basketball scoresheet.** `/scoresheet` (or **Scoresheet ↗** in the control panel) is the classic broadcast-table sheet for the game on the scorebug: season stats for each team's top players across the top, each team's players side by side with fouls 1–5 and points 1–40, and each team's running score by half down the right. Print it before the game with the names, numbers, heights, pronunciations and season stats filled in (uncheck **Fill in from the stat keeper** for a blank sheet to mark by hand). During the game it fills itself from the stat keeper: fouls circled (fouled out in red), points crossed off with made threes ringed, each player's line, the running score with the scorer's number, team fouls per half and the score by quarter. After the game, **Print / Save PDF** gives the completed sheet. **Copy broadcaster link** gives a read-only link (it uses the overlay key) that updates live on a tablet and shows the finished sheet afterward. Season stats save to each player on the team's basketball roster: paste a table from MaxPreps, a spreadsheet or a CSV with its header row (several tabs one after another, each fills its columns; totals become per-game numbers using GP), or type them in. Letter, legal or 11 × 17.

**Teams.** Build teams once in the control panel's **Team builder** tab: name, abbreviation, ranking, record, colors, logo, and a basketball and a football roster (paste, PDF/CSV import, or one at a time, with player photos and photo alignment). On game day, open **Teams → Today's game**, pick the left and right teams, and press **Load teams**: the scorebug gets each team's info and logo, and the stat keeper gets the roster for the current sport (empty if the team has none saved, so the last opponent's players don't stay behind). If plays are already logged for a side, you're asked before its roster is replaced. Editing a team that's in today's game updates the scorebug and stat keeper when you save. **Quick edit** on the Teams tab changes this game only; **Save team profile** there writes the change back to the saved team. Rosters saved with the stat keeper's **Save roster** button are the same rosters, matched by team name.

**Player graphics without a photo** show the team's logo in the photo box, with the number beside the name. If the team has no logo either, the box shows the big number as before.

**Saved banners.** In **Graphics → Banners**, write a banner (use {TEAM} for the team name), pick team color or custom background and text colors, add an optional sponsor logo, set how many seconds it stays up, and save it. Saved banners appear as buttons in the **Banner** section on Live. **Clear all fields** on the Graphics tab empties the graphic form so nothing from the last graphic carries over.

**One sport switch.** The Football / Basketball switch at the top of the control panel moves the scorebug and the stats together. If plays are logged, it asks first and keeps a backup of the old stat game in the browser.

**Ticker.** The `jlflux/ticker` score ticker, run from the panel instead of `config.js`. As a bottom bar it lifts the scorebug and lower thirds above it. It reads Google Sheets (the same template, `ticker-sheet-template.csv`), ESPN scoreboards, games typed into the panel, and optionally the game on the scorebug. Corner box or bottom bar.

**Scoreboard data.** Takes readings from a ScoreSight camera feed, or reads the press-box scoreboard controller (FairPlay, Daktronics, etc.) over RS-232 through Chrome's Web Serial API: no local server or driver install beyond the USB-serial adapter. Map each value to a byte offset once (ASCII, BCD or binary). A live hex view highlights the bytes that change, and mappings can be saved and exported.

**Team library.** Save team names, colors and logos and load them onto either side. Rosters save to the library per sport too.

**Virtual gamecast (football).** For games where video isn't allowed (like the AHSAA playoffs), `/gamecast` stands in for the camera: put it under the scorebug with an audio broadcast. Enter each play (run, pass, sack, punt, kickoff, field goal, PAT, penalty) with the numbers and yards, and it draws on the field. Down, distance, ball spot, possession and score follow NFHS rules (kickoff from the 40, PAT from the 3, touchbacks to the 20, half the distance on penalties), with undo and replay.
- **Gamecast (2D)**, the default, is an ESPN-style full-field view: each play of the current drive is a row (runs straight, passes and kicks arc, dotted = incomplete or no good, dashed yellow = penalty), with a team pin on the ball, the line to gain, a Current Drive header, Down / Ball on, and a play card with player stat cards built from the play log. Backgrounds: Transparent (for OBS), Light, Dark or Green screen; Grey or Green field.
- **3D players** animates 22 players on a lit 3D field with a broadcast, All-22, end zone or sky camera; **3D lines** draws the plays as lines on that field.
- **Teams → Load today's teams from the scorebug** brings in names, colors, logos and the saved football rosters. **Send score, possession and down & distance to the scorebug** is off by default; leave it off if ScoreSight, the serial import or the stat keeper sets the score.
- In OBS, add **Style → OBS sources → Gamecast field** as a Browser Source below the scorebug source.

## Launch on Vercel

1. Create a GitHub repo from this folder and import it into Vercel (root directory, **Other** framework preset).
2. Connect a Neon Postgres database through the Vercel Marketplace, or set `DATABASE_URL` to a Neon connection string. The app creates its table (`studio_docs`) on first use.
3. Set `SCOREBUG_ADMIN_PASSWORD` to a random password of at least 20 characters. Redeploy after changing environment variables.
4. Open the production URL and sign in.

Use the production URL in OBS. If Vercel Deployment Protection is on for production, OBS will get Vercel's sign-in page instead of the overlay.

## Add it to OBS

1. In the control panel, open **Style → OBS sources** (or click **Copy OBS URL** at the top).
2. In OBS add a **Browser Source**, paste the full URL (it ends in `#key=…`), set **1920 × 1080**, and leave "Shutdown source when not visible" **unchecked**.
3. Optional: use the split URLs (`?layers=bug,banner`, `?layers=graphic`, `?layers=ticker`, `?layers=full,wipe`) as separate sources so you can hide or move layers in OBS. Keep the `full,wipe` source on top.
4. Optional: add the control panel as an OBS **Custom Browser Dock**.

The overlay key gives read-only access to what's on air. It changes if you change the password.

## Run it on one laptop (no internet)

```bash
npm install
SCOREBUG_ADMIN_PASSWORD=pick-a-long-password-here npm run local
```

Open `http://localhost:3000/control`. Data is saved in `./data`. To let a tablet on the same network run the stat keeper, start it with `HOST=0.0.0.0`; then anyone on that network who has the password can change the game.

## Game night notes

- **One score source.** The stat keeper's **Send score to scorebug**, ScoreSight and the serial import can all write the score. Pick one, or turn off the stat keeper's auto-send when the scoreboard feed is running. If the stat keeper and the bug ever disagree, a yellow bar offers **Set scorebug to stats**.
- **Next period** advances the quarter and resets the game clock. Football also restores timeouts at the half; basketball also resets team fouls (NFHS quarter fouls) and the shot clock.
- **Swap sides** flips teams, scores, timeouts, fouls and possession, and the stat keeper's teams and plays with them.
- **Keyboard shortcuts** (turn on in the control panel): Space game clock, X play/shot clock, R reset play/shot clock, B scorebug, Esc clear graphic and banner, W wipe, 1/2 add a point. Stat keeper: U undo, Esc deselect.
- The stat keeper keeps a backup of the last cleared game in the browser, and **Download backup** saves the whole game as JSON.

## Scoreboard camera (ScoreSight)

[ScoreSight](https://github.com/locaal-ai/scoresight) reads the scoreboard from a camera with OCR. Its free version can POST its readings to a URL, and Broadcast Studio accepts them at `/api/feed`.

1. In ScoreSight, name your boxes the standard way: **Home Score**, **Away Score**, **Time**, **Period**, **Shot Clock**, **Home Fouls**, **Away Fouls**, **Home Timeouts**, **Away Timeouts**. For football, **Down**, **To Go**, **Ball On** and **Home/Away Possession** also work. ScoreSight's other common names (Guest, Visitor, Clock, Quarter…) are recognized too.
2. In the control panel, open **Scoreboard data** and copy the **Feed URL**.
3. In ScoreSight's **API** tab, check **Send out API requests to external services** and paste the URL. Set Encoding to **JSON (Simple key-value)** (JSON (Full) works too) and Method to **POST**. Set the rate to **2 requests per second** and leave **Only changes** off.
4. Check that the readings show up in the panel's table, set which side the home team is on, then turn on **Send ScoreSight readings to the scorebug**.

The clock runs on its own while the readings count down and stops when they hold still. It never runs ahead of the last reading. Like the serial import, only values that change are applied, so a manual fix stays until the scoreboard changes. The feed URL contains a key that can change the score: keep it private. It changes if you change the password.

## Mapping a scoreboard controller

1. Connect the controller's serial output to the laptop with a USB-to-RS232 adapter (some need a null-modem adapter).
2. **Scoreboard data → Connect…**, pick the port, and try 9600 baud first.
3. Watch **Last frame**. If frames come in as one long run, set the start byte, end byte or frame length until each frame is the same size.
4. Run the clock and change the score on the controller. The bytes that change light up. Enter their offsets in **Field mapping** and check the **Decoded** column.
5. Tick **Send to scorebug**. Save the mapping with a name so you can load it next game.

## Development

```bash
npm test                                   # API, stat engine, roster parser, serial decoding, full-screens, wipes, spotting layout, scoresheet
LOCAL_PG_URL=postgres://… npm test         # also runs the API test against real Postgres
```

Everything is vanilla JS modules with no build step. Bundled third-party files: Barlow Condensed (SIL Open Font License, `public/fonts`), pdf.js (Apache-2.0, `public/vendor`) for reading roster PDFs, and three.js r128 (MIT, `public/vendor`) for the gamecast's 3D view. Scanned PDFs have no text to read; paste the roster instead.

**Requirements:** OBS 28 or newer. Scoreboard import needs Chrome or Edge on a desktop. The overlay checks for changes about every 0.8 seconds.
