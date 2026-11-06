// Regras de negócio puras (sem tela): dinheiro, datas, categorização,
// saldos, faturas e agregações para o dashboard e os relatórios.

// ---------------------------------------------------------------- dinheiro
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (v) => BRL.format(Math.round((v || 0) * 100) / 100);

export function moneyShort(v) {
  const a = Math.abs(v || 0);
  if (a >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
  if (a >= 1e3) return 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return 'R$ ' + Math.round(v || 0).toLocaleString('pt-BR');
}

export const plainAmount = (v) => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',');

/** "1.234,56" | "1234.5" | "32,90" | "R$ 45" -> número; NaN se inválido */
export function parseAmount(str) {
  if (str == null) return NaN;
  let s = String(str).replace(/r\$/gi, '').replace(/\s/g, '');
  if (!s) return NaN;
  const dots = (s.match(/\./g) || []).length;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (dots === 1) { const [a, b] = s.split('.'); if (b.length === 3) s = a + b; }
  else if (dots > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/**
 * Frase rápida -> lançamento.
 * "mercado 215" | "215 mercado" | "uber 32,50" | "+5000 salário" | "tv 3000 10x"
 */
export function parseQuick(text) {
  let t = ' ' + (text || '').trim() + ' ';
  let kind = null;
  if (/^\s*\+/.test(t)) { kind = 'receita'; t = t.replace('+', ' '); }
  let installments = null;
  const inst = t.match(/\s(\d{1,2})\s?x(?=\s)/i);
  if (inst && +inst[1] >= 1) { installments = +inst[1]; t = t.replace(inst[0], ' '); }
  const re = /(^|\s)(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?=\s)/gi;
  const all = [...t.matchAll(re)];
  let amount = NaN;
  if (all.length) {
    const m = all[all.length - 1];
    amount = parseAmount(m[2]);
    t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length);
  }
  const description = t.replace(/\s+/g, ' ').trim();
  return { amount, description: description ? description[0].toUpperCase() + description.slice(1) : '', installments, kind };
}

// ---------------------------------------------------------------- datas
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m0, d) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const parts = (s) => s.split('-').map(Number);

