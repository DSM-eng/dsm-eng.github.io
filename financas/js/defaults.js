// Categorias e contas iniciais + dados de demonstração
import { uuid } from './db.js';
import { addMonths, today, ymd, splitInstallments, cardBills } from './logic.js';

export const DEFAULT_CATEGORIES = [
  ['Alimentação', '🍔', 'despesa'], ['Mercado', '🛒', 'despesa'], ['Transporte', '🚗', 'despesa'],
  ['Casa', '🏠', 'despesa'], ['Contas', '💡', 'despesa'], ['Saúde', '💊', 'despesa'],
  ['Educação', '🎓', 'despesa'], ['Filhos', '👶', 'despesa'], ['Lazer', '🎮', 'despesa'],
  ['Viagem', '✈️', 'despesa'], ['Roupas', '👕', 'despesa'], ['Assinaturas', '📺', 'despesa'],
  ['Pets', '🐶', 'despesa'], ['Compras', '🛍️', 'despesa'], ['Trabalho', '💼', 'despesa'],
  ['Investimentos', '📈', 'despesa', true], ['Outros', '🏷️', 'despesa'],
  ['Salário', '💰', 'receita'], ['Freelance', '💻', 'receita'], ['Rendimentos', '🪙', 'receita'],
  ['Reembolso', '↩️', 'receita'], ['Benefício', '🎫', 'receita'], ['Outras receitas', '➕', 'receita'],
].map(([name, icon, kind, inv], i) => ({ name, icon, kind, sort: i, monthly_limit: null, archived: false, is_investment: !!inv }));

// Banco de ícones para categorias (agrupado para facilitar a escolha)
export const ICON_GROUPS = {
  'Casa': '🏠 🏡 🛋️ 🛏️ 🧹 🧺 🔧 🪴 💡 🚿 🔑 📦',
  'Comida': '🍔 🍕 🍣 🍝 🥗 🍞 ☕ 🍺 🍷 🧁 🛒 🥩',
  'Transporte': '🚗 ⛽ 🚕 🚌 🚇 🚲 🛵 ✈️ 🅿️ 🚙 🧳 🛣️',
  'Saúde e bem-estar': '💊 🩺 🦷 🏥 🏋️ 🧘 💇 💅 🧴 👓 🩹 ❤️',
  'Família e pets': '👶 🧸 🎒 🍼 👨‍👩‍👧 🎂 🎁 💍 🐶 🐱 🐾 👵',
  'Lazer': '🎮 🎬 🎵 📚 🎨 ⚽ 🏖️ 🎟️ 🎉 🎤 📺 🎲',
  'Compras': '🛍️ 👕 👗 👟 👜 💄 📱 💻 🎧 ⌚ 🧾 🪑',
  'Finanças': '💰 💵 💳 🏦 📈 📊 🐷 🪙 💹 🧮 📉 🏛️',
  'Trabalho e estudo': '💼 🎓 📝 🏢 📐 🔬 🧑‍💻 📎 🗂️ 📖 ✏️ 🖨️',
  'Outros': '🏷️ ⭐ 🔔 🌱 🌍 ⛪ 🙏 🎯 ⚡ 🔥 🔁 ❓',
};

export const DEFAULT_ACCOUNTS = [
  { name: 'Conta corrente', kind: 'corrente', icon: '🏦', opening_balance: 0, sort: 0 },
  { name: 'Dinheiro', kind: 'dinheiro', icon: '💵', opening_balance: 0, sort: 1 },
];

export const ACCOUNT_KINDS = {
  corrente: { label: 'Conta corrente', icon: '🏦' },
  credito: { label: 'Cartão de crédito', icon: '💳' },
  beneficio: { label: 'Benefício (VA/VR)', icon: '🎫' },
  dinheiro: { label: 'Dinheiro', icon: '💵' },
  investimento: { label: 'Investimento / reserva', icon: '📈' },
};

// --------------------------------------------------------------- demonstração
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

