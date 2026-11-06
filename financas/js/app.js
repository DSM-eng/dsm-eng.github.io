// Aurora Finanças - interface
import { CONFIG } from '../config.js';
import { createBackend, uuid } from './db.js';
import * as L from './logic.js';
import { esc, hbars, meter, groupedBars, lineCompare } from './charts.js';
import { DEFAULT_CATEGORIES, DEFAULT_ACCOUNTS, ACCOUNT_KINDS, ICON_GROUPS, demoSeed } from './defaults.js';
import * as R from './receipt.js';

const S = {
  db: null, userId: null, household: null, members: [],
  accounts: [], categories: [], txs: [], memory: L.buildMemory([]),
  view: 'home', month: L.thisMonth(), who: 'all',
  filters: { q: '', kind: '', acc: '', cat: '' },
};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const root = $('#app');

// ----------------------------------------------------------------- utilidades
const acc = (id) => S.accounts.find((a) => a.id === id);
const cat = (id) => S.categories.find((c) => c.id === id);
const catName = (id) => cat(id)?.name || 'Sem categoria';
const memberName = (uid) => S.members.find((m) => m.user_id === uid)?.display_name || '';
const me = () => S.members.find((m) => m.user_id === S.userId);
const firstName = (s) => (s || '').split(' ')[0];
const sortTx = (a, b) => (b.date.localeCompare(a.date)) || String(b.created_at).localeCompare(String(a.created_at));
const activeAccounts = () => S.accounts.filter((a) => !a.archived).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
const activeCats = (kind) => S.categories.filter((c) => !c.archived && (!kind || c.kind === kind)).sort((a, b) => a.sort - b.sort);
const visibleTx = () => S.txs.filter(L.byWho(S.who));

function usageRank(field) {
  const since = L.addDays(L.today(), -120); const n = {};
  for (const t of S.txs) if (t.date >= since && t[field]) n[t[field]] = (n[t[field]] || 0) + 1;
  return n;
}

/** Conta mais usada para uma categoria (ex.: Mercado -> Ticket Alimentação) */
function accountForCategory(catId) {
  const since = L.addDays(L.today(), -120); const n = {};
  for (const t of S.txs) if (t.category_id === catId && t.date >= since && acc(t.account_id) && !acc(t.account_id).archived) n[t.account_id] = (n[t.account_id] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function toast(msg, action) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${msg}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  if (action) el.querySelector('button').onclick = () => { close(); action.run(); };
  setTimeout(close, action ? 5000 : 2800);
}

async function guard(fn) {
  try { return await fn(); } catch (e) { console.error(e); toast('⚠ ' + esc(e.message || 'Algo deu errado')); return undefined; }
}

// ----------------------------------------------------------------- dados
async function loadAll() {
  const [accounts, categories, txs] = await Promise.all(['accounts', 'categories', 'transactions'].map((t) => S.db.list(t)));
  Object.assign(S, { accounts, categories, txs: txs.sort(sortTx) });
  L.setInvestment(categories, accounts);
  S.memory = L.buildMemory(S.txs);
  if (S.db.mode === 'cloud') S.db.saveCache({ accounts, categories, txs, household: S.household, members: S.members });
}

let reloadTimer;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => { await guard(loadAll); render(); }, 400);
}

// ----------------------------------------------------------------- inicialização
async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  try {
    S.db = await createBackend(CONFIG, demoSeed, R.demoReceipt);
  } catch (e) {
    root.innerHTML = `<div class="center"><h2>Sem conexão</h2><p class="muted">Não foi possível carregar o Supabase. Verifique a internet e tente de novo.</p><button class="btn" onclick="location.reload()">Tentar de novo</button></div>`;
    return;
  }
  if (S.db.mode === 'cloud') {
    const ses = await S.db.session();
    if (!ses) return renderAuth();
    S.userId = S.db.uid;
  }
  await enterHousehold();
}

async function enterHousehold() {
  let h;
  try { h = await S.db.household(); } catch (e) {
    const cache = S.db.loadCache?.();
    if (cache) {
      Object.assign(S, { accounts: cache.accounts, categories: cache.categories, txs: cache.txs, household: cache.household, members: cache.members, userId: S.db.uid });
      S.memory = L.buildMemory(S.txs);
      L.setInvestment(S.categories, S.accounts);
      renderShell(); toast('Sem conexão: mostrando os últimos dados salvos');
      return;
    }
    throw e;
  }
  if (!h) return renderHouseholdSetup();
  Object.assign(S, { household: h.household, members: h.members, userId: h.userId });
  await guard(loadAll);
  renderShell();
  if (new URLSearchParams(location.search).has('novo')) openQuick();
  S.db.subscribe(scheduleReload);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleReload(); });
}

// ----------------------------------------------------------------- login (nuvem)
function renderAuth(mode = 'login') {
  root.innerHTML = `<div class="auth">
    <div class="brand"><img src="icons/icon-192.png" alt=""><h1>Aurora</h1><p>Finanças da família, lançadas em segundos.</p></div>
    <form class="card form" id="authForm">
      <div class="seg">${['login', 'signup'].map((m) => `<button type="button" data-auth="${m}" class="${m === mode ? 'on' : ''}">${m === 'login' ? 'Entrar' : 'Criar conta'}</button>`).join('')}</div>
      <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
      <label>Senha<input name="password" type="password" minlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required></label>
      <button class="btn primary" type="submit">${mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
      ${mode === 'login' ? '<button type="button" class="link" id="forgot">Esqueci a senha</button>' : ''}
      <p class="msg" id="authMsg"></p>
    </form></div>`;
  $$('[data-auth]').forEach((b) => { b.onclick = () => renderAuth(b.dataset.auth); });
  $('#forgot')?.addEventListener('click', async () => {
    const email = $('#authForm').email.value.trim();
    if (!email) { $('#authMsg').textContent = 'Digite seu e-mail acima.'; return; }
    await guard(async () => { await S.db.resetPassword(email); $('#authMsg').textContent = 'Enviamos um link de redefinição para o seu e-mail.'; });
  });
  $('#authForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target; const msg = $('#authMsg');
    const email = f.email.value.trim(); const password = f.password.value;
    f.querySelector('.primary').disabled = true;
    try {
      if (mode === 'login') await S.db.signIn(email, password);
      else {
        const r = await S.db.signUp(email, password);
        if (!r.session) { msg.textContent = 'Conta criada. Abra o link que enviamos para o seu e-mail e depois entre aqui.'; f.querySelector('.primary').disabled = false; return; }
      }
      await S.db.session(); S.userId = S.db.uid;
      await enterHousehold();
    } catch (e) { msg.textContent = e.message; f.querySelector('.primary').disabled = false; }
  };
}

function renderHouseholdSetup() {
  root.innerHTML = `<div class="auth">
    <div class="brand"><h1>Bem-vindo(a)</h1><p>O controle é compartilhado por família. Crie a sua ou entre na de quem já criou.</p></div>
    <form class="card form" id="createForm">
      <h3>Criar uma família</h3>
      <label>Seu nome<input name="me" required placeholder="Ex.: Welber"></label>
      <label>Nome da família<input name="name" placeholder="Ex.: Família Souza"></label>
      <button class="btn primary">Criar</button>
    </form>
    <form class="card form" id="joinForm">
      <h3>Entrar com código de convite</h3>
      <label>Seu nome<input name="me" required placeholder="Ex.: Danielle"></label>
      <label>Código<input name="code" required maxlength="6" autocapitalize="characters" placeholder="Ex.: 7F3A9C"></label>
      <button class="btn">Entrar na família</button>
    </form>
    <button class="link" id="logout">Sair</button></div>`;
  $('#logout').onclick = async () => { await S.db.signOut(); location.reload(); };
  $('#createForm').onsubmit = (ev) => {
    ev.preventDefault();
    guard(async () => {
      const f = ev.target;
      await S.db.createHousehold(f.name.value, f.me.value);
      await S.db.household();
      await S.db.insert('categories', DEFAULT_CATEGORIES);
      await S.db.insert('accounts', DEFAULT_ACCOUNTS);
      await enterHousehold();
      toast('Família criada! Cadastre seus cartões e tickets em Ajustes.');
    });
  };
  $('#joinForm').onsubmit = (ev) => {
    ev.preventDefault();
    guard(async () => { const f = ev.target; await S.db.joinHousehold(f.code.value, f.me.value); await enterHousehold(); });
  };
}