export function today() {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(s, n) {
  const [y, m, d] = parts(s);
  const dt = new Date(y, m - 1, d + n);
  return ymd(dt.getFullYear(), dt.getMonth(), dt.getDate());
}
export function addMonths(s, n) {
  const [y, m, d] = parts(s);
  let mm = m - 1 + n;
  const yy = y + Math.floor(mm / 12);
  mm = ((mm % 12) + 12) % 12;
  return ymd(yy, mm, Math.min(d, new Date(yy, mm + 1, 0).getDate()));
}
export const monthOf = (s) => s.slice(0, 7);
export const thisMonth = () => monthOf(today());
export const shiftMonth = (mk, n) => addMonths(mk + '-01', n).slice(0, 7);
export function daysInMonth(mk) { const [y, m] = parts(mk); return new Date(y, m, 0).getDate(); }
export function monthLabel(mk, opts = { month: 'long', year: 'numeric' }) {
  const [y, m] = parts(mk);
  const s = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', opts).replace('.', '');
  return s[0].toUpperCase() + s.slice(1);
}
export function dayLabel(s) {
  const [y, m, d] = parts(s);
  const t = today();
  if (s === t) return 'Hoje';
  if (s === addDays(t, -1)) return 'Ontem';
  const l = new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
  return l[0].toUpperCase() + l.slice(1);
}
export function shortDate(s) { const [, m, d] = parts(s); return `${pad(d)}/${pad(m)}`; }

// ---------------------------------------------------------------- categorização
export const norm = (s) => (s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Dicionário inicial (o app passa a preferir o que aprende com seus lançamentos)
const DICT = {
  'Alimentação': 'ifood rappi mcdonald burger king bk restaurante lanchonete lanche almoco jantar pizza pizzaria padaria cafeteria starbucks outback sushi habibs subway spoleto madero coco bambu acai sorvete hamburgueria',
  'Mercado': 'mercado supermercado carrefour pao de acucar assai atacadao hortifruti sacolao feira oba st marche sams makro quitanda',
  'Transporte': 'uber 99 99pop taxi posto gasolina combustivel etanol shell ipiranga estacionamento pedagio sem parar metro onibus bilhete unico cptm conectcar veloe zona azul',
  'Casa': 'aluguel condominio iptu reforma leroy telhanorte tok stok diarista faxina moveis',
  'Contas': 'enel luz energia sabesp agua comgas gas internet vivo claro tim celular telefone conta de',
  'Saúde': 'farmacia drogaria droga raia drogasil pague menos medico consulta exame dentista plano de saude unimed amil hospital laboratorio academia smartfit psicologo',
  'Educação': 'escola faculdade curso livro livraria mensalidade udemy alura material escolar',
  'Filhos': 'fralda creche brinquedo pediatra berçario bercario',
  'Lazer': 'cinema ingresso show teatro parque museu clube boliche',
  'Viagem': 'hotel airbnb booking latam passagem decolar hospedagem pousada',
  'Roupas': 'renner riachuelo cea zara hering roupa sapato tenis centauro netshoes',
  'Assinaturas': 'netflix spotify disney prime video hbo youtube premium globoplay icloud google one chatgpt deezer apple',
  'Pets': 'petz cobasi racao veterinario petshop',
  'Compras': 'amazon mercado livre shopee magalu magazine americanas aliexpress shein casas bahia',
  'Salário': 'salario holerite pro labore prolabore',
  'Freelance': 'freela freelance consultoria nota fiscal honorarios',
  'Rendimentos': 'dividendos rendimento rendimentos juros jcp resgate',
  'Investimentos': 'aporte investimento previdencia tesouro direto cdb lci lca corretora acoes fii cripto bitcoin poupanca',
  'Reembolso': 'reembolso estorno devolucao',
  'Benefício': 'ticket vr va alelo sodexo pluxee beneficio recarga vale',
};
const DICT_LIST = Object.entries(DICT).flatMap(([cat, words]) => {
  // expressões de mais de uma palavra primeiro (ex.: "pao de acucar", "droga raia")
  const multi = ['pao de acucar', 'burger king', 'droga raia', 'pague menos', 'plano de saude', 'bilhete unico',
    'sem parar', 'zona azul', 'tok stok', 'mercado livre', 'casas bahia', 'prime video', 'youtube premium',
    'google one', 'st marche', 'material escolar', 'conta de', 'coco bambu', 'pro labore', 'nota fiscal', 'tesouro direto'];
  const found = multi.filter((m) => words.includes(m));
  let rest = words;
  found.forEach((m) => { rest = rest.replace(m, ' '); });
  return [...found, ...rest.split(/\s+/).filter(Boolean)].map((w) => ({ cat, w }));
}).sort((a, b) => b.w.length - a.w.length);

function dictMatches(n) {
  const padded = ' ' + n + ' ';
  const out = [];
  for (const { cat, w } of DICT_LIST) {
    if ((w.length < 4 ? padded.includes(' ' + w + ' ') : padded.includes(' ' + w)) && !out.includes(cat)) out.push(cat);
  }
  return out;
}

/** Memória de categorização construída a partir do histórico */
export function buildMemory(txs) {
  const exact = new Map(); const first = new Map(); const descs = new Map();
  const add = (map, k, t) => {
    const e = map.get(k) || { cat: {}, acc: {}, n: 0 };
    if (t.category_id) e.cat[t.category_id] = (e.cat[t.category_id] || 0) + 1;
    e.acc[t.account_id] = (e.acc[t.account_id] || 0) + 1;
    e.n++; map.set(k, e);
  };
  for (const t of txs) {
    if (t.kind === 'transferencia' || !t.description) continue;
    if (t.installment_no && t.installment_no > 1) continue;
    const n = norm(t.description); if (!n) continue;
    add(exact, n, t);
    const f = n.split(' ')[0]; if (f.length >= 3) add(first, f, t);
    const d = descs.get(n) || { text: t.description, n: 0, kind: t.kind };
    d.n++; descs.set(n, d);
  }
  return { exact, first, descs };
}

const top = (obj, allow) => Object.entries(obj || {})
  .filter(([k]) => !allow || allow(k)).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

/** Sugere categoria e conta para uma descrição */
export function suggest(desc, kind, memory, categories) {
  const n = norm(desc);
  if (!n || kind === 'transferencia') return { category_id: null, account_id: null, source: null };
  const ofKind = new Set(categories.filter((c) => c.kind === kind && !c.archived).map((c) => c.id));
  let e = memory.exact.get(n);
  if (!e && n.length >= 3) {
    // autocompletar: maior frequência entre descrições que começam com o texto
    let best = null;
    for (const [k, v] of memory.exact) if (k.startsWith(n) && (!best || v.n > best.n)) best = v;
    e = best;
  }
  if (!e) e = memory.first.get(n.split(' ')[0]);
  const learnedCat = e ? top(e.cat, (id) => ofKind.has(id)) : null;
  const account_id = e ? top(e.acc) : null;
  if (learnedCat) return { category_id: learnedCat, account_id, source: 'aprendido' };
  let cat = null;
  for (const name of dictMatches(n)) {
    cat = categories.find((c) => c.name === name && c.kind === kind && !c.archived);
    if (cat) break;
  }
  return { category_id: cat ? cat.id : null, account_id, source: cat ? 'dicionário' : null };
}

/** Descrições já usadas que começam com o texto digitado */
export function completions(desc, kind, memory, limit = 4) {
  const n = norm(desc);
  if (!n) return [];
  return [...memory.descs.entries()]
    .filter(([k, v]) => k.startsWith(n) && k !== n && v.kind === kind)
    .sort((a, b) => b[1].n - a[1].n).slice(0, limit).map(([, v]) => v.text);
}

// ---------------------------------------------------------------- parcelas
export function splitInstallments(total, n) {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n); const rem = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < rem ? 1 : 0)) / 100);
}

