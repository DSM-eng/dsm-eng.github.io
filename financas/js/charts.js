// Gráficos leves em HTML/SVG (sem bibliotecas, funcionam offline).
// Paleta em verdes, validada para daltonismo (ver README).
import { money, moneyShort, niceMax } from './logic.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const empty = (msg = 'Sem lançamentos no período') => `<div class="empty">${msg}</div>`;

/** Barras horizontais ordenadas, com rótulo e valor visíveis */
export function hbars(items, { fmt = money, limit } = {}) {
  if (!items.length) return empty();
  const max = Math.max(...items.map((i) => Math.max(i.value, i.limit || 0)));
  const list = limit ? items.slice(0, limit) : items;
  return `<div class="hbars">${list.map((i) => {
    const pct = Math.max(1.5, (i.value / max) * 100);
    const lim = i.limit ? `<div class="hbar-limit" style="left:${(i.limit / max) * 100}%"></div>` : '';
    return `<div class="hbar" data-tip="${esc(i.label)}: ${esc(fmt(i.value))}${i.tip ? ' · ' + esc(i.tip) : ''}">
      <div class="hbar-top"><span class="hbar-label">${i.icon ? i.icon + ' ' : ''}${esc(i.label)}</span><span class="hbar-val">${fmt(i.value)}${i.share != null ? ` <small>${Math.round(i.share * 100)}%</small>` : ''}</span></div>
      <div class="hbar-track">${lim}<div class="hbar-fill ${i.over ? 'over' : ''}" style="width:${pct}%"></div></div></div>`;
  }).join('')}</div>`;
}

/** Barra de progresso (metas, limite do cartão) */
export function meter(value, max, { over = false } = {}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return `<div class="meter"><div class="meter-fill ${over ? 'over' : ''}" style="width:${pct}%"></div></div>`;
}

const roundTop = (x, y, w, h, r = 4) => {
  if (h <= 0) return '';
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

/** Barras agrupadas: receitas x despesas por mês */
export function groupedBars(rows, names = ['Receitas', 'Despesas']) {
  if (!rows.some((r) => r.a || r.b)) return empty();
  const W = 340; const H = 190; const L = 46; const R = 6; const T = 10; const B = 24;
  const pw = W - L - R; const ph = H - T - B;
  const max = niceMax(Math.max(...rows.flatMap((r) => [r.a, r.b])));
  const y = (v) => T + ph - (v / max) * ph;
  const gw = pw / rows.length; const bw = Math.min(18, (gw - 12) / 2);
  let s = '';
  [0, 0.5, 1].forEach((f) => {
    const yy = y(max * f);
    s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="axis" x="${L - 6}" y="${yy + 4}" text-anchor="end">${moneyShort(max * f)}</text>`;
  });
  rows.forEach((r, i) => {
    const x0 = L + i * gw + (gw - (2 * bw + 2)) / 2;
    s += `<path class="s1" d="${roundTop(x0, y(r.a), bw, T + ph - y(r.a))}"/>`;
    s += `<path class="s2" d="${roundTop(x0 + bw + 2, y(r.b), bw, T + ph - y(r.b))}"/>`;
    s += `<text class="axis" x="${L + i * gw + gw / 2}" y="${H - 6}" text-anchor="middle">${esc(r.label)}</text>`;
    s += `<rect class="hit" x="${L + i * gw}" y="${T}" width="${gw}" height="${ph}" data-tip="${esc(r.full || r.label)} · ${names[0]}: ${money(r.a)} · ${names[1]}: ${money(r.b)} · Resultado: ${money(r.a - r.b)}"/>`;
  });
  return `<div class="legend"><span><i class="sw s1"></i>${names[0]}</span><span><i class="sw s2"></i>${names[1]}</span></div>
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${names[0]} e ${names[1]} por mês">${s}</svg>`;
}

/** Linhas: despesa acumulada no mês x mês anterior */
export function lineCompare(cur, prev, { curName = 'Este mês', prevName = 'Mês anterior' } = {}) {
  const n = Math.max(cur.length, prev.length);
  if (!n || (!cur.some(Boolean) && !prev.some(Boolean))) return empty();
  const W = 340; const H = 180; const L = 46; const R = 10; const T = 10; const B = 22;
  const pw = W - L - R; const ph = H - T - B;
  const max = niceMax(Math.max(...cur, ...prev));
  const x = (i) => L + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v) => T + ph - (v / max) * ph;
  const pts = (arr) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  let s = '';
  [0, 0.5, 1].forEach((f) => {
    const yy = y(max * f);
    s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="axis" x="${L - 6}" y="${yy + 4}" text-anchor="end">${moneyShort(max * f)}</text>`;
  });
  [1, Math.ceil(n / 2), n].forEach((d) => { s += `<text class="axis" x="${x(d - 1)}" y="${H - 5}" text-anchor="middle">dia ${d}</text>`; });
  if (prev.length) s += `<polyline class="l2" points="${pts(prev)}"/>`;
  if (cur.length) {
    s += `<polyline class="l1" points="${pts(cur)}"/>`;
    const li = cur.length - 1;
    s += `<circle class="dot1" cx="${x(li)}" cy="${y(cur[li])}" r="4"/>`;
  }
  s += `<line class="guide" x1="0" x2="0" y1="${T}" y2="${T + ph}" style="display:none"/>`;
  const cw = pw / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const tip = `Dia ${i + 1}` + (i < cur.length ? ` · ${curName}: ${money(cur[i])}` : '') + (i < prev.length ? ` · ${prevName}: ${money(prev[i])}` : '');
    s += `<rect class="hit" x="${x(i) - cw / 2}" y="${T}" width="${cw}" height="${ph}" data-gx="${x(i)}" data-tip="${esc(tip)}"/>`;
  }
  return `<div class="legend"><span><i class="sw s1"></i>${curName}</span><span><i class="sw s2 line"></i>${prevName}</span></div>
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Despesa acumulada">${s}</svg>`;
}
