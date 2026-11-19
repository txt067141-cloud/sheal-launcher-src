/**
 * Sistema de cuentas propio de SHEAL LAUNCHER.
 * Las cuentas se guardan localmente (en localStorage, que en Electron vive
 * en el perfil de la app). Las contraseñas se derivan con PBKDF2-SHA-256.
 */
export type Account = {
  id: string;
  username: string;
  email: string;
  salt: string;
  hash: string;
  uuid: string;
  createdAt: number;
};

type SessionRecord = { token: string; accountId: string; expires: number };
type Store = { accounts: Account[]; sessions: SessionRecord[] };

const KEY = "sheal_launcher_accounts_v1";
const SESSION_DAYS = 30;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { accounts: [], sessions: [] };
    const parsed = JSON.parse(raw) as Store;
    return { accounts: parsed.accounts || [], sessions: parsed.sessions || [] };
  } catch {
    return { accounts: [], sessions: [] };
  }
}

function writeStore(store: Store) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function makeUuid() {
  const h = randomHex(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
}

async function derive(password: string, salt: string): Promise<string> {
  try {
    if (globalThis.crypto?.subtle) {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: enc.encode(salt), iterations: 120000, hash: "SHA-256" },
        key,
        256,
      );
      return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    /* fallback abajo */
  }
  // Fallback para contextos sin Web Crypto (no criptográficamente seguro).
  let h = 2166136261;
  const text = salt + password;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0").repeat(8);
}

export type AuthResult = { ok: boolean; error?: string; token?: string; account?: PublicAccount };
export type PublicAccount = { id: string; username: string; email: string; uuid: string; createdAt: number };

function publicAccount(a: Account): PublicAccount {
  return { id: a.id, username: a.username, email: a.email, uuid: a.uuid, createdAt: a.createdAt };
}

/** Sesión para logins externos (KeyAuth): la clave actúa como token. */
export function createExternalSession(username: string, token: string): PublicAccount {
  const store = readStore();
  const id = `key:${token}`;
  let account = store.accounts.find((item) => item.id === id);
  if (!account) {
    account = {
      id,
      username,
      email: "clave@keyauth.local",
      salt: "",
      hash: "",
      uuid: makeUuid(),
      createdAt: Date.now(),
    };
    store.accounts.push(account);
  } else {
    account.username = username;
  }
  store.sessions = store.sessions.filter((session) => session.token !== token);
  store.sessions.push({ token, accountId: id, expires: Date.now() + SESSION_DAYS * 86400000 });
  writeStore(store);
  return publicAccount(account);
}

export function listAccounts(): PublicAccount[] {
  return readStore().accounts.map(publicAccount);
}

export async function register(input: {
  username: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  const username = input.username.trim();
  const email = input.email.trim().toLowerCase();
  if (username.length < 3) return { ok: false, error: "El usuario debe tener al menos 3 caracteres." };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: "Introduce un correo válido." };
  if (input.password.length < 6) return { ok: false, error: "La contraseña debe tener al menos 6 caracteres." };

  const store = readStore();
  if (store.accounts.some((a) => a.email === email)) {
    return { ok: false, error: "Ya existe una cuenta con ese correo." };
  }
  if (store.accounts.some((a) => a.username.toLowerCase() === username.toLowerCase())) {
    return { ok: false, error: "Ese nombre de usuario ya está en uso." };
  }

  const salt = randomHex(16);
  const account: Account = {
    id: randomHex(8),
    username,
    email,
    salt,
    hash: await derive(input.password, salt),
    uuid: makeUuid(),
    createdAt: Date.now(),
  };
  const token = randomHex(24);
  store.accounts.push(account);
  store.sessions.push({ token, accountId: account.id, expires: Date.now() + SESSION_DAYS * 86400000 });
  writeStore(store);
  return { ok: true, token, account: publicAccount(account) };
}

export async function login(input: { email: string; password: string }): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const store = readStore();
  const account = store.accounts.find((a) => a.email === email || a.username.toLowerCase() === email);
  if (!account) return { ok: false, error: "No existe una cuenta con ese correo o usuario." };
  const hash = await derive(input.password, account.salt);
  if (hash !== account.hash) return { ok: false, error: "Contraseña incorrecta." };

  const token = randomHex(24);
  store.sessions = store.sessions.filter((s) => s.expires > Date.now());
  store.sessions.push({ token, accountId: account.id, expires: Date.now() + SESSION_DAYS * 86400000 });
  writeStore(store);
  return { ok: true, token, account: publicAccount(account) };
}

/** Verificación síncrona de la sesión guardada. */
export function verifySession(token?: string): PublicAccount | null {
  if (!token) return null;
  const store = readStore();
  const session = store.sessions.find((s) => s.token === token && s.expires > Date.now());
  if (!session) return null;
  const account = store.accounts.find((a) => a.id === session.accountId);
  return account ? publicAccount(account) : null;
}

export function logout(token?: string) {
  if (!token) return;
  const store = readStore();
  store.sessions = store.sessions.filter((s) => s.token !== token);
  writeStore(store);
}

export async function changePassword(input: {
  email: string;
  current: string;
  next: string;
}): Promise<AuthResult> {
  const store = readStore();
  const account = store.accounts.find((a) => a.email === input.email.trim().toLowerCase());
  if (!account) return { ok: false, error: "Cuenta no encontrada." };
  if ((await derive(input.current, account.salt)) !== account.hash) {
    return { ok: false, error: "La contraseña actual es incorrecta." };
  }
  if (input.next.length < 6) return { ok: false, error: "La nueva contraseña debe tener al menos 6 caracteres." };
  account.salt = randomHex(16);
  account.hash = await derive(input.next, account.salt);
  writeStore(store);
  return { ok: true, account: publicAccount(account) };
}

export function deleteAccount(email: string, passwordHashCheck: () => boolean): AuthResult {
  const store = readStore();
  const account = store.accounts.find((a) => a.email === email.trim().toLowerCase());
  if (!account || !passwordHashCheck()) return { ok: false, error: "No se pudo verificar la cuenta." };
  store.accounts = store.accounts.filter((a) => a.id !== account.id);
  store.sessions = store.sessions.filter((s) => s.accountId !== account.id);
  writeStore(store);
  return { ok: true };
}
