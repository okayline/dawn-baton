# Dawn Baton Changelog

Newest first. Times are Hawaii time (HST). The detailed dev changelog is kept separately.

---

## v0.32 — "Small Print"
**Thu Oct 29, 2026 · 3:10 PM HST**

- The footer is a bit smaller and a few pixels higher. Removed: the larger footer text.

## v0.31 — "Snug"
**Thu Oct 29, 2026 · 3:00 PM HST**

- The links and footer row sit right under the panel. Removed: about 16px of space above the row.

## v0.30 — "Footer Row"
**Thu Oct 29, 2026 · 2:55 PM HST**

- **How to Play and Ledger sit on the same line as the footer**, on the left, with the footer on the right. Removed: the centered footer on its own line, and the "Played before? Tap the ≡…" line under the panel.

## v0.29 — "No Login Page"
**Thu Oct 29, 2026 · 2:50 PM HST**

- **The Account tab is now "You"** and holds only your band and your name. Save codes, passkeys, logging in and out, and the copy you carry are all in the footer's ≡ window. Removed: the save codes, passkeys, log in and log out sections, the Carry list with its Pin buttons, and the "Saved on N devices" line.
- The footer is centered on the page. Removed: nothing.

## v0.28 — "Footer"
**Thu Oct 29, 2026 · 2:25 PM HST**

- **The shared footer** from dungeon-items ("© ~*~88x31~*~ cLuB, year · ≡ v0.28"), the same line every game shows. Its ≡ pops up the carry window. Removed: "Dawn Baton v…" at the start of the footer (How to Play and Ledger stay).
- **The carry window** (`/api/carry`): the registry's page of every copy your account holds, with your save codes, passkeys and logging in and out, in Dawn Baton's colours. Same as scoundrel.exe's. Removed: nothing; Account still has everything it had.

---

## v0.27 — "Carry"
**Mon Oct 26, 2026 · 12:30 AM HST**

- **Each lap's baton is marked with its dawn:** the holder's band (dawn_band_N) and their sky (dawn_sky_clear and so on; an unknown sky gets no mark), so every copy of the baton holds a different sunrise. Removed: batons with no marks.
- **You carry a copy:** Catch shows it. It's your account's pinned copy from any 88x31 game, or your newest copy, in gold if the Moon blessed it. If the baton comes to you, the copy you carried gets a "rode_with_baton" mark. Removed: nothing said what you hold elsewhere.
- **Account has a Carry list:** every copy your account holds, each with Pin. Removed: no way to choose the copy you carry.
- Needs dungeon-items with the pinned copy (its migration 007) live first.

---

## v0.26 — "Lap Address"
**Wed Oct 21, 2026 · 3:05 AM HST**

- **The address now shows the lap you're looking at:** open Yesterday (or tap ◀ ▶) and the address becomes `dawn.88x31.app/?lap=5`, so you can copy it. The other tabs go back to the plain address. Removed: nothing.

---

## v0.25 — "Lap Results"
**Wed Oct 21, 2026 · 3:10 AM HST**

