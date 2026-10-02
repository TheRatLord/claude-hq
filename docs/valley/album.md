# The photo album: photo mode's looks, the album panel, the farmhouse photo wall

Photo mode (P) is a camera with a few tasteful looks and frames; every picture goes into a browser-local album with
what the camera knew (when, where, the time of day, the weather, who is in frame) and a caption you can edit. The
album is a scrapbook panel (L); your favourites hang in frames over the farmhouse bed.

Key sources (paths relative to `renderer/src/farm/`):

* `model/album.ts`: pure, tested by `album.test.ts`. The `PhotoMeta` record and `sanitizeMeta`, the limits
  (`ALBUM_CAP`, `FAV_CAP`, `pruneFor`, `canFavourite`), the wall picks (`wallPicks`, `wallKey`), the words
  (`timeOfDay`, `weatherWord`, `nearestPlace` + `STRUCTURE_PLACES`, `whoLine`, `autoCaption`, `sanitizeCaption`,
  `photoFileName`, `dateLabel`), framing maths (`cropRect`, `fitSize`), who is in frame (`framedSubjects`,
  `focusSubject`) and the photo-mode prefs (`sanitizePhotoPrefs`).
* `photo.ts`: photo mode (keys, the viewfinder, capture, metadata, "say cheese"); service `photo` (`PhotoService`).
* `photolab.ts`: the darkroom (DOM canvas, no three): filters, frames, baked-in name tags, handwriting, live-preview
  CSS strings.
