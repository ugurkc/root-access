# Starter home and item classes — design

Agreed 2026-10-28. Replaces the current items, racks and job names with a smaller, more believable starter home. Numbers (prices, pay, drop chance, loot payouts, tier lengths) are not set here; they are tuned in the sim in the next step.

## Room

The starter home is small: seven class spots and one wall shelf with three rig spots. Only three of the six job rigs fit; the rest wait for the next home. Racks as purchasable items are removed.

## Classes

Each class owns one spot. You buy it once, then upgrade it through named tiers; each tier swaps the sprite and raises the effect. There is no separate tech and comfort grouping: every class has its own effect.

| Class | Effect | Tiers |
|---|---|---|
| Computer | job pay +% | Old laptop → Used desktop → Gaming PC → Workstation |
| Router | each HACK tap advances jobs further | ISP box → Better router → Mesh Wi-Fi → Fiber line |
| Tower Unit | automated (rigged) jobs run faster; the most expensive class | single tier |
| Desk | tap money +%, plus comfort | Simple desk → IKAE table → Standing desk |
| Chair | full-bar bonus +%, plus comfort | Kitchen chair → Office chair → Gaming chair |
| Cat | comfort; event gives a short timed comfort boost | single tier |
| Girlfriend | comfort; event: she massages your shoulders, a large timed comfort boost that makes taps very strong | single tier |

The general "all jobs faster" upgrade is removed: job speed now comes from the router (taps) and the Tower Unit (automation) only.

## Comfort

Comfort stays a passive stat. Desk, Chair, Cat and Girlfriend add to it, more per tier; Computer, Router and Tower Unit add none. Comfort multiplies job pay and tap money as today. Cat and Girlfriend events add timed comfort on top of the permanent amount. There are no other partner events.

## Jobs

1. Guess a neighbor's Wi-Fi password
2. Sell a cracked streaming account
3. Recover a locked phone for cash
4. Hack a kebab shop's loyalty app
5. Ransom a dentist's office PC
6. Crash a local radio station

## Loot drops

Every completed run, including runs while away, has a small random chance to drop loot: a funny piece of information tied to that job (for example "Neighbor's Netflix login" from the Wi-Fi job). A card appears and the player taps it to cash in. Unclaimed loot waits, which is a reason to come back. Each job has its own list of loot texts.

## Config and sim

The shared config gets a `classes` block (replacing `items` and `racks`) and a `loot` block; `jobs` gets the new names. The game and the sim both read them, so the starter-home numbers are tuned in the sim against the journey targets before the game changes.

## Next step

Scale the starter home down: realistic prices and pay, tier counts, drop chance and loot payouts, chosen with the sim.