// ---------------------------------------------------------------- saldos e faturas
/** Saldo de cada conta. Cartões contam compras futuras (parcelas consomem limite). */
export function balances(accounts, txs, asOf = today()) {
  const kindOf = Object.fromEntries(accounts.map((a) => [a.id, a.kind]));
  const bal = Object.fromEntries(accounts.map((a) => [a.id, Number(a.opening_balance) || 0]));
  for (const t of txs) {
    const amt = Number(t.amount);
    const counts = (id) => kindOf[id] === 'credito' || t.date <= asOf;
    if (t.kind === 'despesa' && counts(t.account_id)) bal[t.account_id] -= amt;
    else if (t.kind === 'receita' && counts(t.account_id)) bal[t.account_id] += amt;
    else if (t.kind === 'transferencia') {
      if (t.date <= asOf) {
        if (t.account_id in bal) bal[t.account_id] -= amt;
        if (t.to_account_id in bal) bal[t.to_account_id] += amt;
      }
    }
  }
  for (const k in bal) bal[k] = Math.round(bal[k] * 100) / 100;
  return bal;
}

const clampDay = (y, m0, d) => Math.min(d, new Date(y, m0 + 1, 0).getDate());

/** Em qual fatura cai uma compra. key = mês de vencimento (YYYY-MM). */
export function billOf(dateStr, card) {
  const [y, m, d] = parts(dateStr);
  let cy = y; let cm = m - 1;
  if (d >= clampDay(cy, cm, card.closing_day)) { cm++; if (cm > 11) { cm = 0; cy++; } }
  const closing = ymd(cy, cm, clampDay(cy, cm, card.closing_day));
  let dy = cy; let dm = cm;
  if (card.due_day <= card.closing_day) { dm++; if (dm > 11) { dm = 0; dy++; } }
  return { key: `${dy}-${pad(dm + 1)}`, closing, due: ymd(dy, dm, clampDay(dy, dm, card.due_day)) };
}

/** Faturas de um cartão: { key -> {key, closing, due, total} } */
export function cardBills(card, txs) {
  const bills = {};
  for (const t of txs) {
    if (t.account_id !== card.id || t.kind === 'transferencia') continue;
    const b = billOf(t.date, card);
    bills[b.key] = bills[b.key] || { ...b, total: 0 };
    bills[b.key].total += t.kind === 'despesa' ? Number(t.amount) : -Number(t.amount);
  }
  Object.values(bills).forEach((b) => { b.total = Math.round(b.total * 100) / 100; });
  return bills;
}

/** Situação do cartão hoje: fatura aberta, fatura fechada a vencer, limite */
export function cardStatus(card, txs, balance, asOf = today()) {
  const bills = cardBills(card, txs);
  const openInfo = billOf(asOf, card);
  const open = bills[openInfo.key] || { ...openInfo, total: 0 };
  const prevKey = shiftMonth(openInfo.key, -1);
  const prevInfo = bills[prevKey];
  const closed = prevInfo && prevInfo.due >= asOf ? prevInfo : null;
  const paidSinceClose = closed ? txs.filter((t) => t.kind === 'transferencia' && t.to_account_id === card.id
    && t.date >= closed.closing && t.date <= asOf).reduce((s, t) => s + Number(t.amount), 0) : 0;
  const used = Math.max(0, -balance);
  const limit = Number(card.credit_limit) || 0;
  return {
    open, closed, closedPending: closed ? Math.max(0, Math.round((closed.total - paidSinceClose) * 100) / 100) : 0,
    used, limit, available: limit - used,
  };
}