export function demoSeed() {
  const r = rng(42);
  const between = (a, b) => Math.round((a + r() * (b - a)) * 100) / 100;
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const hid = 'h-demo'; const U1 = 'u-voce'; const U2 = 'u-dani';
  const cats = DEFAULT_CATEGORIES.map((c) => ({ ...c, id: uuid(), household_id: hid }));
  const C = Object.fromEntries(cats.map((c) => [c.name, c.id]));
  cats.find((c) => c.name === 'Alimentação').monthly_limit = 900;
  cats.find((c) => c.name === 'Mercado').monthly_limit = 1600;
  cats.find((c) => c.name === 'Lazer').monthly_limit = 500;
  cats.find((c) => c.name === 'Investimentos').monthly_limit = 3000; // meta mensal
  const acc = (o) => ({ id: uuid(), household_id: hid, archived: false, owner_id: null, opening_balance: 0, credit_limit: null, closing_day: null, due_day: null, ...o });
  const A = {
    cc: acc({ name: 'Itaú conta corrente', kind: 'corrente', icon: '🏦', opening_balance: 2400, sort: 0 }),
    nu: acc({ name: 'Nubank', kind: 'credito', icon: '💳', credit_limit: 9000, closing_day: 3, due_day: 10, owner_id: U1, sort: 1 }),
    c6: acc({ name: 'C6 Bank', kind: 'credito', icon: '💳', credit_limit: 6000, closing_day: 25, due_day: 5, owner_id: U2, sort: 2 }),
    vr: acc({ name: 'Ticket Refeição', kind: 'beneficio', icon: '🍽️', sort: 3 }),
    va: acc({ name: 'Ticket Alimentação', kind: 'beneficio', icon: '🛒', sort: 4 }),
    din: acc({ name: 'Dinheiro', kind: 'dinheiro', icon: '💵', opening_balance: 180, sort: 5 }),
    inv: acc({ name: 'Reserva de emergência', kind: 'investimento', icon: '📈', opening_balance: 18500, sort: 6 }),
  };
  const txs = [];
  const T = today();
  const add = (o) => { if (o.date <= T || o.installment_group) txs.push({ id: uuid(), household_id: hid, category_id: null, to_account_id: null, installment_group: null, installment_no: null, installment_total: null, notes: null, created_at: o.date + 'T12:00:00Z', ...o }); };
  const [ty, tm] = T.split('-').map(Number);
  for (let k = -4; k <= 0; k++) {
    const base = addMonths(ymd(ty, tm - 1, 1), k);
    const [y, m] = base.split('-').map(Number);
    const d = (day) => ymd(y, m - 1, Math.min(day, new Date(y, m, 0).getDate()));
    const who = () => (r() < 0.5 ? U1 : U2);
    add({ kind: 'receita', amount: 7800, description: 'Salário', category_id: C['Salário'], account_id: A.cc.id, date: d(1), created_by: U1 });
    add({ kind: 'receita', amount: 6300, description: 'Salário Danielle', category_id: C['Salário'], account_id: A.cc.id, date: d(2), created_by: U2 });
    add({ kind: 'receita', amount: 760, description: 'Recarga ticket', category_id: C['Benefício'], account_id: A.vr.id, date: d(1), created_by: U2 });
    add({ kind: 'receita', amount: 1150, description: 'Recarga ticket', category_id: C['Benefício'], account_id: A.va.id, date: d(1), created_by: U2 });
    if (r() < 0.5) add({ kind: 'receita', amount: between(1200, 3500), description: 'Consultoria', category_id: C['Freelance'], account_id: A.cc.id, date: d(18), created_by: U1 });
    add({ kind: 'despesa', amount: 3400, description: 'Aluguel', category_id: C['Casa'], account_id: A.cc.id, date: d(10), created_by: U1 });
    add({ kind: 'despesa', amount: 820, description: 'Condomínio', category_id: C['Casa'], account_id: A.cc.id, date: d(10), created_by: U1 });
    add({ kind: 'despesa', amount: between(210, 330), description: 'Enel', category_id: C['Contas'], account_id: A.cc.id, date: d(14), created_by: U2 });
    add({ kind: 'despesa', amount: between(110, 160), description: 'Sabesp', category_id: C['Contas'], account_id: A.cc.id, date: d(16), created_by: U2 });
    add({ kind: 'despesa', amount: 129.9, description: 'Vivo Fibra', category_id: C['Contas'], account_id: A.nu.id, date: d(12), created_by: U1 });
    add({ kind: 'despesa', amount: 1680, description: 'Escola', category_id: C['Filhos'], account_id: A.cc.id, date: d(5), created_by: U2 });
    add({ kind: 'despesa', amount: 1380, description: 'Plano de saúde', category_id: C['Saúde'], account_id: A.cc.id, date: d(8), created_by: U2 });
    add({ kind: 'despesa', amount: 1490, description: 'Financiamento carro', category_id: C['Transporte'], account_id: A.cc.id, date: d(15), created_by: U1 });
    add({ kind: 'despesa', amount: 720, description: 'Diarista', category_id: C['Casa'], account_id: A.cc.id, date: d(28), created_by: U2 });
    add({ kind: 'despesa', amount: 600, description: 'Previdência privada', category_id: C['Investimentos'], account_id: A.cc.id, date: d(5), created_by: U1 });
    add({ kind: 'despesa', amount: 55.9, description: 'Netflix', category_id: C['Assinaturas'], account_id: A.nu.id, date: d(7), created_by: U1 });
    add({ kind: 'despesa', amount: 34.9, description: 'Spotify', category_id: C['Assinaturas'], account_id: A.c6.id, date: d(9), created_by: U2 });
    add({ kind: 'despesa', amount: 139.9, description: 'Smart Fit', category_id: C['Saúde'], account_id: A.c6.id, date: d(6), created_by: U2 });
    add({ kind: 'transferencia', amount: 2500, description: 'Aporte reserva', account_id: A.cc.id, to_account_id: A.inv.id, date: d(3), created_by: U1 });
    for (let i = 0; i < 4; i++) {
      const va = i < 3;
      add({ kind: 'despesa', amount: between(170, 480), description: pick(['Pão de Açúcar', 'Carrefour', 'Assaí', 'Hortifruti']), category_id: C['Mercado'], account_id: va ? A.va.id : pick([A.nu.id, A.c6.id]), date: d(3 + i * 7 + Math.floor(r() * 4)), created_by: who() });
    }
    for (let i = 0; i < 14; i++) {
      add({ kind: 'despesa', amount: between(32, 68), description: pick(['Almoço', 'Restaurante', 'Padaria', 'Almoço']), category_id: C['Alimentação'], account_id: A.vr.id, date: d(1 + Math.floor(r() * 28)), created_by: who() });
    }
    for (let i = 0; i < 4; i++) {
      add({ kind: 'despesa', amount: between(48, 120), description: 'iFood', category_id: C['Alimentação'], account_id: pick([A.nu.id, A.c6.id]), date: d(1 + Math.floor(r() * 28)), created_by: who() });
    }
    for (let i = 0; i < 7; i++) {
      add({ kind: 'despesa', amount: between(16, 46), description: pick(['Uber', 'Uber', '99']), category_id: C['Transporte'], account_id: pick([A.nu.id, A.c6.id]), date: d(1 + Math.floor(r() * 28)), created_by: who() });
    }
    for (let i = 0; i < 2; i++) {
      add({ kind: 'despesa', amount: between(210, 290), description: 'Posto Shell', category_id: C['Transporte'], account_id: A.nu.id, date: d(4 + i * 13), created_by: U1 });
    }
    add({ kind: 'despesa', amount: between(45, 190), description: 'Droga Raia', category_id: C['Saúde'], account_id: A.c6.id, date: d(8 + Math.floor(r() * 15)), created_by: U2 });
    add({ kind: 'despesa', amount: between(90, 260), description: pick(['Cinema', 'Parque', 'Teatro']), category_id: C['Lazer'], account_id: A.nu.id, date: d(12 + Math.floor(r() * 12)), created_by: who() });
    if (r() < 0.5) add({ kind: 'despesa', amount: between(120, 390), description: pick(['Renner', 'Zara', 'Centauro']), category_id: C['Roupas'], account_id: A.c6.id, date: d(15 + Math.floor(r() * 10)), created_by: U2 });
    if (r() < 0.6) add({ kind: 'despesa', amount: between(40, 90), description: 'Feira', category_id: C['Mercado'], account_id: A.din.id, date: d(20), created_by: U1 });
  }
  // compras parceladas
  const parcel = (desc, total, n, account, cat, date, who) => {
    const g = uuid();
    splitInstallments(total, n).forEach((amt, i) => add({ kind: 'despesa', amount: amt, description: desc, category_id: cat, account_id: account, date: addMonths(date, i), installment_group: g, installment_no: i + 1, installment_total: n, created_by: who }));
  };
  parcel('Geladeira', 4790, 10, A.nu.id, C['Casa'], addMonths(T, -2), U1);
  parcel('Passagens Latam', 2380, 6, A.c6.id, C['Viagem'], addMonths(T, -1), U2);
  // pagamentos das faturas já vencidas
  for (const card of [A.nu, A.c6]) {
    for (const b of Object.values(cardBills(card, txs))) {
      if (b.due <= T && b.total > 0) add({ kind: 'transferencia', amount: b.total, description: 'Pagamento fatura ' + card.name, account_id: A.cc.id, to_account_id: card.id, date: b.due, created_by: card.owner_id });
    }
  }
  return {
    user_id: U1,
    household: { id: hid, name: 'Família (demonstração)', invite_code: 'DEMO01' },
    members: [{ household_id: hid, user_id: U1, display_name: 'Você', role: 'dono' }, { household_id: hid, user_id: U2, display_name: 'Danielle', role: 'membro' }],
    accounts: Object.values(A), categories: cats, transactions: txs,
  };
}
