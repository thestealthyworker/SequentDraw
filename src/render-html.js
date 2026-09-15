const ELK = require('elkjs');
const fs = require('fs');

const doc = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3] || 'map.html';
const R = 22, NW = R*2, NH = R*2, elk = new ELK();
const MARGIN = '[top=8,left=46,bottom=60,right=46]';
const ICO = require('./icons');

const layersOf = n => n.layers && n.layers.length ? n.layers : ['base'];
const primary = n => {
  const l = layersOf(n);
  return l.includes('future') ? 'future' : l.includes('business') ? 'business' : l.includes('edge') ? 'edge' : l.includes('build') ? 'build' : 'base';
};
const byId = {}; doc.nodes.forEach(n => byId[n.id] = n);

const cont = {};
doc.groups.forEach(g => cont[g.id] = {
  id: g.id, labels: [{ text: g.label }], children: [],
  layoutOptions: { 'elk.padding': '[top=40,left=26,bottom=26,right=26]', 'elk.spacing.nodeNode': '128', 'elk.layered.spacing.nodeNodeBetweenLayers': '78', 'elk.spacing.edgeNode': '26' }
});
const roots = [];
doc.nodes.forEach(n => {
  const c = { id: n.id, width: NW, height: NH,
    layoutOptions: { 'elk.margins': MARGIN, 'elk.portConstraints': 'FREE' } };
  if (n.parentId && cont[n.parentId]) cont[n.parentId].children.push(c); else roots.push(c);
});

const graph = {
  id: 'root',
  layoutOptions: {
    'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.edgeRouting': 'ORTHOGONAL',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.json.edgeCoords': 'ROOT', 'elk.spacing.nodeNode': '128',
    'elk.layered.spacing.nodeNodeBetweenLayers': '78', 'elk.spacing.edgeNode': '24',
    'elk.spacing.edgeEdge': '16', 'elk.layered.mergeEdges': 'true',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX'
  },
  children: [...Object.values(cont), ...roots],
  edges: doc.edges.map((e, i) => ({ id: 'e' + i, sources: [e.from], targets: [e.to] }))
};

const RAMP = {
  purple: ['#EEEDFE', '#534AB7', '#26215C'], teal: ['#E1F5EE', '#0F6E56', '#04342C'],
  coral: ['#FAECE7', '#993C1D', '#4A1B0C'], green: ['#EAF3DE', '#3B6D11', '#173404'],
  gray: ['#F1EFE8', '#5F5E5A', '#2C2C2A']
};
const LAYER_FILL = { base: '#ffffff', business: '#EEEDFE', edge: '#FAECE7', build: '#F1EFE8', future: '#EAF3DE' };
const LAYER_STROKE = { base: '#8a8880', business: '#534AB7', edge: '#993C1D', build: '#888780', future: '#3B6D11' };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

