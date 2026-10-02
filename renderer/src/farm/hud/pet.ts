/**
 * Your pet's panel (`pet`; model/pet.ts, the scene's 'companion' service): opened by E on Fern's foundlings basket
 * (adopt: species, coat, a name) and, once you have a pet, its card (happiness, today's walks and games, rename).
 */
import './pet.css';
import { NAME_MAX, SPECIES, heartsOf, moodOf, sanitizeName, speciesDef, suggestNames, FREE_HEARTS, FOX_HEARTS } from '../model/pet.ts';
import type { CompanionService, Species } from '../model/pet.ts';
import { coins } from '../model/shop.ts';
import { svgIcon as S, ITEM_OUTLINE as ol } from './icons.ts';
import { framePanel, h, type HudCtx, type Panel } from './ctx.ts';

/** a little face per species in the coat's colour */
export function petFace(species: Species, swatch: string): string {
  const pale = '#fff6e6', ink = '#3b2a1e';
  const eyes = `<circle cx="9.3" cy="12.6" r="1.35" fill="${ink}"/><circle cx="14.7" cy="12.6" r="1.35" fill="${ink}"/><circle cx="9.7" cy="12.1" r=".45" fill="#fff"/><circle cx="15.1" cy="12.1" r=".45" fill="#fff"/>`;
  if (species === 'kitten') {
    return S(`<path d="M4.5 4.5l4.2 3.6M19.5 4.5l-4.2 3.6" stroke="none"/><path d="M5 3.8L9.6 8 4.6 10z" fill="${swatch}" ${ol}/><path d="M19 3.8L14.4 8l5 2z" fill="${swatch}" ${ol}/>`
      + `<ellipse cx="12" cy="13" rx="8" ry="6.8" fill="${swatch}" ${ol}/><ellipse cx="12" cy="16" rx="3.4" ry="2.3" fill="${pale}"/>${eyes}`
      + `<path d="M11.3 14.6h1.4l-.7.8z" fill="#f08a98"/><path d="M3 15.2l4 .2M3.4 17l3.8-.6M21 15.2l-4 .2M20.6 17l-3.8-.6" stroke="${ink}" stroke-width=".6" stroke-linecap="round"/>`);
  }
  if (species === 'fox') {
    return S(`<path d="M4.2 2.8L10 8.2 4.6 11z" fill="${swatch}" ${ol}/><path d="M19.8 2.8L14 8.2l5.4 2.8z" fill="${swatch}" ${ol}/><path d="M5.6 5.2l2.6 2.6-2.3 1.2z" fill="#3b2b27"/><path d="M18.4 5.2l-2.6 2.6 2.3 1.2z" fill="#3b2b27"/>`
      + `<path d="M3.6 11.5C4.5 8 8 6.6 12 6.6s7.5 1.4 8.4 4.9c-.6 3.9-4.2 8-8.4 8.6-4.2-.6-7.8-4.7-8.4-8.6z" fill="${swatch}" ${ol}/>`
      + `<path d="M4.4 13c2.6.3 5 1.6 7.6 5.6 2.6-4 5-5.3 7.6-5.6-1 3.6-4.2 6.5-7.6 7-3.4-.5-6.6-3.4-7.6-7z" fill="${pale}"/>${eyes}<ellipse cx="12" cy="18.6" rx="1.3" ry=".9" fill="${ink}"/>`);
  }
  return S(`<ellipse cx="12" cy="12.6" rx="7.6" ry="7" fill="${swatch}" ${ol}/>`
    + `<path d="M5.8 6.6C3.4 6.8 2 10 2.8 14.4c.4 1.6 1.9 1.6 2.6.4L7.6 9z" fill="${swatch}" ${ol} style="filter:brightness(.82)"/><path d="M18.2 6.6c2.4.2 3.8 3.4 3 7.8-.4 1.6-1.9 1.6-2.6.4L16.4 9z" fill="${swatch}" ${ol} style="filter:brightness(.82)"/>`
    + `<ellipse cx="12" cy="16.4" rx="3.9" ry="2.9" fill="${pale}"/>${eyes}<ellipse cx="12" cy="15" rx="1.5" ry="1.05" fill="${ink}"/><path d="M12 16v1.1M10.6 17.4c.7.5 2.1.5 2.8 0" stroke="${ink}" stroke-width=".7" fill="none" stroke-linecap="round"/>`);
}

const service = (ctx: HudCtx): CompanionService | null => { try { return (ctx.b?.service?.('companion') as CompanionService | undefined) ?? null; } catch { return null; } };

