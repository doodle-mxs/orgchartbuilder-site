// Turns CSV records into a tree, then computes card positions and connector
// routes. Pure functions: no DOM access, so the same layout drives the preview,
// the SVG/PNG export and the draw.io export.

// map: { id, name, manager, sortBy } -> column names ('' = not mapped)
function buildTree(records, map) {
  const warnings = [];
  const nodes = [];
  const byId = new Map();
  const byName = new Map();

  records.forEach((rec, i) => {
    const row = i + 2; // +1 for header, +1 for 1-based
    const name = map.name ? rec[map.name] : '';
    const id = (map.id ? rec[map.id] : name) || `row-${row}`;
    if (byId.has(id)) {
      warnings.push(`Row ${row}: duplicate ID "${id}", row skipped.`);
      return;
    }
    const node = { id, name: name || id, rec, row, parent: null, children: [] };
    nodes.push(node);
    byId.set(id, node);
    if (name && !byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), node);
  });

  // The manager column may hold either IDs or names; accept both.
  for (const n of nodes) {
    const ref = map.manager ? n.rec[map.manager] : '';
    if (!ref) continue;
    const m = byId.get(ref) || byName.get(ref.toLowerCase());
    if (!m) warnings.push(`Row ${n.row}: manager "${ref}" of ${n.name} not found, shown at top level.`);
    else if (m === n) warnings.push(`Row ${n.row}: ${n.name} is their own manager, shown at top level.`);
    else n.parent = m;
  }

  // Break reporting loops (A -> B -> A) so the result is always a tree.
  for (const n of nodes) {
    const seen = new Set();
    for (let p = n; p; p = p.parent) {
      if (seen.has(p)) {
        warnings.push(`Reporting loop through ${p.name}, shown at top level.`);
        p.parent = null;
        break;
      }
      seen.add(p);
    }
  }

  for (const n of nodes) if (n.parent) n.parent.children.push(n);

  if (map.sortBy) {
    const cmp = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
    for (const n of nodes) n.children.sort((a, b) => cmp(a.rec[map.sortBy] || '', b.rec[map.sortBy] || ''));
  }

  const roots = nodes.filter((n) => !n.parent);
  return { nodes, roots, byId, warnings };
}

// s: { orientation 'TB'|'LR', cardW, cardH, hGap, vGap, stack 'off'|'1'|'2', stackMin, maxDepth }
// Returns { cards: [{node, x, y, w, h, hidden}], edges: [{from, to, kind, points}], width, height }
function computeLayout(roots, s) {
  const TB = s.orientation === 'TB';
  // Work in abstract axes: "breadth" runs along siblings, "depth" runs down the levels.
  const NB = TB ? s.cardW : s.cardH;
  const ND = TB ? s.cardH : s.cardW;
  const sib = s.hGap;
  const lvl = s.vGap;
  const stub = Math.max(16, Math.round(sib / 2)); // trunk-to-card gap in stacked lists
  const rowGap = Math.max(8, Math.round(sib / 3)); // gap between stacked cards
  const MARGIN = 24;
  const box = new Map();

  const kidsOf = (n, depth) => (s.maxDepth && depth + 1 >= s.maxDepth ? [] : n.children);

  function measure(n, depth) {
    const kids = kidsOf(n, depth);
    const b = { kids, mode: 'leaf', hidden: kids.length ? 0 : n.children.length };
    box.set(n, b);
    if (!kids.length) {
      b.span = NB; b.extent = ND; b.c = NB / 2;
      return b;
    }

    const allLeaves = kids.every((k) => !kidsOf(k, depth + 1).length);
    if (TB && s.stack !== 'off' && allLeaves && kids.length >= s.stackMin) {
      // Stack reports vertically along a trunk dropping from the manager.
      const cols = s.stack === '2' && kids.length > 1 ? 2 : 1;
      b.mode = 'stack';
      b.c = cols === 1 ? NB / 2 : NB + stub;
      kids.forEach((k, i) => {
        const kb = measure(k, depth + 1);
        const row = cols === 1 ? i : Math.floor(i / 2);
        kb.side = cols === 1 || i % 2 ? 'R' : 'L';
        kb.ob = cols === 1 ? NB / 2 + stub : (i % 2 ? NB + 2 * stub : 0);
        kb.od = ND + lvl / 2 + row * (ND + rowGap);
      });
      const rows = Math.ceil(kids.length / cols);
      b.span = cols === 1 ? NB / 2 + stub + NB : 2 * NB + 2 * stub;
      b.extent = ND + lvl / 2 + rows * (ND + rowGap) - rowGap;
      return b;
    }

    // Classic tree: subtrees side by side, manager centred over first..last report.
    b.mode = 'tree';
    let pos = 0;
    for (const k of kids) {
      const kb = measure(k, depth + 1);
      kb.ob = pos;
      kb.od = ND + lvl;
      pos += kb.span + sib;
    }
    const first = box.get(kids[0]);
    const last = box.get(kids[kids.length - 1]);
    let c = (first.ob + first.c + last.ob + last.c) / 2;
    const shift = Math.max(0, NB / 2 - c); // manager wider than its reports' span
    if (shift) for (const k of kids) box.get(k).ob += shift;
    c += shift;
    b.c = c;
    b.span = Math.max(pos - sib + shift, c + NB / 2);
    b.extent = ND + lvl + Math.max(...kids.map((k) => box.get(k).extent));
    return b;
  }

  function place(n, b0, d0) {
    const b = box.get(n);
    b.b = b0 + b.c - NB / 2;
    b.d = d0;
    for (const k of b.kids) {
      const kb = box.get(k);
      place(k, b0 + kb.ob, d0 + kb.od);
    }
  }

  // Several top-level people (or orphans) are laid out side by side.
  let pos = MARGIN;
  let maxExtent = 0;
  for (const r of roots) {
    const rb = measure(r, 0);
    place(r, pos, MARGIN);
    pos += rb.span + sib * 2;
    maxExtent = Math.max(maxExtent, rb.extent);
  }

  const cards = [];
  const edges = [];
  const xy = (b) => (TB ? { x: b.b, y: b.d } : { x: b.d, y: b.b });
  const W = s.cardW;
  const H = s.cardH;

  for (const [n, b] of box) {
    const p = xy(b);
    cards.push({ node: n, x: p.x, y: p.y, w: W, h: H, hidden: b.hidden });
    for (const k of b.kids) {
      const c = xy(box.get(k));
      let points;
      let kind = 'tree';
      if (b.mode === 'stack') {
        kind = box.get(k).side === 'L' ? 'stackL' : 'stackR';
        const tx = p.x + W / 2;
        const cy = c.y + H / 2;
        points = [[tx, p.y + H], [tx, cy], [kind === 'stackL' ? c.x + W : c.x, cy]];
      } else if (TB) {
        const mid = p.y + H + lvl / 2;
        points = [[p.x + W / 2, p.y + H], [p.x + W / 2, mid], [c.x + W / 2, mid], [c.x + W / 2, c.y]];
      } else {
        const mid = p.x + W + lvl / 2;
        points = [[p.x + W, p.y + H / 2], [mid, p.y + H / 2], [mid, c.y + H / 2], [c.x, c.y + H / 2]];
      }
      edges.push({ from: n, to: k, kind, points });
    }
  }

  const breadth = pos - sib * 2 + MARGIN;
  const depth = maxExtent + 2 * MARGIN;
  return {
    cards,
    edges,
    width: Math.max(TB ? breadth : depth, 1),
    height: Math.max(TB ? depth : breadth, 1),
  };
}