// ----------------------------------------------------------------- casca
const NAV = [['home', '🏠', 'Início'], ['txs', '📋', 'Lançamentos'], ['add', '+', ''], ['reports', '📊', 'Relatórios'], ['settings', '⚙️', 'Ajustes']];

function renderShell() {
  root.innerHTML = `${S.db.mode === 'local' ? '<div class="demo-bar">Modo demonstração: dados fictícios, salvos só neste navegador</div>' : ''}
    <main id="view"></main>
    <nav class="tabbar">${NAV.map(([v, ic, lb]) => v === 'add'
    ? '<button class="fab" data-act="add" aria-label="Novo lançamento">+</button>'
    : `<button data-nav="${v}"><span class="ic">${ic}</span><span>${lb}</span></button>`).join('')}</nav>
    <div id="tip" class="tip" hidden></div>`;
  render();
}

function render() {
  const v = $('#view'); if (!v) return;
  $$('[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === S.view));
  v.innerHTML = ({ home: viewHome, txs: viewTxs, reports: viewReports, settings: viewSettings })[S.view]();
  if (S.view === 'txs') bindTxFilters();
}

const monthNav = () => `<div class="monthnav"><button data-act="month" data-d="-1" aria-label="Mês anterior">‹</button>
  <strong>${L.monthLabel(S.month)}</strong><button data-act="month" data-d="1" aria-label="Próximo mês">›</button></div>`;

const whoChips = () => (S.members.length < 2 ? '' : `<div class="chips who">${[['all', 'Família'], ...S.members.map((m) => [m.user_id, firstName(m.display_name)])]
  .map(([id, lb]) => `<button class="chip ${S.who === id ? 'on' : ''}" data-act="who" data-id="${id}">${esc(lb)}</button>`).join('')}</div>`);

function txRow(t) {
  const c = cat(t.category_id); const a = acc(t.account_id);
  const icon = t.kind === 'transferencia' ? '↔️' : (c?.icon || '🏷️');
  const sub = t.kind === 'transferencia'
    ? `${esc(a?.name || '?')} → ${esc(acc(t.to_account_id)?.name || '?')}`
    : [esc(c?.name || 'Sem categoria'), esc(a?.name || '')].filter(Boolean).join(' · ');
  const extra = [t.receipt ? '🧾' : '', t.installment_total ? `${t.installment_no}/${t.installment_total}` : '', S.members.length > 1 ? esc(firstName(memberName(t.created_by))) : ''].filter(Boolean).join(' · ');
  const sign = t.kind === 'receita' ? '+' : t.kind === 'despesa' ? '−' : '';
  return `<button class="tx" data-act="edit" data-id="${t.id}">
    <span class="tx-ic">${icon}</span>
    <span class="tx-main"><span class="tx-desc">${esc(t.description || catName(t.category_id))}</span><span class="tx-sub">${sub}${extra ? ' · ' + extra : ''}</span></span>
    <span class="tx-amt ${t.kind}">${sign} ${L.money(t.amount)}</span></button>`;
}

// ----------------------------------------------------------------- Início
function viewHome() {
  const txs = visibleTx();
  const sum = L.monthSummary(txs, S.month);
  const bal = L.balances(S.accounts, S.txs);
  const liquid = activeAccounts().filter((a) => ['corrente', 'dinheiro', 'investimento'].includes(a.kind));
  const total = liquid.reduce((s, a) => s + bal[a.id], 0);
  const cards = activeAccounts().filter((a) => a.kind === 'credito');
  const bens = activeAccounts().filter((a) => a.kind === 'beneficio');
  const catTotals = L.groupSum(txs, S.month, (t) => t.category_id);
  const budgets = activeCats('despesa').filter((c) => Number(c.monthly_limit) > 0 && !c.is_investment);
  const goals = activeCats('despesa').filter((c) => Number(c.monthly_limit) > 0 && c.is_investment);
  const spentBy = new Map(catTotals.map((r) => [r.key, r.value]));
  const invBy = new Map();
  txs.forEach((t) => { if (L.inMonth(t, S.month) && t.kind === 'despesa' && cat(t.category_id)?.is_investment) invBy.set(t.category_id, (invBy.get(t.category_id) || 0) + Number(t.amount)); });
  const ins = L.insights(txs, S.month, S.categories, catName);
  const recent = txs.filter((t) => t.date <= L.today()).slice(0, 6);
  const hello = S.db.mode === 'local' ? 'Olá' : `Olá, ${esc(firstName(me()?.display_name))}`;
  const allSpent = catTotals.reduce((s, r) => s + r.value, 0);

  return `<header class="top"><div><h1>${hello} 👋</h1><p class="muted">${esc(S.household?.name || '')}</p></div></header>
  ${whoChips()}
  <section class="card hero">
    <span class="label">Saldo em contas</span>
    <div class="big">${L.money(total)}</div>
    <span class="muted small">${liquid.map((a) => esc(a.name)).join(' · ') || 'Cadastre suas contas em Ajustes'}</span>
  </section>
  ${monthNav()}
  <section class="tiles">
    <div class="tile"><span class="label">Receitas</span><b class="inc">+ ${L.money(sum.receitas)}</b></div>
    <div class="tile"><span class="label">Despesas</span><b>− ${L.money(sum.despesas)}</b></div>
    <div class="tile"><span class="label">📈 Investido</span><b>${sum.investido < 0 ? '−' : ''} ${L.money(Math.abs(sum.investido))}</b></div>
    <div class="tile"><span class="label">Sobra do mês</span><b class="${sum.resultado >= 0 ? 'inc' : ''}">${sum.resultado >= 0 ? '+' : '−'} ${L.money(Math.abs(sum.resultado))}</b></div>
    ${sum.receitas > 0 ? `<div class="tile wide slim"><span class="muted small">${sum.investido + sum.resultado >= 0 ? `Guardou <b>${Math.round(((sum.investido + sum.resultado) / sum.receitas) * 100)}%</b> da receita (investido + sobra)` : 'Gastos acima da receita neste mês'}</span></div>` : ''}
  </section>
  ${ins.length ? `<section class="card insight"><h3>✨ Leitura do mês</h3>${ins.map((i) => `<p>${i}</p>`).join('')}</section>` : ''}
  ${cards.length ? `<section class="card"><h3>Cartões de crédito</h3>${cards.map((c) => {
    const st = L.cardStatus(c, S.txs, bal[c.id]);
    return `<div class="cardrow">
      <div class="row-top"><span>${c.icon} <b>${esc(c.name)}</b></span><span class="muted small">fecha dia ${c.closing_day} · vence dia ${c.due_day}</span></div>
      <div class="row-top"><span class="small">Fatura aberta (vence ${L.shortDate(st.open.due)})</span><b>${L.money(st.open.total)}</b></div>
      ${st.closedPending > 0 ? `<div class="row-top"><span class="small">Fatura fechada (vence ${L.shortDate(st.closed.due)})</span><b>${L.money(st.closedPending)}</b></div>` : ''}
      ${st.limit ? `${meter(st.used, st.limit, { over: st.available < 0 })}<div class="muted small">${L.money(st.available)} disponível de ${L.money(st.limit)}</div>` : ''}
      <button class="btn small" data-act="paybill" data-id="${c.id}">Pagar fatura</button></div>`;
  }).join('')}</section>` : ''}
  ${bens.length ? `<section class="card"><h3>Benefícios</h3>${bens.map((b) => `<div class="line"><span>${b.icon} ${esc(b.name)}</span><b>${L.money(bal[b.id])}</b></div>`).join('')}</section>` : ''}
  ${budgets.length ? `<section class="card"><h3>Limites por categoria</h3>${budgets.map((c) => {
    const sp = spentBy.get(c.id) || 0; const lim = Number(c.monthly_limit); const over = sp > lim;
    return `<div class="budget"><div class="row-top"><span>${c.icon} ${esc(c.name)}</span><span class="small">${over ? '⚠ ' : ''}${L.money(sp)} de ${L.money(lim)}</span></div>
      ${meter(sp, lim, { over })}<div class="muted small">${over ? `${L.money(sp - lim)} acima do limite` : `restam ${L.money(lim - sp)}`}</div></div>`;
  }).join('')}</section>` : ''}
  ${goals.length ? `<section class="card"><h3>Metas de investimento</h3>${goals.map((c) => {
    const v = invBy.get(c.id) || 0; const goal = Number(c.monthly_limit); const done = v >= goal;
    return `<div class="budget"><div class="row-top"><span>${c.icon} ${esc(c.name)}</span><span class="small">${done ? '✓ ' : ''}${L.money(v)} de ${L.money(goal)}</span></div>
      ${meter(v, goal)}<div class="muted small">${done ? 'Meta do mês atingida' : `faltam ${L.money(goal - v)}`}</div></div>`;
  }).join('')}<p class="muted small">Aportes em contas do tipo investimento entram no total "Investido", não nesta meta.</p></section>` : ''}
  <section class="card"><div class="row-top"><h3>Onde foi o dinheiro</h3><button class="link" data-nav="reports">Relatórios ›</button></div>
    ${hbars(catTotals.map((r) => ({ label: catName(r.key), icon: cat(r.key)?.icon, value: r.value, share: allSpent ? r.value / allSpent : null })), { limit: 5 })}</section>
  <section class="card"><div class="row-top"><h3>Últimos lançamentos</h3><button class="link" data-nav="txs">Ver todos ›</button></div>
    ${recent.length ? recent.map(txRow).join('') : '<div class="empty">Nenhum lançamento ainda. Toque no + para começar.</div>'}</section>
  <div class="spacer"></div>`;
}

// ----------------------------------------------------------------- Lançamentos
function filteredTxs() {
  const f = S.filters; const q = L.norm(f.q);
  return visibleTx().filter((t) => L.inMonth(t, S.month)
    && (!f.kind || t.kind === f.kind)
    && (!f.acc || t.account_id === f.acc || t.to_account_id === f.acc)
    && (!f.cat || t.category_id === f.cat)
    && (!q || L.norm(`${t.description} ${catName(t.category_id)} ${acc(t.account_id)?.name} ${t.notes || ''}`).includes(q)));
}

function txListHtml() {
  const list = filteredTxs();
  if (!list.length) return '<div class="empty">Nenhum lançamento encontrado.</div>';
  const s = L.monthSummary(list, S.month);
  const groups = new Map();
  list.forEach((t) => { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); });
  return `<div class="totals"><span>${list.length} lançamentos</span><span class="inc">+ ${L.money(s.receitas)}</span><span>− ${L.money(s.despesas)}</span>${s.investido ? `<span>📈 ${L.moneyShort(s.investido)}</span>` : ''}</div>
  ${[...groups.entries()].map(([d, ts]) => {
    const net = ts.reduce((a, t) => a + (t.kind === 'receita' ? +t.amount : t.kind === 'despesa' ? -t.amount : 0), 0);
    return `<div class="day"><div class="day-h"><span>${L.dayLabel(d)}${d > L.today() ? ' · futuro' : ''}</span><span>${net ? (net > 0 ? '+ ' : '− ') + L.money(Math.abs(net)) : ''}</span></div>${ts.map(txRow).join('')}</div>`;
  }).join('')}`;
}