function heartRow(n: number): HTMLElement {
  const row = h('span.vh-hearts', { title: `${n} of 5 hearts`, 'aria-label': `${n} of 5 hearts`, 'data-testid': 'pet-hearts' });
  for (let i = 0; i < 5; i++) row.append(h(`i${i < n ? '.on' : ''}`, { text: '♥' }));
  return row;
}

export function createPetPanel(ctx: HudCtx): Panel {
  const { el, body, closeBtn } = framePanel('pet', "Fern's foundlings", petFace('puppy', '#e9b866'));
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const plaqueText = el.querySelector('.vh-plaque span:last-child') as HTMLElement | null;
  let species: Species = 'puppy', coat = 'golden', name = '', touched = false, sig = '';
  const err = h('div.vh-pet-err', { role: 'status', 'aria-live': 'polite' });

  function adoptView(svc: CompanionService): void {
    if (plaqueText) plaqueText.textContent = "Fern's foundlings";
    const o = svc.offer();
    const sd = speciesDef(species)!;
    if (sd.rare && !o.fox) species = 'puppy';
    const cur = speciesDef(species)!;
    if (!cur.coats.some((c) => c.id === coat)) coat = cur.coats[0].id;
    const sugg = suggestNames(species, ctx.now());
    if (!touched) name = sugg[0];
    const note = h('p.vh-pet-note', null,
      h('b', { text: 'Fern: ' }),
      '"Found this lot in the hay behind the barn. They need someone who walks the valley every day. Pick one, give it a good name, and it\'ll follow you anywhere."');
    const offer = o.fee === 0
      ? h('div.vh-pet-offer.free', null, '♥ Free to a good home: Fern knows you.')
      : h('div.vh-pet-offer', null, `A donation of ${coins(o.fee)} to the ranger's kibble fund`, h('span.sub', { text: ` · free once Fern has ♥${FREE_HEARTS} for you (♥${o.hearts} now) · you have ${coins(o.coins)}` }));
    const kinds = h('div.vh-pet-kinds', { role: 'radiogroup', 'aria-label': 'Species' });
    for (const s of SPECIES) {
      const locked = !!s.rare && !o.fox;
      const b = h(`button.vh-pet-kind${s.id === species ? '.sel' : ''}${locked ? '.locked' : ''}`, {
        type: 'button', role: 'radio', 'aria-checked': String(s.id === species), disabled: locked, 'data-testid': `pet-species-${s.id}`,
        title: locked ? `Fern only trusts the fox kit to a close friend (♥${FOX_HEARTS})` : s.blurb,
      },
      h('span.face', { html: petFace(s.id, (s.id === species ? s.coats.find((c) => c.id === coat) : null)?.swatch ?? s.coats[0].swatch) }),
      h('b', { text: s.name }), h('span.blurb', { text: locked ? `Fern's trust: ♥${FOX_HEARTS} (you: ♥${o.hearts})` : s.blurb }),
      s.rare ? h('span.rare', { text: 'rare' }) : null);
      b.addEventListener('click', () => { if (locked) return; species = s.id; touched = touched && name !== suggestNames(species, ctx.now())[0]; render(true); ctx.sfx('ui-click'); });
      kinds.append(b);
    }
    const coatsEl = h('div.vh-pet-coats', { role: 'radiogroup', 'aria-label': 'Coat' });
    for (const c of cur.coats) {
      const b = h(`button.vh-pet-coat${c.id === coat ? '.sel' : ''}`, { type: 'button', role: 'radio', 'aria-checked': String(c.id === coat), 'data-testid': `pet-coat-${c.id}`, title: c.name },
        h('i', { style: { background: c.swatch } }), c.name);
      b.addEventListener('click', () => { coat = c.id; render(true); ctx.sfx('ui-click'); });
      coatsEl.append(b);
    }
    const input = h('input.vh-pet-name', { type: 'text', maxlength: String(NAME_MAX * 2), value: name, 'aria-label': 'Name', 'data-testid': 'pet-name', autocomplete: 'off', spellcheck: 'false' });
    input.addEventListener('input', () => { name = input.value; touched = true; preview.textContent = `Adopt ${sanitizeName(name, sugg[0])}`; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdopt(); } e.stopPropagation(); });
    const chips = h('div.vh-pet-sugg', null, h('span', { text: 'Ideas:' }));
    sugg.forEach((n, i) => {
      const c = h('button.vh-btn.small', { type: 'button', text: n, 'data-testid': `pet-suggest-${i}` });
      c.addEventListener('click', () => { name = n; touched = true; input.value = n; preview.textContent = `Adopt ${n}`; });
      chips.append(c);
    });
    const afford = o.fee <= o.coins;
    const preview = h('span', { text: `Adopt ${sanitizeName(name, sugg[0])}` });
    const go = h('button.vh-btn.primary', { type: 'button', 'data-testid': 'pet-adopt', disabled: !afford }, preview, o.fee ? h('span.fee', { text: ` · ${coins(o.fee)}` }) : null);
    go.addEventListener('click', doAdopt);
    const later = h('button.vh-btn.ghost', { type: 'button', text: 'Not yet' });
    later.addEventListener('click', () => ctx.panels.close());
    if (!afford) err.textContent = `You need ${coins(o.fee - o.coins)} more (sell your basket to Bram), or make friends with Fern.`;
    body.replaceChildren(
      h('div.vh-pet-adopt', null, note, offer,
        h('div.vh-pet-sec', { text: 'Who comes home with you?' }), kinds,
        h('div.vh-pet-sec', { text: 'Coat' }), coatsEl,
        h('div.vh-pet-sec', { text: 'Name' }), h('div.vh-pet-namebox', null, input, chips),
        h('div.vh-pet-acts', null, later, go), err));
  }

  function doAdopt(): void {
    const svc = service(ctx);
    if (!svc) return;
    const sugg = suggestNames(species, ctx.now());
    const r = svc.adopt(species, coat, sanitizeName(name, sugg[0]));
    if (r.ok) {
      ctx.sfx('chime-done');
      ctx.toast({ text: `${r.pet.name} is coming home with you!`, sub: 'E to pet · F to throw a stick · it sleeps in your yard at night', level: 'good', key: `pet|${r.pet.name}` });
      ctx.panels.close();
    } else {
      err.textContent = r.reason === 'coins' ? 'Not quite enough bits for the kibble fund yet.' : r.reason === 'fox' ? 'Fern keeps the fox kit for a close friend.' : r.reason === 'already' ? 'You already have a pet.' : 'Something went wrong.';
      ctx.sfx('oops');
    }
  }

  function cardView(svc: CompanionService): void {
    const d = svc.model.data();
    const p = d.pet!;
    if (plaqueText) plaqueText.textContent = p.name;
    const sd = speciesDef(p.species)!;
    const c = sd.coats.find((x) => x.id === p.coat) ?? sd.coats[0];
    const hearts = heartsOf(d.happy);
    const input = h('input.vh-pet-name', { type: 'text', maxlength: String(NAME_MAX * 2), value: p.name, 'aria-label': 'Name', 'data-testid': 'pet-rename' });
    const save = h('button.vh-btn.small', { type: 'button', text: 'Rename' });
    const rename = () => { const n = svc.model.rename(input.value); if (n) { input.value = n; ctx.sfx('ui-click'); render(true); } };
    save.addEventListener('click', rename);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); rename(); } e.stopPropagation(); });
    const t = d.today;
    const since = p.since ? new Date(`${p.since}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    body.replaceChildren(h('div.vh-pet-card', null,
      h('div.vh-pet-top', null, h('span.face.big', { html: petFace(p.species, c.swatch) }),
        h('div', null, h('div.vh-pet-namebox', null, input, save),
          h('div.sub', { text: `${c.name} ${sd.name.toLowerCase()}${since ? ` · with you since ${since}` : ''}` }),
          h('div.mood', null, heartRow(hearts), h('span', { text: ` ${moodOf(d.happy)}`, 'data-testid': 'pet-mood' })))),
      h('div.vh-pet-today', null,
        h('div', null, h('b', { text: String(t.pets) }), 'pats today'),
        h('div', null, h('b', { text: `${Math.round(t.walk)} m` }), 'walked together'),
        h('div', null, h('b', { text: String(t.fetch) }), p.species === 'kitten' ? 'games' : 'sticks fetched'),
        h('div', null, h('b', { text: String(t.finds) }), 'finds sniffed out')),
      h('p.vh-pet-tip', { text: `${p.name} is happiest with a pat or two every day, a walk and a game.${d.streak > 1 ? ` ${d.streak} days of pats in a row!` : ''} At night it sleeps on the pet bed in your yard (the General store sells one) or on the porch, and by the hearth while you're indoors.` })));
  }

  function render(force = false): void {
    const svc = service(ctx);
    if (!svc) { body.replaceChildren(h('p.vh-pet-note', { text: 'The foundlings are napping. Come back in a moment.' })); return; }
    const d = svc.model.data();
    const o = svc.offer();
    const s = `${svc.model.version}|${o.fee}|${o.fox}|${o.coins}|${species}|${coat}`;
    if (!force && s === sig) return;
    sig = s;
    if (d.pet) cardView(svc); else adoptView(svc);
  }

  return {
    id: 'pet', el,
    onOpen() { err.textContent = ''; touched = false; sig = ''; render(true); (el.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true }); },
    refresh() { if (!el.contains(document.activeElement) || !(document.activeElement instanceof HTMLInputElement)) render(); },
  };
}
