// Exports a computed layout as a draw.io (diagrams.net) file. Every card keeps
// its CSV row as shape data (Edit > Edit Data in draw.io), and connectors are
// attached to the cards so they follow when shapes are moved by hand.

function escHtml(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// draw.io stores shape data as XML attributes, so column names must be valid attribute names.
function dataAttributes(rec) {
  const reserved = new Set(['id', 'label', 'placeholders', 'tooltip', 'link']);
  const used = new Set();
  let out = '';
  for (const [key, value] of Object.entries(rec)) {
    let name = key.replace(/[^A-Za-z0-9_.-]/g, '_');
    if (!/^[A-Za-z_]/.test(name)) name = '_' + name;
    if (reserved.has(name.toLowerCase())) name += '_';
    while (used.has(name)) name += '_';
    used.add(name);
    out += ` ${name}="${escXml(value)}"`;
  }
  return out;
}

function toDrawio(layout, s, styler) {
  const ids = new Map(layout.cards.map((c, i) => [c.node, `p${i + 1}`]));
  const round = (v) => Math.round(v * 10) / 10;
  const cells = [];

  for (const c of layout.cards) {
    const col = styler.colors(c.node);
    const label = styler.lines(c.node)
      .map((t, i) => (i === 0
        ? `<b>${escHtml(t)}</b>`
        : `<span style="font-size:${s.fontSize - 1}px;color:${col.sub}">${escHtml(t)}</span>`))
      .join('<br>');
    const style = [
      `rounded=${s.rounded ? 1 : 0}`, 'arcSize=8', 'whiteSpace=wrap', 'html=1',
      `fillColor=${col.fill}`, `strokeColor=${col.stroke}`, `strokeWidth=${col.strokeWidth}`,
      `fontColor=${col.text}`, `fontSize=${s.fontSize + 1}`, 'fontFamily=Helvetica', 'spacing=4',
    ].join(';') + ';';
    cells.push(
      `<object label="${escXml(label)}" id="${ids.get(c.node)}"${dataAttributes(c.node.rec)}>` +
      `<mxCell style="${style}" vertex="1" parent="1">` +
      `<mxGeometry x="${round(c.x)}" y="${round(c.y)}" width="${c.w}" height="${c.h}" as="geometry"/>` +
      '</mxCell></object>');
  }

  const base = `html=1;rounded=0;endArrow=none;startArrow=none;strokeColor=${EDGE_COLOR};strokeWidth=1.5;`;
  layout.edges.forEach((e, i) => {
    let style;
    let points = '';
    if (e.kind === 'tree') {
      style = s.orientation === 'TB'
        ? 'edgeStyle=elbowEdgeStyle;elbow=vertical;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;'
        : 'edgeStyle=elbowEdgeStyle;elbow=horizontal;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;';
    } else {
      const entryX = e.kind === 'stackL' ? 1 : 0;
      style = `edgeStyle=orthogonalEdgeStyle;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=${entryX};entryY=0.5;entryDx=0;entryDy=0;`;
      const [x, y] = e.points[1];
      points = `<Array as="points"><mxPoint x="${round(x)}" y="${round(y)}"/></Array>`;
    }
    cells.push(
      `<mxCell id="e${i + 1}" style="${base}${style}" edge="1" parent="1" source="${ids.get(e.from)}" target="${ids.get(e.to)}">` +
      `<mxGeometry relative="1" as="geometry">${points}</mxGeometry></mxCell>`);
  });

  return '<mxfile host="orgchartbuilder">' +
    '<diagram name="Org chart" id="orgchart">' +
    '<mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0">' +
    '<root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    cells.join('') +
    '</root></mxGraphModel></diagram></mxfile>';
}

// app.diagrams.net/#R<data> opens a diagram straight from the URL fragment.
// The fragment never leaves the browser, so the data is not uploaded anywhere.
async function drawioUrl(xml) {
  const bytes = new TextEncoder().encode(encodeURIComponent(xml));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return 'https://app.diagrams.net/#R' + encodeURIComponent(btoa(bin));
}