function viewTxs() {
  const f = S.filters;
  const opt = (v, lb, sel) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${esc(lb)}</option>`;
  return `<header class="top"><h1>Lançamentos</h1></header>
  ${whoChips()}${monthNav()}
  <div class="filters">
    <input id="q" type="search" placeholder="Buscar" value="${esc(f.q)}">
    <div class="selects">
      <select id="fKind">${opt('', 'Tipo: todos', f.kind)}${opt('despesa', 'Despesas', f.kind)}${opt('receita', 'Receitas', f.kind)}${opt('transferencia', 'Transferências', f.kind)}</select>
      <select id="fAcc">${opt('', 'Conta: todas', f.acc)}${activeAccounts().map((a) => opt(a.id, a.name, f.acc)).join('')}</select>
      <select id="fCat">${opt('', 'Categoria: todas', f.cat)}${activeCats().map((c) => opt(c.id, `${c.icon} ${c.name}`, f.cat)).join('')}</select>
    </div>
  </div>
  <section class="card list" id="txlist">${txListHtml()}</section><div class="spacer"></div>`;
}

function bindTxFilters() {
  const upd = () => { $('#txlist').innerHTML = txListHtml(); };
  $('#q').oninput = (e) => { S.filters.q = e.target.value; upd(); };
  $('#fKind').onchange = (e) => { S.filters.kind = e.target.value; upd(); };
  $('#fAcc').onchange = (e) => { S.filters.acc = e.target.value; upd(); };
  $('#fCat').onchange = (e) => { S.filters.cat = e.target.value; upd(); };
}

// ----------------------------------------------------------------- Relatórios
function viewReports() {
  const txs = visibleTx(); const mk = S.month;
  const sum = L.monthSummary(txs, mk);
  const byCat = L.groupSum(txs, mk, (t) => t.category_id);
  const total = byCat.reduce((s, r) => s + r.value, 0);
  const months = L.lastMonths(txs, mk, 6);
  const isCur = mk === L.thisMonth();
  const day = isCur ? +L.today().slice(8, 10) : L.daysInMonth(mk);
  const cur = L.cumulative(txs, mk, day);
  const prev = L.cumulative(txs, L.shiftMonth(mk, -1));
  const byAcc = L.groupSum(txs, mk, (t) => t.account_id);
  const byWhoRows = L.groupSum(S.txs, mk, (t) => t.created_by);
  const merchants = new Map();
  txs.forEach((t) => {
    if (t.kind !== 'despesa' || !L.inMonth(t, mk)) return;
    const k = L.norm(t.description) || '—';
    const e = merchants.get(k) || { label: t.description || '—', value: 0, n: 0 };
    e.value += +t.amount; e.n++; merchants.set(k, e);
  });
  const topMerch = [...merchants.values()].sort((a, b) => b.value - a.value).slice(0, 8);
  const incByCat = L.groupSum(txs, mk, (t) => t.category_id, 'receita');

  return `<header class="top"><h1>Relatórios</h1></header>
  ${whoChips()}${monthNav()}
  <section class="tiles">
    <div class="tile"><span class="label">Receitas</span><b class="inc">+ ${L.money(sum.receitas)}</b></div>
    <div class="tile"><span class="label">Despesas</span><b>− ${L.money(sum.despesas)}</b></div>
    <div class="tile"><span class="label">📈 Investido</span><b>${L.money(sum.investido)}</b></div>
    <div class="tile"><span class="label">Sobra</span><b class="${sum.resultado >= 0 ? 'inc' : ''}">${sum.resultado < 0 ? '−' : ''} ${L.money(Math.abs(sum.resultado))}</b></div>
  </section>
  <section class="card"><h3>Gastos por categoria</h3><p class="muted small">Investimentos ficam fora: não são gasto.</p>
    ${hbars(byCat.map((r) => {
    const c = cat(r.key); const lim = Number(c?.monthly_limit) || 0;
    return { label: catName(r.key), icon: c?.icon, value: r.value, share: total ? r.value / total : null, limit: lim || null, over: lim && r.value > lim, tip: lim ? `limite ${L.money(lim)}` : '' };
  }))}</section>
  <section class="card"><h3>Receitas × despesas, últimos 6 meses</h3>
    ${groupedBars(months.map((m) => ({ label: L.monthLabel(m.month, { month: 'short' }), full: L.monthLabel(m.month), a: m.receitas, b: m.despesas })))}
    <table class="mini"><thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Investido</th><th>Sobra</th></tr></thead><tbody>
    ${months.map((m) => `<tr><td>${L.monthLabel(m.month, { month: 'short', year: '2-digit' })}</td><td>${L.moneyShort(m.receitas)}</td><td>${L.moneyShort(m.despesas)}</td><td>${L.moneyShort(m.investido)}</td><td>${m.resultado < 0 ? '−' : ''}${L.moneyShort(Math.abs(m.resultado))}</td></tr>`).join('')}
    </tbody></table></section>
  <section class="card"><h3>Despesa acumulada no mês</h3>
    ${lineCompare(cur, prev, { curName: L.monthLabel(mk, { month: 'long' }), prevName: L.monthLabel(L.shiftMonth(mk, -1), { month: 'long' }) })}
    <p class="muted small">Até o dia ${day}: ${L.money(cur[cur.length - 1] || 0)} neste mês contra ${L.money(prev[Math.min(day, prev.length) - 1] || 0)} no mesmo dia do mês anterior.</p></section>
  <section class="card"><h3>Gastos por forma de pagamento</h3>
    ${hbars(byAcc.map((r) => ({ label: acc(r.key)?.name || '?', icon: acc(r.key)?.icon, value: r.value })))}</section>
  ${S.members.length > 1 ? `<section class="card"><h3>Gastos por pessoa</h3><p class="muted small">Quem lançou a despesa. Mostra a família toda, independente do filtro.</p>
    ${hbars(byWhoRows.map((r) => ({ label: memberName(r.key) || 'Outro', value: r.value })))}</section>` : ''}
  <section class="card"><h3>Onde mais gastou</h3>
    ${hbars(topMerch.map((m) => ({ label: m.label, value: m.value, tip: `${m.n}×` })))}</section>
  <section class="card"><h3>Receitas por origem</h3>
    ${hbars(incByCat.map((r) => ({ label: catName(r.key), icon: cat(r.key)?.icon, value: r.value })))}</section>
  <div class="spacer"></div>`;
}

// ----------------------------------------------------------------- Ajustes
function viewSettings() {
  const local = S.db.mode === 'local';
  const bal = L.balances(S.accounts, S.txs);
  const accs = [...S.accounts].sort((a, b) => a.archived - b.archived || a.sort - b.sort);
  return `<header class="top"><h1>Ajustes</h1></header>
  <section class="card"><h3>Família</h3>
    <div class="line"><span>Nome</span><button class="link" data-act="renameHousehold">${esc(S.household?.name)} ✎</button></div>
    <div class="line"><span>Seu nome</span><button class="link" data-act="renameMe">${esc(me()?.display_name)} ✎</button></div>
    <div class="line"><span>Membros</span><span>${S.members.map((m) => esc(m.display_name)).join(', ')}</span></div>
    ${local ? `<div class="line"><span>Lançar como</span><span class="chips">${S.members.map((m) => `<button class="chip ${m.user_id === S.userId ? 'on' : ''}" data-act="switchUser" data-id="${m.user_id}">${esc(m.display_name)}</button>`).join('')}</span></div>`
    : `<div class="invite"><span class="muted small">Código de convite para quem vai compartilhar:</span><b class="code">${esc(S.household?.invite_code)}</b><button class="btn small" data-act="copyCode">Copiar</button></div>`}
  </section>
  <section class="card"><div class="row-top"><h3>Contas e cartões</h3><button class="btn small" data-act="editAccount">+ Nova</button></div>
    ${accs.map((a) => `<button class="tx" data-act="editAccount" data-id="${a.id}"><span class="tx-ic">${a.icon}</span>
      <span class="tx-main"><span class="tx-desc">${esc(a.name)}${a.archived ? ' (arquivada)' : ''}</span><span class="tx-sub">${ACCOUNT_KINDS[a.kind].label}${a.owner_id ? ' · ' + esc(firstName(memberName(a.owner_id))) : ' · conjunta'}${a.kind === 'credito' ? ` · limite ${L.money(a.credit_limit)}` : ''}</span></span>
      <span class="tx-amt">${a.kind === 'credito' ? `usado ${L.money(Math.max(0, -bal[a.id]))}` : L.money(bal[a.id])}</span></button>`).join('')}
  </section>
  <section class="card"><div class="row-top"><h3>Categorias</h3><button class="btn small" data-act="editCategory">+ Nova</button></div>
    <p class="muted small">Crie categorias com o ícone que quiser e defina um limite mensal para acompanhar no Início. Categorias marcadas como investimento não contam como gasto.</p>
    ${['despesa', 'receita'].map((k) => `<h4>${k === 'despesa' ? 'Despesas' : 'Receitas'}</h4><div class="catgrid">${S.categories.filter((c) => c.kind === k).sort((a, b) => a.archived - b.archived || a.sort - b.sort).map((c) => `<button class="catbtn ${c.archived ? 'arch' : ''}" data-act="editCategory" data-id="${c.id}"><span>${c.icon}</span>${esc(c.name)}${c.is_investment ? '<small>investimento</small>' : ''}${c.monthly_limit ? `<small>${c.is_investment ? 'meta ' : ''}${L.moneyShort(c.monthly_limit)}</small>` : ''}</button>`).join('')}</div>`).join('')}
  </section>
  <section class="card"><h3>Cupom fiscal</h3>
    <p class="muted small">Depois de ler a foto do cupom:</p>
    <div class="chips">${[['1', 'Lançar direto'], ['0', 'Conferir antes de lançar']].map(([v, lb]) => `<button class="chip ${(autoLaunch() ? '1' : '0') === v ? 'on' : ''}" data-act="autoCupom" data-v="${v}">${lb}</button>`).join('')}</div>
    <p class="muted small">Mesmo em "Lançar direto", o app pede para conferir quando algo não bate (total diferente da soma dos itens, data estranha, categoria ou conta indefinida). Dica: coloque o final do cartão no nome da conta (ex.: "Nubank 1234") para o app reconhecer o cartão no comprovante.</p>
  </section>
  <section class="card"><h3>Dados</h3>
    <button class="btn" data-act="exportCsv">Exportar lançamentos (CSV)</button>
    <button class="btn" data-act="exportJson">Backup completo (JSON)</button>
    ${local ? '<button class="btn" data-act="resetDemo">Recomeçar demonstração</button>' : '<button class="btn" data-act="logout">Sair da conta</button>'}
  </section>
  <section class="card about"><p class="muted small">Dica: no celular, use "Adicionar à tela de início" no menu do navegador para instalar o Aurora como app.</p>
  <p class="muted small">Frase rápida: digite <b>mercado 215</b>, <b>+5000 salário</b> ou <b>tv 3000 10x</b> no lançamento.</p></section>
  <div class="spacer"></div>`;
}

// ----------------------------------------------------------------- folhas (modais)
function openSheet(html, onMount) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) closeSheet(); });
  requestAnimationFrame(() => wrap.classList.add('show'));
  onMount?.(wrap.querySelector('.sheet'));
}
/** Diálogo de confirmação dentro do app (o confirm nativo é bloqueado em alguns contextos) */
function ask(message, options) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'ask-wrap';
    el.innerHTML = `<div class="ask"><p>${esc(message)}</p>${options.map((o, i) => `<button class="btn ${o.primary ? 'primary' : ''}" data-i="${i}">${esc(o.label)}</button>`).join('')}</div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b && e.target !== el) return;
      el.remove();
      resolve(b ? options[+b.dataset.i].value : null);
    });
  });
}
const confirmAsk = (msg, label = 'Excluir') => ask(msg, [{ label, value: true, primary: true }, { label: 'Cancelar', value: false }]);