elk.layout(graph).then(g => {
  const abs = {}, edges = [];
  (function walk(n, ox, oy) {
    (n.children || []).forEach(c => {
      abs[c.id] = { x: ox + c.x, y: oy + c.y, w: c.width, h: c.height, isC: !!(c.children || []).length };
      walk(c, ox + c.x, oy + c.y);
    });
    (n.edges || []).forEach(e => {
      (e.sections || []).forEach(s => {
        const pts = [[s.startPoint.x, s.startPoint.y], ...(s.bendPoints || []).map(b => [b.x, b.y]), [s.endPoint.x, s.endPoint.y]]
          .map(q => [q[0], q[1]]);
        edges.push({ id: e.id, from: e.sources[0], to: e.targets[0], pts });
      });
    });
  })(g, 0, 0);

  const svg = [];
  const W = Math.ceil(g.width) + 48, H = Math.ceil(g.height) + 48;

  doc.groups.forEach(gr => {
    const v = abs[gr.id]; if (!v) return;
    const r = RAMP[gr.color] || RAMP.gray;
    svg.push(`<g class="grp" data-group="${gr.id}"><rect class="grect" x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" rx="14" fill="${r[0]}" fill-opacity="0.45" stroke="${r[1]}" stroke-width="0.8" stroke-dasharray="7 5"/><text class="glab" x="${v.x + 14}" y="${v.y + 23}" fill="${r[2]}">${esc(gr.label)}</text></g>`);
  });

  doc.edges.forEach((e, i) => {
    const seg = edges.find(s => s.id === 'e' + i); if (!seg) return;
    const la = layersOf(byId[e.from]).join(' '), lb = layersOf(byId[e.to]).join(' ');
    const d = seg.pts.map(q => q.join(',')).join(' ');
    svg.push(`<g class="edge" data-src="${e.from}" data-tgt="${e.to}" data-sl="${la}" data-tl="${lb}">
<path class="eline" d="M ${d.split(' ').join(' L ')}" data-orig="M ${d.split(' ').join(' L ')}" fill="none" stroke="${e.type === 'dashed' ? '#993C1D' : '#6f6d66'}" stroke-width="1.3" ${e.type === 'dashed' ? 'stroke-dasharray="6 4"' : ''} marker-end="url(#ah)"/>
</g>`);
  });

  doc.nodes.forEach(n => {
    const v = abs[n.id]; if (!v) return;
    const p = primary(n);
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    const brand = n.icon ? ICO.get(n.icon) : null;
    const ring = LAYER_STROKE[p];
    let mark;
    if (brand) {
      mark = `<circle cx="${cx}" cy="${cy}" r="22" fill="${LAYER_FILL[p]}" stroke="${ring}" stroke-width="1.1"/>`
           + `<g transform="translate(${cx - 12},${cy - 12}) scale(1)"><path d="${brand.path}" fill="${brand.hex}" transform="scale(0.5)"/></g>`;
    } else {
      const gk = ICO.glyph[n.kind] || ICO.glyph.service;
      mark = `<circle cx="${cx}" cy="${cy}" r="22" fill="${LAYER_FILL[p]}" stroke="${ring}" stroke-width="1.1" ${n.kind === 'external' ? 'stroke-dasharray="4 3"' : ''}/>`
           + `<g transform="translate(${cx - 11},${cy - 11})"><path d="${gk}" fill="none" stroke="${ring}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" transform="scale(0.92)"/></g>`;
    }
    const isOpen = n.status === 'open';
    svg.push(`<g class="nd${isOpen ? ' open' : ''}" data-id="${n.id}" data-group="${n.parentId || ''}" data-layers="${layersOf(n).join(' ')}"${isOpen ? ` data-prompt="${esc(n.prompt || '')}"` : ''}>${isOpen ? `<title>${esc(n.prompt || 'Unresolved')}</title>` : ''}
${mark}
${isOpen ? `<text x="${cx + 19}" y="${cy - 16}" class="qm" fill="#993C1D">?</text>` : ''}
<text x="${cx}" y="${v.y + v.h + 18}" text-anchor="middle" class="nl">${esc(n.label)}</text>
<text x="${cx}" y="${v.y + v.h + 34}" text-anchor="middle" class="ns">${esc(n.sublabel || '')}</text></g>`);
  });

  const counts = { business: 0, edge: 0, build: 0, base: 0, future: 0 };
  doc.nodes.forEach(n => counts[primary(n)]++);

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(doc.title)}</title>
<style>
:root{--ink:#2c2c2a;--mute:#6b6961;--bg:#fbfaf7;--line:#d9d6cd}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 20px;z-index:10}
h1{margin:0 0 10px;font-size:16px;font-weight:500}
.bar{display:flex;gap:18px;flex-wrap:wrap;align-items:center}
label{display:flex;gap:7px;align-items:center;cursor:pointer;font-size:13px;color:var(--mute)}
label input{accent-color:#534AB7;margin:0}
.sw{width:11px;height:11px;border-radius:3px;border:1px solid}
.hint{margin-left:auto;font-size:12px;color:var(--mute)}
main{overflow:auto;padding:24px}
svg{display:block}
.glab{font-size:13px;font-weight:500}
.nl{font-size:12.5px;font-weight:500;fill:var(--ink)}
.ns{font-size:11px;fill:var(--mute)}
.nd,.edge,.grp{transition:opacity .15s}
.nd{transition:opacity .15s,transform .25s ease}
.eline{transition:d .25s}
.open circle{stroke-dasharray:3 3!important;stroke-width:1.6!important}
.open .nl{font-style:italic}
.open .qm{font-size:17px;font-weight:600}
.grect{transition:x .2s,y .2s,width .2s,height .2s}
.off{display:none}
</style></head><body>
<header><h1>${esc(doc.title)}</h1>
<div class="bar">
<label><input type="checkbox" checked disabled><span class="sw" style="background:#fff;border-color:#8a8880"></span>Technical (${counts.base})</label>
<label><input type="checkbox" data-layer="business" checked><span class="sw" style="background:#EEEDFE;border-color:#534AB7"></span>Business (${counts.business})</label>
<label><input type="checkbox" data-layer="edge" checked><span class="sw" style="background:#FAECE7;border-color:#993C1D"></span>Edge cases (${counts.edge})</label>
<label><input type="checkbox" data-layer="build" checked><span class="sw" style="background:#F1EFE8;border-color:#888780"></span>Build-time (${counts.build})</label>
<label><input type="checkbox" data-layer="future" checked><span class="sw" style="background:#EAF3DE;border-color:#3B6D11"></span>Phase 2 (${counts.future})</label>
<span class="hint">${doc.nodes.filter(n => n.status === 'open').length} open question(s) marked. Hidden layers close up; visible nodes keep their column and order.</span>
</div></header>
<main><svg width="${W}" height="${H}" viewBox="-24 -24 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.4" stroke-linecap="round"/></marker></defs>
${svg.join('\n')}
</svg></main>
<script>
var boxes=[].slice.call(document.querySelectorAll('input[data-layer]'));

var PAD=22, TOPPAD=34, LBLDROP=40, ROWGAP=118, R=22;

function vis(ls){
  return ls.split(' ').some(function(l){
    if(l==='base')return true;
    var b=boxes.filter(function(x){return x.dataset.layer===l;})[0];
    return b?b.checked:true;});
}

function home(n){
  var c=n.querySelector('circle');
  if(!n._hx){ n._hx=parseFloat(c.getAttribute('cx')); n._hy=parseFloat(c.getAttribute('cy')); }
  return {x:n._hx,y:n._hy};
}
function place(n,x,y){
  home(n);
  n.setAttribute('transform','translate('+(x-n._hx)+','+(y-n._hy)+')');
  n._cx=x; n._cy=y;
}

function compact(shownList){
  var cols={};
  shownList.forEach(function(n){
    var h=home(n);
    var key=n.dataset.group+'|'+Math.round(h.x/8);
    (cols[key]=cols[key]||[]).push(n);
  });
  Object.keys(cols).forEach(function(k){
    var list=cols[k].sort(function(a,b){return home(a).y-home(b).y;});
    var top=home(list[0]).y;
    list.forEach(function(n,i){ place(n,home(n).x, top+i*ROWGAP); });
  });
}

function reroute(e,shown){
  var s=shown[e.dataset.src], t=shown[e.dataset.tgt];
  var p=e.querySelector('.eline');
  if(!s||!t)return;
  var sx=s._cx, sy=s._cy, tx=t._cx, ty=t._cy;
  var d;
  if(Math.abs(sx-tx)<2){
    d='M '+sx+' '+(sy+R)+' L '+tx+' '+(ty-R);
  } else {
    var my=(sy+R+ty-R)/2;
    d='M '+sx+' '+(sy+R)+' L '+sx+' '+my+' L '+tx+' '+my+' L '+tx+' '+(ty-R);
  }
  p.setAttribute('d',d);
}

function apply(){
  var shown={}, list=[];
  document.querySelectorAll('.nd').forEach(function(n){
    var on=vis(n.dataset.layers);
    n.classList.toggle('off',!on);
    if(on){shown[n.dataset.id]=n; list.push(n);}
  });

  var doCompact = true;

  if(doCompact){ compact(list); }
  else {
    list.forEach(function(n){ var h=home(n); n.removeAttribute('transform'); n._cx=h.x; n._cy=h.y; });
  }

  document.querySelectorAll('.edge').forEach(function(e){
    var on = !!shown[e.dataset.src] && !!shown[e.dataset.tgt];
    e.classList.toggle('off',!on);
    if(!on)return;
    var p=e.querySelector('.eline');
    if(doCompact) reroute(e,shown);
    else p.setAttribute('d',p.dataset.orig);
  });

  document.querySelectorAll('.grp').forEach(function(g){
    var gid=g.dataset.group;
    var kids=[].slice.call(document.querySelectorAll('.nd[data-group="'+gid+'"]'))
      .filter(function(n){return !n.classList.contains('off');});
    var rect=g.querySelector('.grect'), lbl=g.querySelector('.glab');
    if(!kids.length){ g.classList.add('off'); return; }
    g.classList.remove('off');
    var x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    kids.forEach(function(n){
      var cx=n._cx, cy=n._cy, half=R;
      n.querySelectorAll('text').forEach(function(el){
        half=Math.max(half, el.getComputedTextLength?el.getComputedTextLength()/2:40); });
      x0=Math.min(x0,cx-Math.max(R,half)); x1=Math.max(x1,cx+Math.max(R,half));
      y0=Math.min(y0,cy-R);                y1=Math.max(y1,cy+R+LBLDROP);
    });
    rect.setAttribute('x',x0-PAD); rect.setAttribute('y',y0-TOPPAD);
    rect.setAttribute('width',(x1-x0)+PAD*2); rect.setAttribute('height',(y1-y0)+TOPPAD+PAD);
    lbl.setAttribute('x',x0-PAD+14); lbl.setAttribute('y',y0-TOPPAD+23);
  });
}
boxes.forEach(function(b){b.addEventListener('change',apply);});
window.addEventListener('load',apply);
apply();
</script></body></html>`;
  fs.writeFileSync(out, html);
  console.log('wrote', out, (html.length / 1024).toFixed(0) + 'kb', W + 'x' + H);
}).catch(e => console.error('FAIL', e.message));
