// Cupom fiscal: foto, redução da imagem, leitura do QR Code da NFC-e
// e conversão do resultado da leitura em um lançamento.
import * as L from './logic.js';

// ------------------------------------------------------------------ foto
/** Abre a câmera (ou a galeria) e devolve o arquivo escolhido. Chamar dentro de um clique. */
export function pickPhoto({ camera = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.onchange = () => { resolve(input.files?.[0] || null); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}

async function toBitmap(file) {
  if (globalThis.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* cai no <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function draw(bitmap, maxSide) {
  const w0 = bitmap.width; const h0 = bitmap.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  c.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0, c.width, c.height);
  return c;
}

/** Reduz a foto (texto de cupom continua legível com 2400 px no lado maior) e procura o QR Code */
export async function prepare(file) {
  const bmp = await toBitmap(file);
  const canvas = draw(bmp, 2400);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const qrText = await findQr(bmp, canvas);
  return { image: dataUrl.split(',')[1], media_type: 'image/jpeg', width: canvas.width, height: canvas.height, qrText, preview: canvas.toDataURL('image/jpeg', 0.5) };
}

// ------------------------------------------------------------------ QR Code
let jsQRPromise = null;
function loadJsQR() {
  if (globalThis.jsQR) return Promise.resolve(globalThis.jsQR);
  jsQRPromise = jsQRPromise || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('./vendor/jsQR.js', import.meta.url).href;
    s.onload = () => resolve(globalThis.jsQR);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return jsQRPromise;
}

async function findQr(bmp, canvas) {
  try {
    if ('BarcodeDetector' in globalThis) {
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      const codes = await det.detect(bmp);
      if (codes[0]?.rawValue) return codes[0].rawValue;
    }
  } catch { /* segue para o jsQR */ }
  try {
    const jsQR = await loadJsQR();
    for (const side of [1000, 1600, 2400]) {
      const c = side >= Math.max(canvas.width, canvas.height) ? canvas : draw(canvas, side);
      const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
      const r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
      if (r?.data) return r.data;
      if (c === canvas) break;
    }
  } catch { /* sem QR */ }
  return null;
}

/** Dígito verificador da chave de acesso (módulo 11) */
export function chaveValida(ch) {
  if (!/^\d{44}$/.test(ch || '')) return false;
  let sum = 0; let w = 2;
  for (let i = 42; i >= 0; i--) { sum += +ch[i] * w; w = w === 9 ? 2 : w + 1; }
  const r = sum % 11;
  const dv = r < 2 ? 0 : 11 - r;
  return dv === +ch[43];
}

/** Lê o conteúdo do QR Code da NFC-e (online ou contingência) */
export function parseNfceQr(text) {
  if (!text) return null;
  const m = text.replace(/\s/g, '').match(/(\d{44})/);
  if (!m || !chaveValida(m[1])) return null;
  const chave = m[1];
  const p = (text.split(/[?&]p=/)[1] || '').split('&')[0].split('|');
  let offline = null;
  if (p.length >= 8) {
    const valor = parseFloat(p[4]);
    if (valor > 0) offline = { dia: +p[3] || null, valor };
  }
  return { chave, ...decodeChave(chave), offline, url: text };
}

export function decodeChave(ch) {
  return { uf: ch.slice(0, 2), ano: 2000 + +ch.slice(2, 4), mes: +ch.slice(4, 6), cnpj: ch.slice(6, 20), modelo: ch.slice(20, 22) };
}

// ------------------------------------------------------------------ resultado -> lançamento
const somaItens = (itens) => (itens || []).reduce((s, i) => s + (Number(i.valor_total) || 0), 0);

/**
 * Converte o cupom lido em sugestões de lançamento.
 * ctx: { accounts, categories, memory, accountForCategory, today }
 */
export function receiptToDraft(cupom, qr, ctx) {
  const avisos = [];
  const today = ctx.today || L.today();
  let total = Number(cupom.valor_total) || 0;
  if (qr?.offline?.valor && Math.abs(qr.offline.valor - total) > 0.009) {
    if (total) avisos.push(`O QR Code indica ${L.money(qr.offline.valor)}; usei esse valor.`);
    total = qr.offline.valor;
  }
  const soma = somaItens(cupom.itens);
  if (total && soma && Math.abs(soma - (Number(cupom.desconto) || 0) - total) > Math.max(0.05, total * 0.02)) {
    avisos.push(`A soma dos itens (${L.money(soma)}) não bate com o total. Confira o valor.`);
  }
  let date = /^\d{4}-\d{2}-\d{2}$/.test(cupom.data || '') ? cupom.data : null;
  if (date && (date > today || date < L.addDays(today, -400))) { avisos.push('A data lida parece errada; usei hoje.'); date = null; }
  if (!date) date = today;

  const descricao = (cupom.estabelecimento || cupom.razao_social || 'Cupom fiscal').trim();
  const despesaCats = ctx.categories.filter((c) => c.kind === 'despesa' && !c.archived);
  const learned = L.suggest(descricao, 'despesa', ctx.memory, ctx.categories);
  let category_id = learned.source === 'aprendido' ? learned.category_id : null;
  if (!category_id && cupom.categoria_sugerida) category_id = despesaCats.find((c) => L.norm(c.name) === L.norm(cupom.categoria_sugerida))?.id || null;
  if (!category_id) category_id = learned.category_id;

  const accs = ctx.accounts.filter((a) => !a.archived);
  const byKind = (k) => accs.filter((a) => a.kind === k);
  const pay = cupom.forma_pagamento;
  let candidates = accs;
  if (pay === 'credito') candidates = byKind('credito');
  else if (pay === 'debito' || pay === 'pix') candidates = byKind('corrente');
  else if (pay === 'dinheiro') candidates = byKind('dinheiro');
  else if (pay === 'vale_refeicao' || pay === 'vale_alimentacao') {
    const ben = byKind('beneficio');
    const re = pay === 'vale_refeicao' ? /refei|\bvr\b/i : /aliment|\bva\b/i;
    candidates = ben.filter((a) => re.test(a.name)).length ? ben.filter((a) => re.test(a.name)) : ben;
  }
  if (!candidates.length) candidates = accs;
  const ids = new Set(candidates.map((a) => a.id));
  let account_id = null;
  if (cupom.final_cartao && /^\d{4}$/.test(cupom.final_cartao)) account_id = candidates.find((a) => a.name.includes(cupom.final_cartao))?.id || null;
  if (!account_id && learned.account_id && ids.has(learned.account_id)) account_id = learned.account_id;
  if (!account_id && category_id) { const a = ctx.accountForCategory(category_id); if (a && ids.has(a)) account_id = a; }
  if (!account_id) account_id = candidates.length === 1 ? candidates[0].id : (ctx.mostUsed(candidates) || candidates[0]?.id || null);

  const chave = qr?.chave || (chaveValida((cupom.chave_acesso || '').replace(/\D/g, '')) ? cupom.chave_acesso.replace(/\D/g, '') : null);
  if (cupom.observacao) avisos.push(cupom.observacao);
  if (cupom.simulado) avisos.unshift('Leitura simulada (modo demonstração): os dados abaixo são de exemplo. Com o Supabase configurado, o app lê a foto de verdade.');

  const confiavel = !!(cupom.legivel && total > 0 && category_id && account_id && !avisos.some((a) => /não bate|errada|QR Code indica/.test(a)) && !cupom.simulado && pay !== 'nao_identificado');
  return {
    amount: total, description: descricao, date, category_id, account_id,
    installments: pay === 'credito' && cupom.parcelas > 1 ? Math.min(24, cupom.parcelas) : 1,
    receipt_key: chave,
    receipt: {
      estabelecimento: cupom.estabelecimento || null, razao_social: cupom.razao_social || null,
      cnpj: (cupom.cnpj || '').replace(/\D/g, '') || qr?.cnpj || null, chave, tipo: cupom.tipo_documento || null,
      forma_pagamento: pay || null, final_cartao: cupom.final_cartao || null, hora: cupom.hora || null,
      desconto: cupom.desconto || null, itens: (cupom.itens || []).slice(0, 200), lido_em: new Date().toISOString(),
    },
    avisos, confiavel,
  };
}

export const PAGAMENTO_LABEL = {
  credito: 'Crédito', debito: 'Débito', pix: 'Pix', dinheiro: 'Dinheiro',
  vale_alimentacao: 'Vale-alimentação', vale_refeicao: 'Vale-refeição', outro: 'Outro', nao_identificado: 'Não identificado',
};

/** Cupom de exemplo para o modo demonstração */
export function demoReceipt(qr) {
  const itens = [
    ['Leite integral 1L', 6, 35.94], ['Pão de forma integral', 1, 11.49], ['Banana prata (kg)', 1.25, 8.74],
    ['Café torrado 500g', 1, 22.9], ['Queijo muçarela fatiado', 0.3, 17.97], ['Detergente 500ml', 3, 8.37],
    ['Arroz tipo 1 5kg', 1, 27.9], ['Iogurte natural', 4, 15.96], ['Tomate (kg)', 0.8, 7.19], ['Papel toalha', 1, 9.99],
  ].map(([descricao, quantidade, valor_total]) => ({ descricao, quantidade, valor_total }));
  const total = Math.round(itens.reduce((s, i) => s + i.valor_total, 0) * 100) / 100;
  return {
    simulado: true, legivel: true, tipo_documento: 'nfce', estabelecimento: 'Pão de Açúcar', razao_social: 'Companhia Brasileira de Distribuição',
    cnpj: qr?.cnpj || '47508411000156', data: L.today(), hora: '18:42', valor_total: qr?.offline?.valor || total, desconto: null,
    forma_pagamento: 'vale_alimentacao', final_cartao: null, parcelas: null, chave_acesso: qr?.chave || null, itens,
    categoria_sugerida: 'Mercado', observacao: null,
  };
}