function closeSheet() { $$('.sheet-wrap').forEach((w) => w.remove()); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// ----------------------------------------------------------------- lançamento rápido
let Q = null;

function openQuick(preset = {}) {
  const editing = preset.id ? S.txs.find((t) => t.id === preset.id) : null;
  const accRank = usageRank('account_id');
  const defAcc = activeAccounts().filter((a) => a.kind !== 'credito' || true).sort((a, b) => (accRank[b.id] || 0) - (accRank[a.id] || 0))[0]?.id || null;
  Q = editing ? {
    id: editing.id, kind: editing.kind, amount: +editing.amount, description: editing.description,
    text: `${editing.description} ${L.plainAmount(editing.amount)}`.trim(), category_id: editing.category_id,
    account_id: editing.account_id, to_account_id: editing.to_account_id, date: editing.date,
    installments: 1, notes: editing.notes || '', catTouched: true, accTouched: true, group: editing.installment_group,
    instLabel: editing.installment_total ? `Parcela ${editing.installment_no} de ${editing.installment_total}` : '', source: null,
    receipt: editing.receipt || null, receipt_key: editing.receipt_key || null, avisos: [],
  } : {
    id: null, kind: 'despesa', amount: NaN, description: '', text: '', category_id: null,
    account_id: defAcc, to_account_id: null, date: L.today(), installments: 1, notes: '',
    catTouched: false, accTouched: false, group: null, instLabel: '', source: null,
    receipt: null, receipt_key: null, avisos: [], ...preset,
  };
  if (preset.text) applyText(preset.text);
  openSheet(`
    <div class="sheet-h"><div class="seg" id="qKind">${[['despesa', 'Despesa'], ['receita', 'Receita'], ['transferencia', 'Transferência']].map(([k, lb]) => `<button type="button" data-k="${k}" ${editing && k !== Q.kind ? 'disabled' : ''}>${lb}</button>`).join('')}</div>
      <button class="x" data-close aria-label="Fechar">✕</button></div>
    <div class="quick-row"><input id="qText" class="quick" autocomplete="off" enterkeyhint="done" value="${esc(Q.text)}">
      ${editing ? '' : '<button type="button" class="cam" data-scan="camera" aria-label="Fotografar cupom fiscal">📷</button>'}</div>
    ${editing ? '' : '<div class="scan-hint" id="qScanHint">📷 Fotografe o cupom fiscal e o app preenche tudo · <button type="button" class="link" data-scan="gallery">escolher da galeria</button></div>'}
    <div id="qComp" class="chips comp"></div>
    <div id="qBody"></div>
    <div class="sheet-f">
      ${editing ? '<button class="btn ghost" id="qDel">Excluir</button>' : ''}
      <button class="btn primary" id="qSave"></button>
    </div>`, (sheet) => {
    const input = $('#qText', sheet);
    input.addEventListener('input', () => { applyText(input.value); paintQuick(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveQuick(); } });
    $$('#qKind button', sheet).forEach((b) => { b.onclick = () => { setKind(b.dataset.k); paintQuick(); input.focus(); }; });
    sheet.addEventListener('click', onQuickClick);
    sheet.addEventListener('change', (e) => {
      if (e.target.id === 'qDate') { Q.date = e.target.value || L.today(); paintQuick(); }
      if (e.target.id === 'qInstSel') { Q.installments = +e.target.value; paintQuick(); }
    });
    sheet.addEventListener('input', (e) => { if (e.target.id === 'qNotes') Q.notes = e.target.value; });
    $('#qSave', sheet).onclick = saveQuick;
    $('#qDel', sheet)?.addEventListener('click', deleteQuick);
    paintQuick();
    setTimeout(() => { input.focus(); if (!editing) input.setSelectionRange(input.value.length, input.value.length); }, 60);
  });
}

function setKind(k) {
  Q.kind = k;
  if (!Q.catTouched) Q.category_id = null;
  if (k === 'transferencia' && !Q.to_account_id) {
    Q.to_account_id = activeAccounts().find((a) => a.id !== Q.account_id)?.id || null;
  }
  applyText(Q.text);
}

function applyText(text) {
  Q.text = text;
  const p = L.parseQuick(text);
  Q.amount = p.amount; Q.description = p.description;
  if (!Q.id) {
    if (p.kind === 'receita' && Q.kind === 'despesa') Q.kind = 'receita';
    if (p.installments) Q.installments = p.installments;
  }
  const s = L.suggest(p.description, Q.kind, S.memory, S.categories);
  Q.source = s.source;
  if (!Q.catTouched) Q.category_id = s.category_id;
  let sAcc = s.account_id && acc(s.account_id) && !acc(s.account_id).archived ? s.account_id : null;
  if (!sAcc && Q.category_id) sAcc = accountForCategory(Q.category_id);
  if (!Q.accTouched && sAcc) Q.account_id = sAcc;
}

function paintQuick() {
  const sheet = $('.sheet'); if (!sheet) return;
  $$('#qKind button', sheet).forEach((b) => b.classList.toggle('on', b.dataset.k === Q.kind));
  const input = $('#qText', sheet);
  input.placeholder = Q.kind === 'despesa' ? 'No que você gastou? Ex.: mercado 215' : Q.kind === 'receita' ? 'O que entrou? Ex.: salário 8500' : 'Ex.: pagamento fatura 1500';
  const comps = Q.id ? [] : L.completions(Q.description, Q.kind, S.memory);
  $('#qComp', sheet).innerHTML = comps.map((c) => `<button class="chip" data-comp="${esc(c)}">${esc(c)}</button>`).join('');
  const hint = $('#qScanHint', sheet);
  if (hint) hint.hidden = !!Q.text || Q.kind !== 'despesa';

  const cats = activeCats(Q.kind === 'transferencia' ? 'x' : Q.kind);
  const catRank = usageRank('category_id');
  const sortedCats = [...cats].sort((a, b) => (b.id === Q.category_id) - (a.id === Q.category_id) || (catRank[b.id] || 0) - (catRank[a.id] || 0) || a.sort - b.sort);
  const accRank = usageRank('account_id');
  const accs = activeAccounts().sort((a, b) => (accRank[b.id] || 0) - (accRank[a.id] || 0));
  const a = acc(Q.account_id);
  const isCredit = a?.kind === 'credito' && Q.kind === 'despesa';
  const amountOk = Q.amount > 0;
  const accChips = (field, exclude) => accs.filter((x) => x.id !== exclude).sort((x, y) => (y.id === Q[field]) - (x.id === Q[field])).map((x) => `<button class="chip ${Q[field] === x.id ? 'on' : ''}" data-${field === 'account_id' ? 'acc' : 'to'}="${x.id}">${x.icon} ${esc(x.name)}</button>`).join('');
  const yest = L.addDays(L.today(), -1);

  let bill = '';
  if (isCredit && amountOk) {
    const b = L.billOf(Q.date, a);
    bill = `<p class="hint">Entra na fatura que vence em ${L.shortDate(b.due)}${Q.installments > 1 && !Q.id ? `, em ${Q.installments}x de ${L.money(L.splitInstallments(Q.amount, Q.installments)[0])}` : ''}.</p>`;
  }

  $('#qBody', sheet).innerHTML = `
    <div class="amount-preview ${amountOk ? '' : 'none'}">${amountOk ? L.money(Q.amount) : 'Digite o valor na frase'}${Q.description ? ` <span>· ${esc(Q.description)}</span>` : ''}</div>
    ${receiptCard()}
    ${Q.kind !== 'transferencia' ? `<div class="fld"><span class="fl">Categoria ${Q.source && !Q.catTouched && Q.category_id ? `<em>${Q.source === 'aprendido' ? 'sugerida pelo seu histórico' : 'sugerida'}</em>` : ''}</span>
      <div class="chips scroll">${sortedCats.map((c) => `<button class="chip ${Q.category_id === c.id ? 'on' : ''}" data-cat="${c.id}">${c.icon} ${esc(c.name)}</button>`).join('')}${Q.id ? '' : '<button class="chip add" data-newcat="1">＋ Nova</button>'}</div></div>` : ''}
    <div class="fld"><span class="fl">${Q.kind === 'transferencia' ? 'De' : Q.kind === 'receita' ? 'Entrou em' : 'Pago com'}</span><div class="chips scroll">${accChips('account_id')}</div></div>
    ${Q.kind === 'transferencia' ? `<div class="fld"><span class="fl">Para</span><div class="chips scroll">${accChips('to_account_id', Q.account_id)}</div></div>` : ''}
    ${isCredit && !Q.id ? `<div class="fld"><span class="fl">Parcelas</span><div class="chips scroll">${[1, 2, 3, 4, 5, 6, 10, 12].map((n) => `<button class="chip ${Q.installments === n ? 'on' : ''}" data-inst="${n}">${n === 1 ? 'À vista' : n + 'x'}</button>`).join('')}
      <select id="qInstSel" class="chip-select">${Array.from({ length: 24 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${Q.installments === n ? 'selected' : ''}>${n}x</option>`).join('')}</select></div></div>` : ''}
    ${Q.instLabel ? `<p class="hint">${Q.instLabel}. A alteração vale só para esta parcela.</p>` : ''}
    ${bill}
    <div class="fld"><span class="fl">Data</span><div class="chips">
      <button class="chip ${Q.date === L.today() ? 'on' : ''}" data-date="${L.today()}">Hoje</button>
      <button class="chip ${Q.date === yest ? 'on' : ''}" data-date="${yest}">Ontem</button>
      <input type="date" id="qDate" class="chip-date ${Q.date !== L.today() && Q.date !== yest ? 'on' : ''}" value="${Q.date}"></div></div>
    <details class="notes" ${Q.notes ? 'open' : ''}><summary>Observação</summary><textarea id="qNotes" rows="2">${esc(Q.notes)}</textarea></details>`;

  const valid = amountOk && Q.account_id && (Q.kind !== 'transferencia' || (Q.to_account_id && Q.to_account_id !== Q.account_id));
  const btn = $('#qSave', sheet);
  btn.disabled = !valid;
  btn.textContent = !valid ? 'Salvar' : `${Q.id ? 'Salvar' : 'Lançar'} ${L.money(Q.amount)}${Q.kind !== 'transferencia' && cat(Q.category_id) ? ' · ' + cat(Q.category_id).name : ''}`;
}

function receiptCard() {
  const r = Q.receipt; if (!r) return '';
  const itens = r.itens || [];
  const cnpj = r.cnpj && r.cnpj.length === 14 ? r.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : r.cnpj;
  const qtd = (q) => (q == null ? '' : Number.isInteger(+q) ? `${q}×` : `${String(q).replace('.', ',')}`);
  return `<div class="receipt">
    <div class="row-top"><b>🧾 ${esc(r.estabelecimento || r.razao_social || 'Cupom fiscal')}</b><span class="small muted">${itens.length} ${itens.length === 1 ? 'item' : 'itens'}${r.forma_pagamento ? ' · ' + (R.PAGAMENTO_LABEL[r.forma_pagamento] || '') : ''}</span></div>
    ${(Q.avisos || []).map((a) => `<p class="warn">⚠ ${esc(a)}</p>`).join('')}
    ${itens.length ? `<details><summary>Ver itens</summary><table class="mini items"><tbody>${itens.map((i) => `<tr><td>${esc(i.descricao)}</td><td>${qtd(i.quantidade)}</td><td>${i.valor_total != null ? L.money(i.valor_total) : ''}</td></tr>`).join('')}</tbody></table></details>` : ''}
    <p class="muted small">${cnpj ? `CNPJ ${esc(cnpj)}` : ''}${Q.receipt_key ? `${cnpj ? ' · ' : ''}NFC-e identificada (não deixa lançar duas vezes)` : ''}${r.hora ? ` · ${esc(r.hora)}` : ''}</p>
    ${Q.id ? '' : '<button type="button" class="link small" data-dropreceipt="1">Descartar dados do cupom</button>'}
  </div>`;
}

const mostUsed = (list) => { const rank = usageRank('account_id'); return [...list].sort((a, b) => (rank[b.id] || 0) - (rank[a.id] || 0))[0]?.id || null; };
const autoLaunch = () => { try { return localStorage.getItem('aurora-auto-cupom') !== '0'; } catch { return true; } };

function setScanning(on, msg = '') {
  const sheet = $('.sheet'); if (!sheet) return;
  let ov = $('.scan-overlay', sheet);
  if (!on) { ov?.remove(); return; }
  if (!ov) { ov = document.createElement('div'); ov.className = 'scan-overlay'; sheet.appendChild(ov); }
  ov.innerHTML = `<div class="spinner"></div><p>${esc(msg)}</p>`;
}

async function duplicateOf(chave) {
  const dup = chave && S.txs.find((t) => t.receipt_key === chave);
  if (!dup) return false;
  setScanning(false);
  const c = await ask(`Este cupom já foi lançado em ${L.shortDate(dup.date)}: ${dup.description}, ${L.money(dup.amount)}.`,
    [{ label: 'Abrir o lançamento', value: 'open', primary: true }, { label: 'Fechar', value: null }]);
  if (c === 'open') openQuick({ id: dup.id });
  return true;
}

/** Foto do cupom -> QR Code -> leitura -> lançamento preenchido (ou lançado direto) */
async function scanReceipt(mode) {
  const file = await R.pickPhoto({ camera: mode === 'camera' });
  if (!file || !$('.sheet') || !Q) return;
  setScanning(true, 'Preparando a foto…');
  try {
    const prep = await R.prepare(file);
    const qr = R.parseNfceQr(prep.qrText);
    if (await duplicateOf(qr?.chave)) return;
    setScanning(true, qr ? 'QR Code da NFC-e encontrado. Lendo valores e itens…' : 'Lendo o cupom… (leva alguns segundos)');
    const cupom = await S.db.readReceipt({
      image: prep.image, media_type: prep.media_type, categorias: activeCats('despesa').map((c) => c.name),
      chave_qr: qr?.chave || null, hoje: L.today(), qr,
    });
    if (!cupom || (!cupom.legivel && !qr?.offline)) {
      setScanning(false);
      toast('Não consegui ler esse cupom. Tente outra foto, mais perto, reta e com boa luz.');
      return;
    }
    const draft = R.receiptToDraft(cupom, qr, { accounts: S.accounts, categories: S.categories, memory: S.memory, accountForCategory, mostUsed, today: L.today() });
    if (await duplicateOf(draft.receipt_key)) return;
    if (!$('.sheet') || !Q) return;
    Object.assign(Q, {
      kind: 'despesa', amount: draft.amount, description: draft.description, text: `${draft.description} ${L.plainAmount(draft.amount)}`,
      date: draft.date, category_id: draft.category_id, account_id: draft.account_id, installments: draft.installments,
      receipt: draft.receipt, receipt_key: draft.receipt_key, avisos: draft.avisos,
      catTouched: !!draft.category_id, accTouched: !!draft.account_id, source: null,
    });
    $('#qText').value = Q.text;
    setScanning(false);
    paintQuick();
    if (draft.confiavel && autoLaunch()) await saveQuick();
  } catch (e) {
    console.error(e);
    setScanning(false);
    toast('⚠ ' + esc(e.message || 'Falha ao ler o cupom'));
  }
}

function onQuickClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.scan) { scanReceipt(d.scan); return; }
  if (d.newcat) {
    const saved = { ...Q };
    openCategory(null, { kind: Q.kind, onSaved: (newId) => openQuick({ ...saved, category_id: newId, catTouched: true }), onCancel: () => openQuick(saved) });
    return;
  }
  if (d.dropreceipt) { Q.receipt = null; Q.receipt_key = null; Q.avisos = []; paintQuick(); return; }
  if (d.cat) {
    Q.category_id = Q.category_id === d.cat ? null : d.cat; Q.catTouched = true;
    const best = Q.category_id && accountForCategory(Q.category_id);
    if (!Q.accTouched && best) Q.account_id = best;
  }
  else if (d.acc) { Q.account_id = d.acc; Q.accTouched = true; if (Q.to_account_id === d.acc) Q.to_account_id = null; if (acc(d.acc)?.kind !== 'credito') Q.installments = 1; }
  else if (d.to) {
    Q.to_account_id = d.to;
    if (!Q.description && acc(d.to)?.kind === 'credito') { /* mantém frase */ }
  } else if (d.inst) Q.installments = +d.inst;
  else if (d.date) Q.date = d.date;
  else if (d.comp) {
    const p = L.parseQuick(Q.text);
    const t = `${d.comp}${p.amount > 0 ? ' ' + L.plainAmount(p.amount) : ' '}`;
    $('#qText').value = t; applyText(t); $('#qText').focus();
  } else return;
  paintQuick();
}

async function saveQuick() {
  const btn = $('#qSave'); if (!btn || btn.disabled) return;
  btn.disabled = true;
  const base = {
    kind: Q.kind, amount: Q.amount,
    description: Q.description || (Q.kind === 'transferencia' ? (acc(Q.to_account_id)?.kind === 'credito' ? 'Pagamento fatura ' + acc(Q.to_account_id).name : 'Transferência') : catName(Q.category_id)),
    category_id: Q.kind === 'transferencia' ? null : Q.category_id,
    account_id: Q.account_id, to_account_id: Q.kind === 'transferencia' ? Q.to_account_id : null,
    date: Q.date, notes: Q.notes || null,
    receipt: Q.receipt || null, receipt_key: Q.receipt_key || null,
  };
  const ok = await guard(async () => {
    if (Q.id) {
      await S.db.update('transactions', Q.id, base);
      toast('Lançamento atualizado');
    } else {
      let rows = [base];
      const isCredit = acc(Q.account_id)?.kind === 'credito' && Q.kind === 'despesa';
      if (isCredit && Q.installments > 1) {
        const g = uuid();
        rows = L.splitInstallments(Q.amount, Q.installments).map((amt, i) => ({
          ...base, amount: amt, date: L.addMonths(Q.date, i), installment_group: g, installment_no: i + 1, installment_total: Q.installments,
          ...(i > 0 ? { receipt: null, receipt_key: null } : {}),
        }));
      }
      const inserted = await S.db.insert('transactions', rows);
      const label = `${base.receipt ? '🧾 ' : ''}${esc(base.description)} ${L.money(Q.amount)}${rows.length > 1 ? ` em ${rows.length}x` : ''}${base.category_id ? ' · ' + esc(catName(base.category_id)) : ''}`;
      toast(`✓ ${label}`, { label: 'Desfazer', run: () => guard(async () => { await S.db.remove('transactions', inserted.map((r) => r.id)); await loadAll(); render(); }) });
    }
    return true;
  });
  if (!ok) { btn.disabled = false; return; }
  closeSheet();
  await guard(loadAll);
  render();
}

async function deleteQuick() {
  const t = S.txs.find((x) => x.id === Q.id); if (!t) return;
  let ids = [t.id];
  if (t.installment_group) {
    const all = S.txs.filter((x) => x.installment_group === t.installment_group);
    const choice = await ask(`Esta compra tem ${all.length} parcelas. O que deseja excluir?`, [
      { label: `Todas as ${all.length} parcelas`, value: 'all', primary: true }, { label: 'Só esta parcela', value: 'one' }, { label: 'Cancelar', value: null }]);
    if (!choice) return;
    if (choice === 'all') ids = all.map((x) => x.id);
  } else if (!(await confirmAsk('Excluir este lançamento?'))) return;
  await guard(async () => { await S.db.remove('transactions', ids); toast(ids.length > 1 ? `${ids.length} parcelas excluídas` : 'Lançamento excluído'); });
  closeSheet(); await guard(loadAll); render();
}

// ----------------------------------------------------------------- edição de contas
function openAccount(id) {
  const a = id ? acc(id) : { name: '', kind: 'credito', icon: '💳', owner_id: null, opening_balance: 0, credit_limit: null, closing_day: null, due_day: null, archived: false };
  const icons = ['🏦', '💳', '🍽️', '🛒', '🎫', '💵', '📈', '🐷', '💰', '🏠'];
  const used = id ? S.txs.some((t) => t.account_id === id || t.to_account_id === id) : false;
  openSheet(`<div class="sheet-h"><h3>${id ? 'Editar conta' : 'Nova conta'}</h3><button class="x" data-close>✕</button></div>
  <form class="form" id="accForm">
    <label>Tipo<select name="kind">${Object.entries(ACCOUNT_KINDS).map(([k, v]) => `<option value="${k}" ${a.kind === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
    <label>Nome<input name="name" required value="${esc(a.name)}" placeholder="Ex.: Nubank, Ticket Refeição"></label>
    <div class="fld"><span class="fl">Ícone</span><div class="chips">${icons.map((i) => `<button type="button" class="chip ${a.icon === i ? 'on' : ''}" data-icon="${i}">${i}</button>`).join('')}</div><input type="hidden" name="icon" value="${a.icon}"></div>
    <label>De quem é<select name="owner_id"><option value="">Conjunta</option>${S.members.map((m) => `<option value="${m.user_id}" ${a.owner_id === m.user_id ? 'selected' : ''}>${esc(m.display_name)}</option>`).join('')}</select></label>
    <div class="credit-only">
      <label>Limite total<input name="credit_limit" inputmode="decimal" value="${a.credit_limit != null ? L.plainAmount(a.credit_limit) : ''}" placeholder="Ex.: 8000"></label>
      <div class="two"><label>Dia do fechamento<input name="closing_day" type="number" min="1" max="31" value="${a.closing_day ?? ''}"></label>
      <label>Dia do vencimento<input name="due_day" type="number" min="1" max="31" value="${a.due_day ?? ''}"></label></div>
      <label>Já usado do limite hoje<input name="used" inputmode="decimal" value="${a.kind === 'credito' && a.opening_balance ? L.plainAmount(-a.opening_balance) : ''}" placeholder="Compras anteriores ao app (opcional)"></label>
    </div>
    <label class="not-credit">Saldo inicial<input name="opening_balance" inputmode="decimal" value="${a.kind !== 'credito' ? L.plainAmount(a.opening_balance || 0) : '0,00'}"></label>
    <p class="msg" id="accMsg"></p>
    <div class="sheet-f">${id ? `<button type="button" class="btn ghost" id="accDel">${used ? (a.archived ? 'Reativar' : 'Arquivar') : 'Excluir'}</button>` : ''}<button class="btn primary">Salvar</button></div>
  </form>`, (sheet) => {
    const f = $('#accForm', sheet);
    const sync = () => { const c = f.kind.value === 'credito'; $('.credit-only', sheet).hidden = !c; $('.not-credit', sheet).hidden = c; };
    f.kind.onchange = () => { const ic = ACCOUNT_KINDS[f.kind.value].icon; f.icon.value = ic; $$('[data-icon]', sheet).forEach((b) => b.classList.toggle('on', b.dataset.icon === ic)); sync(); };
    sync();
    $$('[data-icon]', sheet).forEach((b) => { b.onclick = () => { f.icon.value = b.dataset.icon; $$('[data-icon]', sheet).forEach((x) => x.classList.toggle('on', x === b)); }; });
    f.onsubmit = (ev) => {
      ev.preventDefault();
      const kind = f.kind.value; const isC = kind === 'credito';
      const row = {
        name: f.name.value.trim(), kind, icon: f.icon.value, owner_id: f.owner_id.value || null,
        credit_limit: isC ? (L.parseAmount(f.credit_limit.value) || null) : null,
        closing_day: isC ? (+f.closing_day.value || null) : null, due_day: isC ? (+f.due_day.value || null) : null,
        opening_balance: isC ? -(L.parseAmount(f.used.value) || 0) : (L.parseAmount(f.opening_balance.value) || 0),
      };
      if (isC && (!row.closing_day || !row.due_day)) { $('#accMsg', sheet).textContent = 'Informe os dias de fechamento e vencimento.'; return; }
      guard(async () => {
        if (id) await S.db.update('accounts', id, row);
        else await S.db.insert('accounts', [{ ...row, sort: S.accounts.length }]);
        closeSheet(); await loadAll(); render();
      });
    };
    $('#accDel', sheet)?.addEventListener('click', () => guard(async () => {
      if (used) await S.db.update('accounts', id, { archived: !a.archived });
      else if (await confirmAsk('Excluir esta conta?')) await S.db.remove('accounts', [id]); else return;
      closeSheet(); await loadAll(); render();
    }));
  });
}

function openCategory(id, opts = {}) {
  const c = id ? cat(id) : { name: '', icon: '🏷️', kind: opts.kind === 'receita' ? 'receita' : 'despesa', monthly_limit: null, archived: false, is_investment: false };
  const used = id ? S.txs.some((t) => t.category_id === id) : false;
  const groups = Object.entries(ICON_GROUPS).map(([g, list]) => [g, list.split(' ').filter(Boolean)]);
  let saved = false;
  openSheet(`<div class="sheet-h"><h3>${id ? 'Editar categoria' : 'Nova categoria'}</h3><button class="x" data-close>✕</button></div>
  <form class="form" id="catForm">
    <div class="cat-preview"><span id="cpIcon">${c.icon}</span><b id="cpName">${esc(c.name) || 'Nome da categoria'}</b></div>
    <label>Nome<input name="name" required maxlength="40" value="${esc(c.name)}" placeholder="Ex.: Academia, Presentes, Carro"></label>
    <label>Tipo<select name="kind"><option value="despesa" ${c.kind === 'despesa' ? 'selected' : ''}>Despesa</option><option value="receita" ${c.kind === 'receita' ? 'selected' : ''}>Receita</option></select></label>
    <div class="fld"><span class="fl">Ícone</span>
      <div class="iconbank">${groups.map(([g, list]) => `<div class="ib-g">${esc(g)}</div><div class="ib-row">${list.map((i) => `<button type="button" class="ib ${c.icon === i ? 'on' : ''}" data-icon="${i}">${i}</button>`).join('')}</div>`).join('')}</div>
      <label class="inline">Ou use outro emoji<input name="customIcon" maxlength="8" placeholder="cole ou digite um emoji" value=""></label>
      <input type="hidden" name="icon" value="${c.icon}"></div>
    <label class="check inv-only"><input type="checkbox" name="is_investment" ${c.is_investment ? 'checked' : ''}> É investimento (aporte, previdência, reserva). Não conta como gasto e aparece em "Investido".</label>
    <label><span id="limLabel">${c.is_investment ? 'Meta mensal de investimento (opcional)' : 'Limite mensal (opcional)'}</span><input name="monthly_limit" inputmode="decimal" value="${c.monthly_limit ? L.plainAmount(c.monthly_limit) : ''}" placeholder="Ex.: 800"></label>
    <div class="sheet-f">${id ? `<button type="button" class="btn ghost" id="catDel">${used ? (c.archived ? 'Reativar' : 'Arquivar') : 'Excluir'}</button>` : ''}<button class="btn primary">Salvar</button></div>
  </form>`, (sheet) => {
    const f = $('#catForm', sheet);
    const setIcon = (ic) => { f.icon.value = ic; $('#cpIcon', sheet).textContent = ic; $$('[data-icon]', sheet).forEach((x) => x.classList.toggle('on', x.dataset.icon === ic)); };
    $$('[data-icon]', sheet).forEach((b) => { b.onclick = () => { f.customIcon.value = ''; setIcon(b.dataset.icon); }; });
    f.customIcon.oninput = () => { const v = f.customIcon.value.trim(); if (v) setIcon([...v].slice(0, 4).join('')); };
    f.name.oninput = () => { $('#cpName', sheet).textContent = f.name.value || 'Nome da categoria'; };
    const sync = () => {
      $('.inv-only', sheet).hidden = f.kind.value !== 'despesa';
      $('#limLabel', sheet).textContent = f.kind.value === 'despesa' && f.is_investment.checked ? 'Meta mensal de investimento (opcional)' : 'Limite mensal (opcional)';
    };
    f.kind.onchange = sync; f.is_investment.onchange = sync; sync();
    if (!id) setTimeout(() => f.name.focus(), 60);
    f.onsubmit = (ev) => {
      ev.preventDefault();
      const name = f.name.value.trim();
      const dup = S.categories.find((x) => x.id !== id && x.kind === f.kind.value && L.norm(x.name) === L.norm(name) && !x.archived);
      if (dup) { toast(`Já existe a categoria ${esc(dup.icon)} ${esc(dup.name)}`); return; }
      const row = {
        name, kind: f.kind.value, icon: f.icon.value || '🏷️',
        is_investment: f.kind.value === 'despesa' && f.is_investment.checked,
        monthly_limit: L.parseAmount(f.monthly_limit.value) || null,
      };
      guard(async () => {
        let newId = id;
        if (id) await S.db.update('categories', id, row);
        else newId = (await S.db.insert('categories', [{ ...row, sort: S.categories.length }]))[0].id;
        saved = true;
        closeSheet(); await loadAll();
        if (opts.onSaved) opts.onSaved(newId); else render();
        if (!id) toast(`Categoria ${esc(row.icon)} ${esc(row.name)} criada`);
      });
    };
    $('#catDel', sheet)?.addEventListener('click', () => guard(async () => {
      if (used) await S.db.update('categories', id, { archived: !c.archived });
      else if (await confirmAsk('Excluir esta categoria?')) await S.db.remove('categories', [id]); else return;
      closeSheet(); await loadAll(); render();
    }));
    if (opts.onCancel) {
      const wrap = sheet.parentElement;
      wrap.addEventListener('click', (e) => { if ((e.target === wrap || e.target.closest('[data-close]')) && !saved) setTimeout(opts.onCancel, 0); });
    }
  });
}

function promptText(title, value, onSave) {
  openSheet(`<div class="sheet-h"><h3>${esc(title)}</h3><button class="x" data-close>✕</button></div>
    <form class="form" id="pForm"><input name="v" required value="${esc(value)}"><div class="sheet-f"><button class="btn primary">Salvar</button></div></form>`, (sheet) => {
    const f = $('#pForm', sheet); f.v.focus();
    f.onsubmit = (ev) => { ev.preventDefault(); guard(async () => { await onSave(f.v.value.trim()); closeSheet(); render(); }); };
  });
}

// ----------------------------------------------------------------- exportação
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
function exportCsv() {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Conta destino', 'Valor', 'Parcela', 'Quem lançou', 'Observação'].join(';')];
  [...S.txs].reverse().forEach((t) => lines.push([
    t.date, t.kind, q(t.description), q(t.category_id ? catName(t.category_id) : ''), q(acc(t.account_id)?.name), q(acc(t.to_account_id)?.name || ''),
    String(t.amount).replace('.', ','), t.installment_total ? `${t.installment_no}/${t.installment_total}` : '', q(memberName(t.created_by)), q(t.notes || ''),
  ].join(';')));
  download(`aurora-lancamentos-${L.today()}.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
}

// ----------------------------------------------------------------- ações
const actions = {
  add: () => openQuick(),
  edit: (el) => openQuick({ id: el.dataset.id }),
  month: (el) => { S.month = L.shiftMonth(S.month, +el.dataset.d); render(); },
  who: (el) => { S.who = el.dataset.id; render(); },
  paybill: (el) => {
    const card = acc(el.dataset.id);
    const st = L.cardStatus(card, S.txs, L.balances(S.accounts, S.txs)[card.id]);
    const amount = st.closedPending > 0 ? st.closedPending : st.open.total;
    const from = activeAccounts().find((a) => a.kind === 'corrente')?.id;
    openQuick({ kind: 'transferencia', account_id: from, to_account_id: card.id, accTouched: true, text: `Pagamento fatura ${card.name} ${amount > 0 ? L.plainAmount(amount) : ''}`.trim() });
  },
  editAccount: (el) => openAccount(el.dataset.id),
  editCategory: (el) => openCategory(el.dataset.id),
  renameMe: () => promptText('Seu nome', me()?.display_name || '', async (v) => { await S.db.updateMember(v); me().display_name = v; }),
  renameHousehold: () => promptText('Nome da família', S.household?.name || '', async (v) => { await S.db.updateHousehold({ name: v }); S.household.name = v; }),
  switchUser: (el) => { S.db.switchUser(el.dataset.id); S.userId = el.dataset.id; render(); toast(`Agora lançando como ${esc(memberName(el.dataset.id))}`); },
  copyCode: async () => { try { await navigator.clipboard.writeText(S.household.invite_code); toast('Código copiado'); } catch { toast('Código: ' + esc(S.household.invite_code)); } },
  autoCupom: (el) => { try { localStorage.setItem('aurora-auto-cupom', el.dataset.v); } catch { /* sem armazenamento */ } render(); },
  exportCsv,
  exportJson: () => download(`aurora-backup-${L.today()}.json`, JSON.stringify({ household: S.household, members: S.members, accounts: S.accounts, categories: S.categories, transactions: S.txs }, null, 1), 'application/json'),
  resetDemo: async () => { if (!(await confirmAsk('Apagar tudo e recriar os dados de demonstração?', 'Recomeçar'))) return; S.db.reset(); await enterHousehold(); },
  logout: async () => { await S.db.signOut(); location.reload(); },
};

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { S.view = nav.dataset.nav; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el, e);
});

// ----------------------------------------------------------------- dicas dos gráficos
function showTip(el, x, y) {
  const tip = $('#tip'); if (!tip) return;
  tip.textContent = el.dataset.tip; tip.hidden = false;
  const w = tip.offsetWidth;
  tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px';
  tip.style.top = Math.max(8, y - tip.offsetHeight - 14) + 'px';
  const svg = el.closest('svg'); const g = svg?.querySelector('.guide');
  if (g && el.dataset.gx) { g.setAttribute('x1', el.dataset.gx); g.setAttribute('x2', el.dataset.gx); g.style.display = ''; }
}
function hideTip() { const t = $('#tip'); if (t) t.hidden = true; $$('.guide').forEach((g) => { g.style.display = 'none'; }); }
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (el) showTip(el, e.clientX, e.clientY); else hideTip();
});
document.addEventListener('pointerdown', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); });
window.addEventListener('scroll', hideTip, { passive: true });

boot().catch((e) => {
  console.error(e);
  root.innerHTML = `<div class="center"><h2>Erro ao iniciar</h2><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Recarregar</button></div>`;
});
