import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPFIRE_SONG, FESTIVAL_MUSIC, GATHER_SCENES, MUSIC_SCENES, barSeconds, chordDegs, degMidi, festivalTurn, inKey, musicScene, planBar, planPiece, sectionAt,
} from './musicPlan.ts';
import type { FestivalName, MusicIn, MusicScene, Piece, SeasonName } from './musicPlan.ts';

const base: MusicIn = { hour: 9, season: 'spring', weather: 'clear', intensity: 0, indoors: false, festival: null };
const SEASONS: SeasonName[] = ['spring', 'summer', 'autumn', 'winter'];
const FESTS = Object.keys(FESTIVAL_MUSIC) as FestivalName[];
const allBars = (p: Piece) => Array.from({ length: p.bars }, (_, b) => planBar(p, b));

test('scene follows the clock, the weather and the door', () => {
  assert.equal(musicScene({ ...base, hour: 7 }), 'morning');
  assert.equal(musicScene({ ...base, hour: 14 }), 'afternoon');
  assert.equal(musicScene({ ...base, hour: 19 }), 'evening');
  assert.equal(musicScene({ ...base, hour: 23.5 }), 'night');
  assert.equal(musicScene({ ...base, hour: 3 }), 'night');
  assert.equal(musicScene({ ...base, weather: 'rain', intensity: 0.6 }), 'rain');
  assert.equal(musicScene({ ...base, weather: 'storm', intensity: 0.95 }), null, 'a fierce storm is music enough');
  assert.equal(musicScene({ ...base, weather: 'storm', intensity: 0.5 }), 'rain');
  assert.equal(musicScene({ ...base, weather: 'storm', indoors: true }), 'indoors', 'by the hearth even in a storm');
  assert.equal(musicScene({ ...base, hour: 23, indoors: true }), 'indoors');
});

test('pieces are deterministic, sized like songs and rest afterwards', () => {
  assert.deepEqual(planPiece('morning', base, 3, 2), planPiece('morning', base, 3, 2));
  assert.notDeepEqual(planPiece('morning', base, 3, 2).melody, planPiece('morning', base, 3, 3).melody);
  for (const scene of MUSIC_SCENES) for (const season of SEASONS) for (let n = 0; n < 4; n++) {
    const p = planPiece(scene, { season, festival: null }, 11, n);
    const len = p.bars * barSeconds(p);
    assert.ok(len > 40 && len < 135, `${p.id} lasts ${len.toFixed(0)} s`);
    assert.ok(p.restAfter >= 14 && p.restAfter <= 75, `${p.id} rests ${p.restAfter} s`);
    assert.ok(p.form.startsWith('i') && p.form.endsWith('o'));
    assert.equal(sectionAt(p, p.bars), null);
    assert.equal(sectionAt(p, p.bars - 1)?.ch, 'o');
  }
  // night is slower and sparser than the afternoon
  const night = planPiece('night', base, 1, 0), day = planPiece('afternoon', base, 1, 0);
  assert.ok(night.bpm < day.bpm);
  const density = (p: Piece) => allBars(p).reduce((s, b) => s + b.notes.length, 0) / (p.bars * barSeconds(p));
  assert.ok(density(night) < density(day) * 0.7, `night ${density(night).toFixed(1)} vs day ${density(day).toFixed(1)} notes/s`);
});

