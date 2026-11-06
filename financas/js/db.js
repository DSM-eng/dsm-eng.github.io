// Camada de dados. Dois modos com a mesma interface:
//  - local: demonstração, tudo salvo no próprio navegador (localStorage)
//  - cloud: Supabase, com login e dados compartilhados pela família

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

const clone = (x) => JSON.parse(JSON.stringify(x));

class LocalBackend {
  constructor(seed, demoReceipt) { this.mode = 'local'; this.seed = seed; this.demoReceipt = demoReceipt; this.key = 'aurora-demo-v1'; this.mem = null; }
  _db() {
    if (!this.mem) {
      const raw = store.get(this.key);
      try { this.mem = raw ? JSON.parse(raw) : null; } catch { this.mem = null; }
      if (!this.mem) { this.mem = this.seed(); this._save(); }
      this._upgrade();
    }
    return this.mem;
  }
  _upgrade() {
    // v1.2: categoria de investimentos
    const d = this.mem;
    if (!d.categories.some((c) => 'is_investment' in c)) {
      d.categories.forEach((c) => { c.is_investment = false; if (c.kind === 'receita' && c.name === 'Investimentos') { c.name = 'Rendimentos'; c.icon = '🪙'; } });
      d.categories.push({ id: uuid(), household_id: d.household.id, name: 'Investimentos', icon: '📈', kind: 'despesa', is_investment: true, monthly_limit: null, archived: false, sort: 15 });
      this._save();
    }
  }
  _save() { store.set(this.key, JSON.stringify(this.mem)); }
  async session() { return { user: { id: this._db().user_id } }; }
  async household() { const d = this._db(); return { household: d.household, members: d.members, userId: d.user_id }; }
  async list(t) { return clone(this._db()[t]); }
  async insert(t, rows) {
    const d = this._db(); const now = new Date().toISOString();
    if (t === 'transactions') {
      const keys = new Set(d.transactions.map((x) => x.receipt_key).filter(Boolean));
      if (rows.some((r) => r.receipt_key && keys.has(r.receipt_key))) throw new Error('Este cupom já foi lançado.');
    }
    const out = rows.map((r) => ({
      id: uuid(), household_id: d.household.id, created_at: now,
      ...(t === 'transactions' ? { created_by: d.user_id, updated_at: now } : {}), ...r,
    }));
    d[t].push(...out); this._save(); return clone(out);
  }
  async update(t, id, patch) {
    const d = this._db(); const r = d[t].find((x) => x.id === id);
    if (!r) throw new Error('Registro não encontrado');
    Object.assign(r, patch); this._save(); return clone(r);
  }
  async remove(t, ids) {
    const d = this._db(); const s = new Set(ids);
    d[t] = d[t].filter((x) => !s.has(x.id));
    if (t === 'accounts') d.transactions = d.transactions.filter((x) => !s.has(x.account_id) && !s.has(x.to_account_id));
    if (t === 'categories') d.transactions.forEach((x) => { if (s.has(x.category_id)) x.category_id = null; });
    this._save();
  }
  async updateMember(name) {
    const d = this._db(); d.members.find((m) => m.user_id === d.user_id).display_name = name; this._save();
  }
  async updateHousehold(patch) { Object.assign(this._db().household, patch); this._save(); }
  async readReceipt(payload) {
    await new Promise((r) => setTimeout(r, 900));
    return { ...this.demoReceipt(payload.qr) };
  }
  switchUser(uid) { this._db().user_id = uid; this._save(); }
  reset() { this.mem = this.seed(); this._save(); }
  subscribe() {}
}

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