// ---------------------------------------------------------------- investimentos
// Categorias marcadas como investimento e contas do tipo investimento não contam
// como gasto: entram em "Investido no mês".
const INV = { cats: new Set(), accs: new Set() };
export function setInvestment(categories, accounts) {
  INV.cats = new Set(categories.filter((c) => c.is_investment).map((c) => c.id));
  INV.accs = new Set(accounts.filter((a) => a.kind === 'investimento').map((a) => a.id));
}
export const isSpend = (t) => t.kind === 'despesa' && !INV.cats.has(t.category_id);
export function invDelta(t) {
  const amt = Number(t.amount);
  if (t.kind === 'despesa') return INV.cats.has(t.category_id) ? amt : 0;
  if (t.kind === 'transferencia') {
    const to = INV.accs.has(t.to_account_id); const from = INV.accs.has(t.account_id);
    if (to && !from) return amt;
    if (from && !to) return -amt;
  }
  return 0;
}

// ---------------------------------------------------------------- agregações
export const inMonth = (t, mk) => t.date.startsWith(mk);
export const byWho = (who) => (t) => who === 'all' || t.created_by === who;

export function monthSummary(txs, mk) {
  let receitas = 0; let despesas = 0; let investido = 0;
  for (const t of txs) {
    if (!inMonth(t, mk)) continue;
    if (t.kind === 'receita') receitas += Number(t.amount);
    else if (isSpend(t)) despesas += Number(t.amount);
    investido += invDelta(t);
  }
  return { receitas, despesas, investido, resultado: receitas - despesas - investido };
}

export function groupSum(txs, mk, keyFn, kind = 'despesa') {
  const m = new Map();
  for (const t of txs) {
    if (t.kind !== kind || !inMonth(t, mk)) continue;
    if (kind === 'despesa' && !isSpend(t)) continue;
    const k = keyFn(t);
    m.set(k, (m.get(k) || 0) + Number(t.amount));
  }
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

/** Despesa acumulada por dia do mês */
export function cumulative(txs, mk, uptoDay) {
  const n = uptoDay ?? daysInMonth(mk);
  const daily = new Array(n).fill(0);
  for (const t of txs) {
    if (!isSpend(t) || !inMonth(t, mk)) continue;
    const d = +t.date.slice(8, 10);
    if (d <= n) daily[d - 1] += Number(t.amount);
  }
  let acc = 0;
  return daily.map((v) => (acc += v));
}

export function lastMonths(txs, mk, n = 6) {
  return Array.from({ length: n }, (_, i) => {
    const m = shiftMonth(mk, i - n + 1);
    return { month: m, ...monthSummary(txs, m) };
  });
}

/** Frases de leitura rápida do mês */
export function insights(txs, mk, categories, catName) {
  const out = [];
  const t = today();
  if (mk === thisMonth()) {
    const day = +t.slice(8, 10);
    const dim = daysInMonth(mk);
    const spentSoFar = txs.filter((x) => isSpend(x) && inMonth(x, mk) && x.date <= t)
      .reduce((s, x) => s + Number(x.amount), 0);
    if (day >= 5 && spentSoFar > 0) {
      out.push(`No ritmo atual, as despesas do mês devem fechar perto de <b>${money(spentSoFar / day * dim)}</b>.`);
    }
  }
  // categoria que mais variou em relação à média dos 3 meses anteriores
  const cur = new Map(groupSum(txs, mk, (x) => x.category_id).map((r) => [r.key, r.value]));
  const prev = [1, 2, 3].map((i) => new Map(groupSum(txs, shiftMonth(mk, -i), (x) => x.category_id).map((r) => [r.key, r.value])));
  let best = null;
  for (const c of categories.filter((c) => c.kind === 'despesa' && !c.is_investment)) {
    const avg = prev.reduce((s, m) => s + (m.get(c.id) || 0), 0) / 3;
    if (avg < 100) continue;
    const now = cur.get(c.id) || 0;
    const pct = (now - avg) / avg;
    if (!best || Math.abs(pct) > Math.abs(best.pct)) best = { c, pct, now, avg };
  }
  if (best && Math.abs(best.pct) >= 0.1 && mk !== thisMonth()) {
    out.push(`${best.c.icon} ${catName(best.c.id)}: <b>${Math.round(Math.abs(best.pct) * 100)}% ${best.pct < 0 ? 'abaixo' : 'acima'}</b> da média dos 3 meses anteriores.`);
  } else if (best && best.pct > 0.1 && mk === thisMonth()) {
    out.push(`${best.c.icon} ${catName(best.c.id)} já soma <b>${money(best.now)}</b>, acima da média mensal de ${money(best.avg)}.`);
  }
  const over = categories.filter((c) => !c.is_investment && c.monthly_limit && (cur.get(c.id) || 0) > Number(c.monthly_limit));
  if (over.length) out.push(`⚠ Acima do limite: ${over.map((c) => `${c.icon} ${c.name}`).join(', ')}.`);
  return out;
}

export function niceMax(v) {
  if (!(v > 0)) return 1;
  const e = 10 ** Math.floor(Math.log10(v)); const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}
