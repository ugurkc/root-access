# Root Access — design bench

Phone-first prototype of *Root Access*, an idle clicker about hacking from your
room. This build is a **design bench**: the contested design decisions are tabs
at the top of the screen so testers can play the alternatives side by side.

Play: **https://ugurkc.github.io/root-access**

## Variants

| Axis | Options |
|---|---|
| TAP | **Instant** (every tap pays) · **Bar** (taps fill a job, payout on completion) · **Jobs** (tap to start a timed hack, collect when done) |
| IDLE | **Equipment** (gear earns per second) · **Helpers** (only the Botnet earns passively; laptop and rack become tap items) · **None** |

Each of the 9 combinations has its own save in the phone's browser. Switching
tabs offers *Continue* or *New run* for that slot. The **RUN** button reopens
that choice; **SND** mutes.

## Tuning

Everything a designer might change is in [`config.js`](config.js): items,
base costs, cost growth, max level, variant parameters (bar length, job
duration and payout), feel toggles, number formatting. Edit, commit, push;
GitHub Pages redeploys in about a minute. Saves store levels, not prices, so
retuning does not wipe anyone's progress.

Check pacing without playing:

```bash
node tools/sim.js equipment 3   # idle mode, taps per second
```

It prints when a greedy player first buys and maxes each item.

## Local

Any static server works:

```bash
python3 -m http.server 8787
```

Then open http://localhost:8787 (or your Mac's LAN IP on a phone).

Design notes: [docs/plans/2026-10-17-prototype-design.md](docs/plans/2026-10-17-prototype-design.md).
