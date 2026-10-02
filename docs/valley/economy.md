# Bits, the General store and your yard (I)

The valley's little economy: the bit coin, your basket of finds, selling to Bram or the General store, yard decor and
the picket-fenced yard behind the farmhouse.

Key sources: `model/shop.ts` (catalogue and prices, pure), `model/wallet.ts` (purse / basket / yard, pure +
`wallet.test.ts`), `scene/yard/` (system `yard`, service `wallet`: `yard.ts`, `layout.ts`, `models.ts`, `assets.ts`),
`hud/shop.ts` + `shop.css` (panel `shop`), `world/map.ts` (`YARD`, `storeSpot`), `main.ts` (persistence). Paths are
relative to `renderer/src/farm/`.

## Bits and the basket

* The coin is the **bit** (a copper coin stamped with a sprout), shown on the status sign's coin chip.
* Every forage/fish/junk find goes into your **basket** ([pastimes.md](pastimes.md)); sell it to Bram (talk to him at
  the shipping bin when the basket has something) or at the **General store**, a green striped cart on the meadow
  south-east of the square, placed level beside a road (`storeSpot`): E browse, F sell your basket.
* Bram pays by rarity (forage: 45 for a rare one), size and rarity (fish), 2 for junk (40 for rare junk) (`sellPrice`
  in `model/shop.ts`).
* Real agent work pays a capped trickle (`WORK_PAY`: ship 4, celebrate 2, finished 3, unblocked 2, a new field 3, a duckling 1; max 40 bits a day, `WORK_CAP`; a "+n"
  floats on the chip). Requests and the welcome tour also pay ([friends.md](friends.md), [onboarding.md](onboarding.md)).

## The store

The store stocks 17 yard decor pieces: always (planters, flamingo, gnome, birdhouse, wind chime, Biscuit's bed, bench,
bird bath, scarecrow with three hats), seasonal (jack-o'-lantern, snowman, blossom sapling, parasol), and
Almanac-rank-gated (lamp post r2, fairy-light arch r3, Clawd topiary r4, golden gnome r7); each extra copy costs +35%,
each item has a max. Six more pieces appear at 6 ♥ friendship (`DecorDef.friend`), keepsakes at 10 ♥
(`DecorDef.keepsake`, never sold; [friends.md](friends.md)), and the Welcome sign and the stamp book's three trophy
cups are gifts (`DecorDef.gift`; [onboarding.md](onboarding.md), [stamps.md](stamps.md)). Stamps also pay bits.

## Your yard

* The picket-fenced garden behind the farmhouse (`world/map.ts` `YARD`, reserved in `clearance()`): 15 slots (5×3)
  with ghost rings while carrying.
* Look at a piece → E Move / F Turn; carrying snaps to the slot you look at (tint: free / taken = swap), E puts it
  down, F turns, X puts it away.
* The sign at the gate (E) and the shop's Yard tab (map + piece list: place, move, turn, restyle, put away) do the same
  from the HUD.
* Glowing pieces (lamp post, arch, pumpkin) register `LightEmitter`s ([art.md](art.md#local-light-night-dusk-storms)).
* Persisted per profile (`claude-valley.wallet.v1`).
* Keys: I opens your pockets (basket; 1/2/3 tabs).
* Budget: yard ≤ 6 draw calls (4 merged/instanced, +2 while carrying).

## Dev

`__valley.coins(n)`, `buy(id, free?)`, `sell()`, `furnish()` (fill the yard), `yard()` / `yard('store' | 'carry')`;
`__hud.open('shop', { tab: 'buy' | 'sell' | 'yard', at })`; gallery assets `decor` (variant `id` or `id:style`),
`general-store`.

```sh
npm run shoot -- --shot "name=y,hour=11,eval=__valley.furnish();__valley.yard()"   # your yard, filled (hour=21 for the lights)
npm run shoot -- --shot "name=yc,hour=11,eval=__valley.furnish();__valley.yard('carry')"   # carrying: slot rings + ghost
npm run shoot -- --shot "name=st,hour=11,eval=__valley.yard('store')"     # the General store cart
npm run shoot -- --shot "name=sp,pose=hub,eval=__valley.coins(800);__hud.open('shop',{tab:'buy',at:'store'})"  # shop panel (tab buy|sell|yard)
npm run shoot -- --shot name=d,gallery=decor,variant=scarecrow:2     # one decor piece (id or id:style)
```
