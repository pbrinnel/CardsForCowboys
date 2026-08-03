// src/cardslist.js — renders the public Cards List page (cardslist.html).
//
// Reads the SHIPPED card database straight out of src/card-db.js (classic script, loaded
// immediately before this one). That is the whole point of the page: it can never list a card
// the game doesn't deal, or miss one it does, because there is no second copy of the data.
//
// Layout is the in-game "My Deck" matrix widened for a full page: rows are Acts (Starters
// first), columns are the three suits. Deprecated cards are excluded — they are retained in
// card-db.js only so historical games still render, and they are never dealt.
'use strict';

const SUITS = [
  { cacti: 1, name: 'River',       note: 'never has Bandits' },
  { cacti: 2, name: 'Cactus',      note: 'up to 1 Bandit' },
  { cacti: 3, name: 'Rattlesnake', note: '1–2 Bandits' },
];

// act 0 is the starter deck — it is not an Act tier, it just shares the row shape.
const ROWS = [
  { act: 0, label: 'Starters', sub: 'each player' },
  { act: 1, label: 'Act 1',    sub: 'Store front' },
  { act: 2, label: 'Act 2',    sub: 'Store middle' },
  { act: 3, label: 'Act 3',    sub: 'Store back' },
];

function cardsFor(act, cacti) {
  const pool = act === 0
    ? STARTER_TEMPLATES
    : STORE_CARDS.filter(c => !c.deprecated && c.act === act);
  return pool.filter(c => c.cacti === cacti).sort(byPrintedFace);
}

// Sort on what is PRINTED on the card, with the id only as a last-resort tiebreak. Several cards
// share a face (card_70 / 77 / 78 are all the same $2 Explosive), and sorting by cost-then-id
// scattered those duplicates through the column — Act 1 River read $2 Explosive, $1, $2 Explosive,
// $2 Explosive. Because every field of the face is compared before the id, cards with the same
// face necessarily sort adjacent, so each one reads as a run of copies rather than a coincidence.
//
// Cost leads because affording a card is the first question you ask of the Store. Inside a cost
// tier it is best-first on each stat in turn: most Cows (the win condition), then most $, then
// fewest Bandits (so Jail's -1 leads), then plain cards ahead of Explosives and Draw 4s.
// Starters have no cost and fall straight through to the face comparison.
function byPrintedFace(a, b) {
  return (a.cost || 0) - (b.cost || 0)
    || (b.cows || 0) - (a.cows || 0)
    || (b.dollars || 0) - (a.dollars || 0)
    || (a.bandits || 0) - (b.bandits || 0)
    || String(a.special || '').localeCompare(String(b.special || ''))
    || cardNum(a) - cardNum(b);
}

function cardNum(c) {
  const m = /(\d+)$/.exec(c.id);
  return m ? Number(m[1]) : 0;
}

// Spoken description for screen readers and the zoom caption. Mirrors what is printed on the
// card, in the order the rules teach it (suit, effects, cost).
function describe(card) {
  const suit = SUITS.find(s => s.cacti === card.cacti).name;
  const bits = [];
  if (card.dollars) bits.push(`$${card.dollars}`);
  if (card.cows) bits.push(`${Math.abs(card.cows)} ${Math.abs(card.cows) === 1 ? 'Cow' : 'Cows'}`);
  if (card.bandits > 0) bits.push(`${card.bandits} ${card.bandits === 1 ? 'Bandit' : 'Bandits'}`);
  if (card.bandits < 0) bits.push(`Jail (cancels ${Math.abs(card.bandits)} Bandit)`);
  if (card.special === 'draw4') bits.push('Draw 4');
  if (card.special === 'burn_to_use') bits.push('Explosive');
  if (!bits.length) bits.push('no printed effect');
  const cost = card.cost != null ? `, cost $${card.cost}` : '';
  return `${suit} — ${bits.join(', ')}${cost}`;
}

function cardEl(card) {
  const label = describe(card);
  // A <button>, not a bare <img>: the card opens the zoom, so it has to be reachable and
  // operable from the keyboard. css/a11y.css supplies the :focus-visible ring.
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cl-card';
  btn.setAttribute('aria-label', `Zoom in on ${label}`);
  const img = document.createElement('img');
  img.src = CARD_IMG_PATH + card.img;
  img.alt = label;
  img.loading = 'lazy';
  img.draggable = false;
  btn.appendChild(img);
  btn.onclick = () => openZoom(CARD_IMG_PATH + card.img, label);
  return btn;
}

function render() {
  const root = document.getElementById('cards-list');

  // Column headings. Sticky, because the suit a column belongs to is the one thing you lose
  // track of once you have scrolled two Acts down.
  const head = document.createElement('div');
  head.className = 'cl-head';
  head.appendChild(document.createElement('div')).className = 'cl-rowlabel';
  const headSuits = document.createElement('div');
  headSuits.className = 'cl-suits';
  for (const s of SUITS) {
    const h = document.createElement('div');
    h.className = 'cl-suithead';
    h.innerHTML = `<img src="assets/symbols/${s.name}-01.png" alt=""><span>${s.name}</span>`;
    headSuits.appendChild(h);
  }
  head.appendChild(headSuits);
  root.appendChild(head);

  for (const r of ROWS) {
    const row = document.createElement('div');
    row.className = `cl-row act-${r.act}`;

    const total = SUITS.reduce((n, s) => n + cardsFor(r.act, s.cacti).length, 0);
    const label = document.createElement('div');
    label.className = 'cl-rowlabel';
    label.innerHTML =
      (r.act ? `<img class="cl-hat" src="assets/symbols/Act${r.act}-01.png" alt="">` : '') +
      `<strong>${r.label}</strong><span>${total} cards<br>${r.sub}</span>`;
    row.appendChild(label);

    const suits = document.createElement('div');
    suits.className = 'cl-suits';
    for (const s of SUITS) {
      const col = document.createElement('div');
      col.className = 'cl-col';
      // Read back out by the narrow-layout CSS, which stacks the columns and needs a heading
      // for each one once they are no longer under the sticky suit header.
      col.dataset.suit = s.name;
      col.dataset.suitNote = s.note;
      const cards = cardsFor(r.act, s.cacti);
      if (!cards.length) {
        const none = document.createElement('p');
        none.className = 'cl-none';
        none.textContent = 'None';
        col.appendChild(none);
      }
      cards.forEach(c => col.appendChild(cardEl(c)));
      suits.appendChild(col);
    }
    row.appendChild(suits);
    root.appendChild(row);
  }
}

// --- ZOOM ---
// 82px thumbnails are unreadable by design (the page is an index, not a reader), so every card
// opens full size. Same interaction as the in-game card zoom: click anywhere or press Escape.

let lastFocused = null;

function openZoom(src, label) {
  lastFocused = document.activeElement;
  const overlay = document.getElementById('cl-zoom');
  document.getElementById('cl-zoom-img').src = src;
  document.getElementById('cl-zoom-img').alt = label;
  document.getElementById('cl-zoom-cap').textContent = label;
  overlay.classList.remove('hidden');
  document.getElementById('cl-zoom-close').focus();
}

function closeZoom() {
  document.getElementById('cl-zoom').classList.add('hidden');
  // Send focus back to the card that opened it, or a keyboard user is dumped at the top of a
  // 64-card page every time they close a zoom.
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
  lastFocused = null;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('cl-zoom').classList.contains('hidden')) {
    closeZoom();
  }
});

render();