test('every pitched note is in the key; strong-beat melody notes are chord tones', () => {
  for (const scene of MUSIC_SCENES) for (const season of SEASONS) for (let n = 0; n < 3; n++) {
    const p = planPiece(scene, { season, festival: null }, 5, n);
    for (let b = 0; b < p.bars; b++) {
      const bar = planBar(p, b);
      for (const x of bar.notes) {
        assert.ok(x.t >= 0 && x.t < bar.barSec && x.dur > 0 && x.vel > 0 && x.vel <= 1, `${p.id} bar ${b} timing`);
        if (x.inst === 'shaker') continue;
        assert.ok(inKey(p.tonic, p.mode, x.midi), `${p.id} bar ${b}: ${x.inst} ${x.midi} out of key`);
        if (x.role === 'lead') assert.ok(x.midi >= 52 && x.midi <= 91, `${p.id} lead register ${x.midi}`);
        if (x.role === 'bass') assert.ok(x.midi >= 30 && x.midi <= 58, `${p.id} bass register ${x.midi}`);
      }
      // melody on the strong beats (or held) sits on the bar's chord
      const sec = sectionAt(p, b)!;
      if (sec.ch === 'i' || sec.ch === 'o') continue;
      const spb = p.beats * 2, strong = p.beats === 4 ? 4 : 6;
      for (const m of p.melody[sec.ch]) {
        if (Math.floor(m.step / spb) !== sec.inSection || (m.step % strong !== 0 && m.len < 3)) continue;
        assert.ok(chordDegs(bar.chord).includes(((m.deg % 7) + 7) % 7), `${p.id} bar ${b}: degree ${m.deg} over chord ${bar.chord}`);
      }
    }
    // CPU: a bar never asks for a crowd of notes
    for (const bar of allBars(p)) assert.ok(bar.notes.length <= 30, `${p.id}: ${bar.notes.length} notes in a bar`);
  }
});

test('form: an A section repeats note for note, A ends home, B leans on the dominant', () => {
  for (const scene of ['morning', 'evening', 'night'] as MusicScene[]) {
    const p = planPiece(scene, base, 9, 1);
    const firstA = p.form.indexOf('A'), secondA = p.form.indexOf('A', firstA + 1);
    const startOf = (i: number) => [...p.form.slice(0, i)].reduce((s, ch) => s + (ch === 'i' || ch === 'o' ? 2 : p.sectionBars), 0);
    const lead = (b: number) => planBar(p, b).notes.filter((x) => x.role === 'lead').map((x) => x.midi);
    // the second A (not the last section) repeats the first's tune exactly
    if (secondA > 0 && p.form.slice(secondA + 1).replace('o', '').length > 0) {
      for (let k = 0; k < p.sectionBars; k++) assert.deepEqual(lead(startOf(secondA) + k), lead(startOf(firstA) + k), `${p.id} bar ${k} of A repeats`);
    }
    assert.equal(p.prog.A[p.prog.A.length - 1], 0, 'A closes on the tonic');
    if (p.prog.B) assert.notEqual(p.prog.B[p.prog.B.length - 1], 0, 'B leaves the door open');
    // the last section's last lead note is the tonic
    const lastSec = startOf(p.form.length - 1) - 1;
    const notes = planBar(p, lastSec).notes.filter((x) => x.role === 'lead');
    const fin = notes.length ? notes[notes.length - 1].midi : planBar(p, lastSec - 1).notes.filter((x) => x.role === 'lead').pop()!.midi;
    assert.equal(((fin - p.tonic) % 12 + 12) % 12, 0, `${p.id} ends on the tonic`);
  }
});

test('seasons change the band', () => {
  const kit = (season: SeasonName) => { const p = planPiece('morning', { season, festival: null }, 1, 0); return `${p.lead}/${p.comp}`; };
  assert.equal(new Set(SEASONS.map(kit)).size, 4);
  assert.equal(planPiece('indoors', base, 1, 0).perc, null);
  assert.ok(planPiece('indoors', base, 1, 0).reverb < planPiece('night', base, 1, 0).reverb, 'the room is drier than the night');
});