- **A finished lap's page now has a Results panel at the bottom** of the Yesterday tab: the lap number, when it opened and closed, how many people passed the baton, how many bands went unheld, the settle / lean / silent count, and the lap's place in the ledger (first and closing entry, with the closing entry's record, previous fingerprint and fingerprint). Nothing about a player is shown. Removed: nothing.
- **A lap now has its own link:** `dawn.88x31.app/?lap=12` opens Yesterday on lap 12 (a lap that hasn't finished says so). Removed: nothing; the page still opens on Catch without it.

---

## v0.24 — "One Record"
**Tue Oct 20, 2026 · 2:55 AM HST**

- **Each finished lap is now written into the shared item registry** used by all the 88x31.app games: the ledger's length and newest fingerprint. The registry is timestamped on Bitcoin every hour, so this game's ledger is covered by that one stamp instead of its own. You can see these lines on the registry's ledger page, in this game's own colours: one sentence for each lap ("Lap 12 came home, and 3 people passed the baton along. 2 bands went unheld."), the lap's 24 colours and its tune. No names, and no bot count. Removed: the separate timestamp for this ledger from v0.23.

## v0.23 — "Proof of Dawn"
**Tue Oct 20, 2026 · 2:22 AM HST**

- **The ledger is now timestamped on Bitcoin every hour,** like the 88x31 ledger and the shared item registry already are. Anyone can later check that no lap, stamp or unheld band was changed after the fact. Nothing about a player is included, only the ledger's newest fingerprint.

## v0.22 — "Quick Key"
**Tue Oct 20, 2026 · 1:18 AM HST**

- **The Account tab loads faster after you log in.** Your save codes, passkeys and games now come back in one trip instead of four, and your device count no longer waits for them. Nothing on the page changed and nothing was removed.

## v0.21 — "Quick Dawn"
**Tue Oct 20, 2026 · 12:51 AM HST**

- **Tabs open faster.** The game no longer redoes its end-of-window housekeeping on every tap, only when a lap opens or a band's window closes. A tab now says "Loading…" the moment you tap it, instead of staying blank.
- **"Opens in" counts to the millisecond** on Catch: hours, minutes, seconds and thousandths.

## v0.20 — "Keepsake"
**Tue Oct 20, 2026 · 12:26 AM HST**

- **Each lap's baton is now a real item.** When a lap closes, one of the people who passed the baton that lap gets it to keep: a numbered copy of The Dawn Baton in the shared item registry used by all the 88x31.app games. If it's yours, Yesterday tells you and links to its page. Nobody else is told who got it. A lap with no players makes no baton.

## v0.19 — "Twenty-Four"
**Mon Oct 19, 2026 · 8:15 PM HST**

- **Times are 24-hour now.** The window times and the ledger show 24-hour time, like the other games.

## v0.18 — "Open Book"
**Mon Oct 19, 2026 · 8:00 PM HST**

- **The ledger is open.** A new Ledger link in the footer lists every lap, stamp and unheld band, newest first, with the exact date and time and the fingerprints that chain them together. What someone picked stays hidden until its lap is over.

## v0.17 — "One Key"
**Sat Oct 17, 2026 · 2:45 AM HST**

- **Save codes and passkeys now come from one shared accounts system** with the other 88x31 games, so a passkey made on any `88x31.app` address will work on all of them. Your save code keeps working: it moves to your account the first time you're seen.
- **Passkeys you made here before can't carry over** (a passkey belongs to the exact address it was made on), so make a new one. Your save code covers you until then.

## v0.16 — "Next Up"
**Thu Oct 15, 2026 · 4:22 PM HST**

- **After you pass the baton,** the top of "Your dawn" says "Your next window is in 23h 40m at 3:57 PM", counting down live. The "Passed" card now says "See how it turned out tomorrow morning!"
- **Yesterday's "You didn't catch the baton" card** uses the same countdown.
- **On Yesterday, a stamp you pick takes the top spot.** Your own stamp drops into the list at its place, still outlined.
- **Five lines reworded:** "New day, fresh start!", "sipping coffee", "mid-workout", "good music" and "a friend".
- **The page tells browsers it's already dark,** so dark-mode features stop washing out the colors.

## v0.15 — "Fresh Words"
**Thu Oct 15, 2026 · 4:00 PM HST**

- **Your stamps can't be followed from lap to lap anymore.** New stamps no longer carry anything that ties them to a player in the public record. Your own stamp and name still show up for you.
- **The replies got a rewrite:** "Right back a'cha!", "Still half aslee--", "Hot coffee, good vibes.", "*warm wave*", "Rise and shine ☀️", "Let's goo!", "We got this." and more.
- **Vibe check words:** excited, vibey, cooked, pretty good, blessed and chill.
- **Three new answers for "What are you bringing today?":** blind faith, a dollar and a dream, and a smile.

## v0.14 — "Tune Your Band"
**Thu Oct 15, 2026 · 3:45 PM HST**

- **New players are offered the band their location is in,** already selected in the "Tune your band" card. Nothing is saved until they press the button.
- **A band can only be changed once a week.** You get an hour after your first pick to fix a mistake. After that, Account shows when you can change it again.
- **Changing your band takes a few steps:** in Account, tap "Change band…", pick one, press Change, then confirm.
- **A README for players** with a longer How to Play.

## v0.13 — "Your Dawn"
**Thu Oct 15, 2026 · 3:30 PM HST**

- **"Your dawn" is redone.** From the top: the countdown (bigger and bold), your band with your local time, sunrise and sunset, day length, and your streak ("5 laps in a row").
- **The band picker moved to Account.** It's the first card there. Catch only shows it if you haven't picked a band yet.
- **The baton's band number sits under its gold dot** in the row of dots below the globe. No other dot has a number.
- **The globe turns a little slower** when you're not touching it.

## v0.12 — "How To"
**Thu Oct 15, 2026 · 3:20 PM HST**

- **A How to Play page.** Tap "How to Play" next to the version at the bottom of any screen. Five short cards: what the game is, your band, catching the baton, Yesterday and the globe.
- **Bands the baton hasn't reached yet are pale gray** on the globe, so they no longer look like night.
- **The sun on the globe is a little ☀️** instead of a white ring, so white only ever means you.

## v0.11 — "Slow Turn"
**Thu Oct 15, 2026 · 3:05 PM HST**

- **The Catch globe turns on its own** when you're not touching it. It stops at your band for 3 seconds first, then drifts slowly west. Touch it, or tap a dot, and it waits again.
- **Change your band and the globe follows.** Pick a new UTC offset and the globe, the strip and "Your dawn" update right away.
- **On Yesterday, tapping a band or a stamp puts that stamp at the top of the strand,** right under your own, with the rest of the list in order after it. The globe's lighting stays put.

## v0.10 — "Look Around"
**Thu Oct 15, 2026 · 2:55 PM HST**

- **The globe is on three screens now:** Catch, Yesterday and Planet (not Account), tilted a little so you can see the top of the world.
- **On Catch the globe is centered on you,** with your band edged in white and the baton's bands edged in gold. If the baton is on the far side of the planet, its edges show as a dotted line. Drag it sideways, slowly, to look around.
- **A row of 24 dots under the globe** shows the whole lap: gold is the baton, the white ring is "Here". Tap any dot to turn the globe to that band. The white dot takes you home.
- **A countdown in "Your dawn":** "Opens in 5h 12m" before your window, "Open for 1h 40m more" during it, and your next window once you've passed the baton.
- **On Yesterday the globe shows that lap in the colors its players picked.** Tap a band in the lap bar, or a stamp in the strand, and the globe turns to it.

## v0.9 — "The Big Picture"
**Thu Oct 15, 2026 · 2:35 PM HST**

- **A globe on the Planet tab.** The 24 bands are cut out on a globe that stays centered on whoever holds the baton. Open bands glow gold, stamped bands are blue, and unheld bands are dark. Your own band number is green.
- **Real day and night.** The shading follows where the sun actually is right now, and a white ring marks the spot where it's straight overhead.
- **Light country outlines** give the globe some context.

## v0.8 — "Moving Notes"
**Thu Oct 15, 2026 · 2:20 PM HST**

- **The notes move every day.** Each day has its own home note. On the Catch screen, the last three notes you can hear decide the pitch: Settle steps back toward home, Lean steps away, and a rest holds still. Your own Settle or Lean button sounds as the next step.
- **Yesterday's tune** plays the whole lap straight through in that day's key.
- **The last band's quote:** if they skipped the reply, one of their other picks stands in for it.
- **Your name** is now just a Shuffle button: tap it and you get a new pair of words.
- **The tune** on the Catch screen plays a little faster.
- **Yesterday's lap bar** has lost the starry background. Empty bands are see-through.

## v0.7 — "Vibe Check"
**Thu Oct 15, 2026 · 2:05 PM HST**

- **A quieter Catch screen:** the little explainer lines under each question and at the bottom are gone. Just the questions.
- **Friendlier questions:** "What color is your morning?", "Does the tune settle, or lean?", "Morning, sunshine ☀️", "Vibe check?", "You caught me…" and "What are you bringing today?" (this replaces the old sign-off slot).
- **New words, same slots:** replies, feelings, gestures and the last slot are rewritten in a looser, funnier voice, with an even mix of morning and not-morning answers.
- **Settle and Lean:** the two tune buttons are now called Settle and Lean, on the Catch and Yesterday screens.
- **The last band's card:** their band number and "a while ago" now sit at the top, above what they said.

## v0.6 — "One of a Kind"
**Thu Oct 15, 2026 · 1:33 PM HST**

- **Names are unique.** If the two words you pick already belong to someone, you don't get a number: nothing is saved and you're offered a free pair to try.
- **The version number** is shown at the bottom of the page.
- **Every stamp slot asks a question** ("What color is your morning?", "How do you sign off?" and so on), so a choice has some context.
- **Catch screen:** you see what the last band left (their words, color, weather, and their band number like "+9" with a loose "a while ago") with no labels. Who they were and the exact time stay hidden until the lap closes.
- **Tune:** the play button plays the last 3 notes slowly, and a second press stops it. Picking Resolve or Tension plays that note.
- **Yesterday:** go back through earlier laps with the arrows. If you missed a lap, it says so and when your next window is. Each stamp is numbered and shows the time to the second.
- **The lap bar** sits on a starry sky: 24 softer colors, empty bands see-through. Weather icons and note symbols (music note = resolve, flat = tension, dash = silent or unheld) line up underneath, and a "Play the tune" button plays the whole lap. Entries show the weather icon on the right.

## v0.5 — "Two Words"
**Thu Oct 15, 2026 · 12:33 PM HST**

- **Pick a name** on the Account tab: one word from each of two lists (40 + 40), with a Shuffle button.
- Your name shows on your stamps on the Yesterday screen once the lap is over. A checkbox turns that off.
- Names are never written into the ledger, only your player id is.

## v0.4 — "Sky and Slots"
**Thu Oct 15, 2026 · 12:30 PM HST**

- **More on a stamp:** a reply phrase, a feeling, a gesture and a sign-off, all picked from lists, all optional. The next band sees them on the Catch screen, and the Yesterday screen shows the whole strand.
- **Sunrise line** on the Catch screen: sunrise, sunset, day length and how much it changed since yesterday. Solstices and equinoxes are called out, and polar day and night are handled.
- **Admin preview:** admins can press **X** to look at every screen with made-up data. Nothing is sent or saved.
- A new save code can be **downloaded as a text file**.
- The game is now called **Dawn Baton**.
- Fixed the admin bar staying on screen after it was closed.

## v0.3 — "Home Address"
**Thu Oct 15, 2026 · 12:18 PM HST**

- The game lives at **dawn.88x31.app**. The old workers.dev address sends you there.
- **Lap 1 starts** Oct 15 at 18:00 UTC.

## v0.2 — "Keys"
**Thu Oct 15, 2026 · 12:13 PM HST**

- **Save codes and passkeys** (ported from scoundrel.exe): play as the same player on any browser or device. Up to 5 save codes, shown once.
- **Account tab:** make and forget codes and passkeys, log in on a device, log out.

## v0.1 — "First Light"
**Thu Oct 15, 2026 · 11:55 AM HST**

- **24 fixed solar bands**, one baton that travels west around the planet once a day, one catch window of 2 hours per band.
- A stamp has an automatic sky report, a mood color and a resolve or tension note.
- Bands nobody holds get a bot's stamp, or show as unheld.
- Everything is sealed on one hash chain. What a lap holds stays hidden until it closes.
- Three screens: Catch, Yesterday, Planet.
