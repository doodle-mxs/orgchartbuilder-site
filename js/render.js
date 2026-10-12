// Shared styling (colours, card text) plus the SVG renderer used for the
// on-screen preview and the SVG/PNG exports.

const FONT = 'Helvetica, Arial, sans-serif';
const EDGE_COLOR = '#94a3b8';
const PALETTE = [
  '#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2',
  '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#9333ea',
];

function escXml(v) {
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
}

// Mix a #rrggbb colour with white; amount 0 = original, 1 = white.
function tint(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => {
    const v = (n >> shift) & 255;
    return Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

// Builds the per-card style helpers from the settings and the full node list.
// Categories are taken from all nodes so colours stay stable when zooming into a branch.
function makeStyler(s, nodes) {
  const categories = new Map();
  if (s.colorBy) {
    for (const n of nodes) {
      const v = n.rec[s.colorBy] || '(none)';
      if (!categories.has(v)) categories.set(v, PALETTE[categories.size % PALETTE.length]);
    }
  }
  const hueOf = (n) => (s.colorBy ? categories.get(n.rec[s.colorBy] || '(none)') : s.baseColor);

  function colors(n) {
    const hue = hueOf(n);
    switch (s.cardStyle) {
      case 'solid':
        return { fill: hue, stroke: hue, strokeWidth: 1, text: '#ffffff', sub: tint(hue, 0.75) };
      case 'outline':
        return { fill: '#ffffff', stroke: hue, strokeWidth: 2, text: '#1f2937', sub: '#4b5563' };
      default: // tinted
        return { fill: tint(hue, 0.88), stroke: hue, strokeWidth: 1.25, text: '#1f2937', sub: '#4b5563' };
    }
  }

  function lines(n) {
    return [s.line1, s.line2, s.line3]
      .filter(Boolean)
      .map((col) => n.rec[col] || '')
      .filter((t, i) => i === 0 || t);
  }

  return { colors, lines, categories };
}

const measureCtx = document.createElement('canvas').getContext('2d');
function fitText(text, font, maxWidth) {
  measureCtx.font = font;
  if (measureCtx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measureCtx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

function renderSVG(layout, s, styler) {
  const { width, height } = layout;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`);
  out.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

  out.push(`<g fill="none" stroke="${EDGE_COLOR}" stroke-width="1.5">`);
  for (const e of layout.edges) {
    out.push(`<path d="M${e.points.map((p) => p.join(' ')).join(' L')}"/>`);
  }
  out.push('</g>');

  const fs = s.fontSize;
  const rx = s.rounded ? 6 : 0;
  for (const c of layout.cards) {
    const col = styler.colors(c.node);
    const lines = styler.lines(c.node);
    const sizes = lines.map((_, i) => (i === 0 ? fs + 1 : fs - 1));
    const lineH = sizes.map((z) => z * 1.3);
    let y = c.y + c.h / 2 - lineH.reduce((a, b) => a + b, 0) / 2;

    out.push(`<g class="card" data-id="${escXml(c.node.id)}">`);
    out.push(`<title>${escXml(lines.join('\n'))}</title>`);
    out.push(`<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="${rx}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="${col.strokeWidth}"/>`);
    lines.forEach((t, i) => {
      const weight = i === 0 ? 'bold' : 'normal';
      const text = fitText(t, `${weight} ${sizes[i]}px ${FONT}`, c.w - 12);
      y += lineH[i];
      out.push(`<text x="${c.x + c.w / 2}" y="${y - lineH[i] * 0.28}" text-anchor="middle" font-size="${sizes[i]}" font-weight="${weight}" fill="${i === 0 ? col.text : col.sub}">${escXml(text)}</text>`);
    });
    if (c.hidden) {
      // Badge for reports hidden by the "levels shown" setting.
      const bx = c.x + c.w / 2;
      const by = c.y + c.h;
      out.push(`<rect x="${bx - 16}" y="${by - 8}" width="32" height="16" rx="8" fill="#ffffff" stroke="${EDGE_COLOR}"/>`);
      out.push(`<text x="${bx}" y="${by + 4}" text-anchor="middle" font-size="10" fill="#475569">+${c.hidden}</text>`);
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}