test('festivals: every other piece outdoors carries the leitmotif, in key, harmonized', () => {
  assert.ok(festivalTurn('afternoon', 'harvest', 0) && !festivalTurn('afternoon', 'harvest', 1));
  assert.ok(!festivalTurn('indoors', 'harvest', 0) && !festivalTurn('rain', 'harvest', 0));
  assert.ok(festivalTurn('night', 'lantern', 0) && !festivalTurn('night', 'blossom', 0));
  for (const f of FESTS) {
    const p = planPiece('evening', { season: 'summer', festival: f }, 2, 0);
    assert.equal(p.festival, f);
    const spec = FESTIVAL_MUSIC[f];
    assert.equal(p.lead, spec.lead);
    // the tune itself, untouched, opens the A section
    for (const [step, deg] of spec.motif) assert.ok(p.melody.A.some((m) => m.step === step && m.deg === deg), `${f} motif note at ${step}`);
    let hits = 0, all = 0;
    for (const b of allBars(p)) for (const x of b.notes) if (x.inst !== 'shaker') { all++; if (inKey(p.tonic, p.mode, x.midi)) hits++; }
    assert.equal(hits, all, `${f} in key`);
    // the auto-harmony fits most of the tune's strong notes
    const spb = p.beats * 2, strong = p.beats === 4 ? 4 : 6;
    let fit = 0, n = 0;
    for (const m of p.melody.A) if (m.step % strong === 0) { n++; if (chordDegs(p.prog.A[Math.floor(m.step / spb)]).includes(((m.deg % 7) + 7) % 7)) fit++; }
    assert.ok(fit / n >= 0.75, `${f}: ${fit}/${n} strong notes on the chord`);
    assert.equal(planPiece('evening', { season: 'summer', festival: f }, 2, 1).festival, null, 'and the next piece is an ordinary one');
  }
  // Hallowtide is in a minor key
  assert.equal(planPiece('evening', { season: 'autumn', festival: 'hallowtide' }, 1, 0).mode, 'minor');
});

test('degree arithmetic', () => {
  assert.equal(degMidi(60, 'major', 0), 60);
  assert.equal(degMidi(60, 'major', 7), 72);
  assert.equal(degMidi(60, 'major', -1), 59);
  assert.equal(degMidi(60, 'minor', 2), 63);
  assert.deepEqual(chordDegs(4), [4, 6, 1]);
  assert.ok(inKey(62, 'dorian', 71) && !inKey(62, 'minor', 71));
});

test('gatherings: the campfire sing-along and the band take over the music, never through the rain or the door', () => {
  assert.equal(musicScene({ ...base, hour: 20.5, gathering: 'campfire' }), 'campfire');
  assert.equal(musicScene({ ...base, hour: 19, gathering: 'concert' }), 'concert');
  assert.equal(musicScene({ ...base, hour: 20.5, gathering: null }), 'evening');
  assert.equal(musicScene({ ...base, gathering: 'campfire', indoors: true }), 'indoors');
  assert.equal(musicScene({ ...base, gathering: 'concert', weather: 'rain', intensity: 0.6 }), 'rain');
  for (const scene of GATHER_SCENES) for (const season of SEASONS) for (let n = 0; n < 4; n++) {
    const p = planPiece(scene, { season, festival: null }, 13, n);
    const len = p.bars * barSeconds(p);
    assert.ok(len > 40 && len < 135, `${p.id} lasts ${len.toFixed(0)} s`);
    assert.equal(p.scene, scene);
    for (const b of allBars(p)) for (const x of b.notes) if (x.inst !== 'shaker') assert.ok(inKey(p.tonic, p.mode, x.midi), `${p.id} in key`);
    if (scene === 'concert') {
      assert.ok(p.restAfter >= 4 && p.restAfter <= 9, 'a breath for applause between songs');
      assert.equal(p.lead, 'strings', 'the fiddle leads');
      assert.equal(p.comp, 'guitar', 'the banjo strums');
      assert.ok(p.perc, 'a shaker keeps time, any season');
    } else {
      assert.ok(p.restAfter >= 20, 'one song per sing-along');
      assert.equal(p.lead, 'reed');
      // the campfire song itself, every time
      for (const [step, deg] of CAMPFIRE_SONG.motif) assert.ok(p.melody.A.some((m) => m.step === step && m.deg === deg), `campfire song note at ${step}`);
      assert.equal(p.beats, 3);
    }
  }
  // the concert plays the festival's tune on festival nights; the campfire keeps its own song
  assert.equal(planPiece('concert', { season: 'autumn', festival: 'harvest' }, 2, 0).festival, 'harvest');
  assert.equal(planPiece('campfire', { season: 'autumn', festival: 'harvest' }, 2, 0).festival, null);
});
