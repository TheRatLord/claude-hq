# The map (M) and the minimap

The hand-drawn parchment chart: how the base is painted once, the live layers drawn per frame, the pin language, the
toggleable layers and the corner minimap.

Key sources: `hud/map.ts` (panel + minimap + layer toggles), `hud/mapdraw.ts` (live layers and chart furniture),
`hud/mapbase.ts` (the painted base; `mapbase.test.ts`), `hud/mappins.ts` (pin glyphs + place data), `hud/map.css`,
`world/map.ts` (`TRAILS`, `POIS`, `YARD`, `NOOKS`). Paths are relative to `renderer/src/farm/`.

## The painted base

A hand-drawn parchment chart, **painted once** in idle time (`warmBase`, ~5 px/m over the whole 300 m world, repainted
only when the season changes; the minimap blits a half-res copy and never forces the build):

* a watercolour wash (meadow mosaic, groves, the forest ring, mossy shelves, ochre rock, pale peaks, faded to bare
  paper at the world's edge), paper grain and tea stains;
* **hachures** down every steep slope (the cliff strata read as inked bands);
* the river with inked banks and flow dashes, the pond with ripple rings, beach and lily pads, the waterfall and the
  four cascades;
* roads as inked double lines (ruts on the big ones), footpaths dashed, **trails** (`world/map.ts` `TRAILS`) as red
  dots, hedgerows;
* stamped trees (round / pine / willow, seasonal; the map re-plays `scene/flora/scatter.ts`'s noise, hud never imports
  scene systems), the square's cobbles, the yard's picket fence, the garden, and every landmark as a little drawing
  with a cast shadow.

## Per frame

Only while open; the minimap at ≤ 30 Hz. It blits the visible part and draws the live layers: fields, hint washes,
place tiles, the festival, request hearts, scarecrows, villagers, farmers, labels (greedy, never over a pin, sign or
the furniture), the player arrow + view cone, then the cached furniture: compass rose (top right), title cartouche
"Claude Valley · season · festival · rank" (bottom right, shrinks on laptops), scale bar, deckled edge.

## Pin language (`mappins.ts`; the side panel's *Key* draws the same pins)

* circles = farmers (status colour, gold pulsing ring = needs you);
* houses = villagers; crosses = scarecrows;
* rounded **tiles** = places (store, mailbox + unread count, your yard, the farmhouse door, nooks, fishing spots with
  what bites now, trail stops from `POIS`: trailhead / bench / rope bridge / summit, the *Hillside orchard* ([orchard.md](orchard.md)));
* the **Valley Projects** ([projects.md](projects.md)): the board (terracotta tile with pinned cards), each ruin (a
  grey broken arch; gold when finished and waiting to be seen) and each restored place (terracotta, its own glyph:
  lamp, bridge, glasshouse, wheel, dome, bell; labelled). `ProjectPin` / `projectTile` in `mappins.ts`, gathered in
  `map.ts` (`projectPins`: the `projects` service for state, `projectsScene.anchor` for where);
* **hearts** = today's requests (on the villager, or on the place to visit; gold + pulsing when ready);
* the **rosette** = the festival centrepiece (`festivals.where().center`).

Hover any pin for a tooltip; only farmers / scarecrows (and fields, Shift) act on a click. Each pin carries one glyph
(`pinGlyph()`: the tag's suffix; [hud.md](hud.md#names)). Click a pin, or ↑/↓ + Enter in the side list (farmers *and*
scarecrows), to open a terminal. In the panel, 9 fits the whole valley in view.

## Layers

Toggle chips over the key, remembered in `valley.hud.mapLayers`; `data-testid="map-layer-<id>"`:

* *Places* and *Requests* on by default;
* *Forage* (soft washes nudged off today's unpicked spots: the area, never the spot; [pastimes.md](pastimes.md));
* *Wildlife* (habitat washes with the species' paw tile and when, "out now!" + a pulse while one is about, dimmed out of
  season; text from `SIGHTINGS`; [wildlife.md](wildlife.md)).

Live data comes through `HudBindings.service(name)` (forage, wildlife, festivals, yard → the store), `friends`,
`collection`, gathered ≤ 3×/s. The key starts folded on screens ≤ 860 px tall (toggle remembered, `valley.hud.mapKey`).

## Minimap

The same art; fields, villagers, hearts, the store and festival, farmers; a farmer who needs you is bigger with a gold
halo and, when off the minimap, waits on the rim with a pointer toward them. 160 px (136 px on short screens), top
right; N toggles it (pref `minimap`).

## Shots and tools

```sh
npm run shoot -- --shot name=m,pose=hub,panel=map    # the map panel
npm run shoot -- --shot "name=mw,pose=hub,hour=19,panel=map,eval=setTimeout(()=>{dispatchEvent(new KeyboardEvent('keydown',{key:'9'}));document.querySelector('[data-testid=map-layer-wildlife]').click()},1500)"  # whole valley + wildlife layer
npm run mapviz                                       # top-down map PNG, no browser (tools.md)
```

`__hud.mapHits()` returns map hit targets in canvas css px (browser tests click farmers by these).