class SupabaseBackend {
  constructor(cfg) { this.mode = 'cloud'; this.cfg = cfg; this.cacheKey = 'aurora-cache-v1'; }
  async connect() {
    const { createClient } = await import(SUPABASE_ESM);
    this.sb = createClient(this.cfg.SUPABASE_URL, this.cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  _ok({ data, error }) { if (error) throw new Error(traduz(error.message)); return data; }
  async session() {
    const { data } = await this.sb.auth.getSession();
    this.uid = data.session?.user?.id || null;
    return data.session;
  }
  async signIn(email, password) { this._ok(await this.sb.auth.signInWithPassword({ email, password })); }
  async signUp(email, password) { return this._ok(await this.sb.auth.signUp({ email, password })); }
  async resetPassword(email) { this._ok(await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] })); }
  async signOut() { store.del(this.cacheKey); await this.sb.auth.signOut(); }
  async household() {
    const mem = this._ok(await this.sb.from('household_members').select('household_id').eq('user_id', this.uid).limit(1));
    if (!mem.length) return null;
    this.hid = mem[0].household_id;
    const [hr, mr] = await Promise.all([
      this.sb.from('households').select('*').eq('id', this.hid).single(),
      this.sb.from('household_members').select('*').eq('household_id', this.hid),
    ]);
    const h = this._ok(hr); const members = this._ok(mr);
    return { household: h, members, userId: this.uid };
  }
  async createHousehold(name, displayName) {
    return this._ok(await this.sb.rpc('create_household', { p_name: name, p_display_name: displayName }));
  }
  async joinHousehold(code, displayName) {
    return this._ok(await this.sb.rpc('join_household', { p_code: code, p_display_name: displayName }));
  }
  async list(t) {
    const all = []; const step = 1000;
    for (let from = 0; ; from += step) {
      const rows = this._ok(await this.sb.from(t).select('*').eq('household_id', this.hid).order('id').range(from, from + step - 1));
      all.push(...rows);
      if (rows.length < step) break;
    }
    return all;
  }
  async insert(t, rows) {
    return this._ok(await this.sb.from(t).insert(rows.map((r) => ({ ...r, household_id: this.hid }))).select());
  }
  async update(t, id, patch) { return this._ok(await this.sb.from(t).update(patch).eq('id', id).select().single()); }
  async remove(t, ids) { this._ok(await this.sb.from(t).delete().in('id', ids)); }
  async updateMember(name) {
    this._ok(await this.sb.from('household_members').update({ display_name: name }).eq('household_id', this.hid).eq('user_id', this.uid));
  }
  async updateHousehold(patch) { this._ok(await this.sb.from('households').update(patch).eq('id', this.hid)); }
  async readReceipt(payload) {
    const { qr, ...body } = payload;
    const { data, error } = await this.sb.functions.invoke('ler-cupom', { body });
    if (error) {
      let msg = null;
      try { msg = (await error.context?.json())?.error; } catch { /* sem corpo */ }
      throw new Error(msg || (String(error.message).includes('Failed to send') ? 'Sem conexão para ler o cupom.' : 'A leitura de cupom não está disponível. Veja o passo 4 do README.'));
    }
    return data.cupom;
  }
  subscribe(cb) {
    this.sb.channel('tx-' + this.hid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `household_id=eq.${this.hid}` }, cb)
      .subscribe();
  }
  saveCache(data) { store.set(this.cacheKey, JSON.stringify(data)); }
  loadCache() { try { return JSON.parse(store.get(this.cacheKey)); } catch { return null; } }
}

function traduz(msg = '') {
  const map = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'Email not confirmed': 'Confirme seu e-mail pelo link que enviamos antes de entrar.',
    'User already registered': 'Este e-mail já tem cadastro. Use "Entrar".',
    'Password should be at least 6 characters': 'A senha precisa ter pelo menos 6 caracteres.',
    'Failed to fetch': 'Sem conexão com o servidor. Verifique a internet.',
    'transactions_receipt_key_uidx': 'Este cupom já foi lançado.',
  };
  for (const k in map) if (msg.includes(k)) return map[k];
  return msg;
}

export async function createBackend(cfg, seed, demoReceipt) {
  if (cfg?.SUPABASE_URL && cfg?.SUPABASE_ANON_KEY) {
    const b = new SupabaseBackend(cfg);
    await b.connect();
    return b;
  }
  return new LocalBackend(seed, demoReceipt);
}