* `albumstore.ts`: IndexedDB storage; service `album` (`AlbumService`, which is also the wall's `AlbumWallSource`).
* `hud/album.ts` + `album.css`: the panel (`album`).
* `scene/interior/photowall.ts`: the wall's photos; frames in `room.ts`, slots in `layout.ts` (`photoWallSlots`).
* `scene/cheese.ts`: how much someone plays to the camera (`cheeseWeight`), read by `farmers/farmers.ts`,
  `villagers/villagers.ts` and `life/companion.ts`.

## Photo mode

| key | does |
|---|---|
| WASD, Space / C, Shift | fly (the body stays put) |
| Wheel | zoom (18°–95°) |
| [ ] (hold), R | scrub the clock; R returns to the time you had |
| 1–6 | the look: natural, warm film, sepia, black & white, dreamy, tilt-shift |
| V (Shift+V back) | the frame: none, polaroid, postcard |
| G | rule-of-thirds grid (viewfinder only) |
| N | name tags in the picture (default off: nameplates stay out of photos) |
| T | self-timer: off / 3 s / 10 s (Enter again cancels a countdown) |
| X | also download a framed PNG on every save (default off: the album is enough) |
| F | focus on whoever is at the crosshair and say cheese |
| Enter | take the picture (or start the timer) |
| L | leave for the album |
| P / Esc | leave |

The settings persist in localStorage `valley.hud.photo` (`sanitizePhotoPrefs`). The chips row on the bar shows them
(`data-testid` `photo-filter`, `photo-frame`, `photo-grid`, `photo-tags`, `photo-timer`, `photo-download`).

**The viewfinder** previews the look with CSS over the WebGL canvas: the look's base filter on the canvas
(`FILTER_BASE`), tint / vignette / light-leak layers, a `backdrop-filter` bloom for dreamy, two blurred
`backdrop-filter` bands for tilt-shift, the crop of a polaroid (square) or postcard (3:2) shown by darkening the rest,
the thirds grid, focus brackets (gold once F locked a subject, with their name) and, with N, name pills over everyone in
frame. None of it is in the picture: the picture is developed from the canvas pixels.

**Who is in frame** (`candidates` in `photo.ts`): farmers and helpers (the `farmers` locator's head positions),
villagers (`villagers` service), the village pets (`pets`) and your own pet (`companion.where()`), projected through
the camera, dropped when behind it, off the crop, under 3.5 % of the frame tall, beyond 70 m, or behind a ridge (a
terrain ray-march; buildings and trees are not checked). Indoors only your pet within 9 m counts. `framedSubjects`
keeps the eight biggest.

**Focus.** The subject nearest the crosshair (`focusSubject`, within 16 % of the frame) or, with nobody there, where
the crosshair ray meets the ground. The tilt-shift band centres on it; its width follows the subject's size (or the
ground's distance: far scenes get a wider sharp band, close ones the toy-town look).

**Say cheese** (`PhotoService.cheese()` → `CheeseCue`: the camera position and look, real-time `from` / `until`, the
focused id). F starts a 3.6 s cue; the timer starts one for its last two seconds. `cheeseWeight` gives anyone in front
of the camera within 18 m a weight (focus 1, others fading with distance and angle): farmers and villagers turn to the
lens, look up into it and smile; the one in focus waves with a sparkly face (villagers also stop walking); your pet sits
up facing the camera, ears up (a head tilt, or a kitten's slow blink, when it is the focus). The camera stands in for
the player while the cue runs.

**The first-person viewmodel and other things drawn for the player** must hide while `ctx.services.get('photo').on`
(or `controller.flying`) is true.

## A picture

1. `engine.renderOnce()` and, in the same task, the canvas is drawn into a 2D canvas: cropped (`cropRect`) and
   capped at 1600 px on the longest edge (`fitSize`, `MAX_EDGE`).
2. The metadata: `photoId`, time, the game hour, season, weather, who is in frame, the place, and `autoCaption`
   ("Ada & Posy at the windmill, at golden hour"). **The place** is the room you are in ("inside the farmhouse",
   "inside the barn"), else the nearest named place to the focus point (the subject, the crosshair's ground point,
   or the camera) whose reach covers it: landmarks and nooks (`STRUCTURE_PLACES`, each with its own reach), the trail's
   POIs, the pond, the village square and the fields ("the claude-hq field"); else "out in the valley" / "out by the
   valley rim".
3. Developed (`develop`): the look applied with canvas filters and composites (grain tile, vignettes, light leaks,
   bloom, a masked sharp band for tilt-shift), then name tags (`drawTags`) when N is on.
4. Stored: a JPEG (0.92) and a 360 px thumbnail (0.86) through `album.add`. A small card slides in with the
   thumbnail ("Saved to your album · L opens the album").
5. With X on (or when the album could not take it), a framed PNG downloads too (`compose` + `photoFileName`).
6. `onSave(meta)` listeners run (the stamp book's `photo` counter: [stamps.md](stamps.md)).

## Frames (`compose`)

The frame is applied when shown or exported, so it always carries the current caption.

* **Polaroid**: a square print on an off-white card (a fibre speckle, a hairline inset shadow), the caption
  handwritten in blue ink underneath, a pencilled date in the corner.
* **Postcard**: a 3:2 print on cream card, "Greetings from" in script over big outlined "CLAUDE VALLEY" letters filled
  with a saturated, warm-tinted copy of the picture (the old large-letter postcards) with an extruded shadow. A
  perforated "2 bits · VALLEY POST" stamp with a painted valley (sun, hills, the windmill), a round postmark (date,
  hour, "CLAUDE VALLEY" round the ring) with wavy cancellation lines, and the caption on a little paper label.

There are no font files. Handwriting (`handwrite`) uses a script face where the system has one, else an italic serif,
drawn letter by letter with a wobbling baseline, slant and ink pressure; long captions shrink, then wrap to two lines.

## Storage (`albumstore.ts`)

* IndexedDB `claude-valley-album` v1: store `meta` (`{ id, meta, thumb }`, every record loaded at start and
  sanitised; thumbnails stay in memory, ≈ 25 KB each) and store `image` (the full JPEG, read on demand).
* At most `ALBUM_CAP` (120) photos. A new one past the cap deletes the oldest non-favourites first (`pruneFor`).
  Favourites are capped at `FAV_CAP` (60) so a new photo always finds room. A failed write (usually the quota)
  prunes ten more of the oldest non-favourites and tries once more; if that fails too, the photo downloads as a PNG.
* No IndexedDB (blocked storage, some private windows), or `?album=memory`: the session's photos live in memory
  (`persistent: false`); the panel says so and suggests X.

## The album panel (`hud/album.ts`)

L anywhere (outside a terminal), L in photo mode, the pause menu's **Photo album**, `ui.album(id?)`, or E on a frame
of the photo wall.

* **The scrapbook**: kraft paper, prints taped in at a slight tilt (polaroids square, postcards dashed), caption and
  date under each, a heart on favourites; tabs **Every photo / ♥ Favourites**; how full the album is.
* **One photo**: large, in its frame, recomposed as you type the caption (debounced); the caption box (Enter or leaving
  it saves; sanitised to 80 characters), when (date, game time, part of the day), where, sky (weather, season), the
  look, who is in it (chips by kind), ♥ Favourite, Download PNG (frame baked in, `claude-valley-YYYYMMDD-HHMMSS-place.png`),
  Delete (asks twice). ← → step through the current tab, Esc goes back to the scrapbook (Esc again closes).

## The photo wall (`scene/interior/photowall.ts`)

Eight frames over the farmhouse bed, two salon-style rows (sizes and woods vary; the first slots, the newest
favourites, are the biggest, in the middle). The photos are one mesh: a quad per frame into one 1024×512 atlas canvas
(8 cells), each favourite's thumbnail drawn cropped to its frame (cover) with a little glass sheen; an empty frame
shows a pencilled camera and "your photo ♡". The atlas redraws only when `wallVersion` changes (the picks, by
`wallKey`); bitmaps are closed after drawing; the texture, geometry and material are disposed with the room.
+1 draw call inside the farmhouse. E on a frame opens that photo in the album (an empty one explains how to fill it).

## Dev and tests

* `__valley.service('photo')`: `toggle()`, `prefs(patch?)`, `snap()`, `focus()`, `cheese()`, `inFrame()`.
* `__valley.service('album')`: `list()`, `get(id)`, `update(id, { caption, fav })`, `remove(id)`, `persistent`.
* `__hud.open('album', id?)`; `__valley.inside('photos')` stands in front of the wall.
* `browser-tests/album.spec.ts` (run `npx playwright test album --output scratch/pw-album`): every key, the timer,
  say cheese, metadata, the panel (caption, favourite, export, step, delete), the wall and E on a frame, a reload,
  and the memory fallback. It saves the framed exports (`export-<look>-<frame>.png`), the viewfinder, the album and the
  wall into its output folder: look at them.
