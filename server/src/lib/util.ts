import crypto from 'node:crypto';
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public detalhes?: unknown) {
    super(message);
  }
}

/** Normaliza nomes para busca e verificação de duplicidade. */
export function normalizarNome(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Idade em anos completos na data de referência (padrão: hoje). */
export function calcularIdade(dataNascimento: string, referencia: Date = new Date()): number {
  const [a, m, d] = dataNascimento.split('-').map(Number);
  const ra = referencia.getFullYear();
  const rm = referencia.getMonth() + 1;
  const rd = referencia.getDate();
  let idade = ra - a;
  if (rm < m || (rm === m && rd < d)) idade--;
  return idade;
}

export function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function sha256(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}

export function tokenAleatorio(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

// --- Cifragem de campos restritos (AES-256-GCM) ---------------------------
function chave(): Buffer {
  const k = Buffer.from(config.dataEncryptionKey, 'base64');
  if (k.length !== 32) throw new Error('DATA_ENCRYPTION_KEY deve ter 32 bytes em base64');
  return k;
}

export function cifrar(texto: string | null | undefined): string | null {
  if (texto === null || texto === undefined || texto === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const enc = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decifrar(valor: string | null): string | null {
  if (!valor) return null;
  const [v, iv, tag, dados] = valor.split(':');
  if (v !== 'v1') throw new Error('Formato de cifra desconhecido');
  const d = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
}

export const DIAS_SEMANA = ['', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

/** Dia da semana no padrão do sistema (1=segunda … 6=sábado; 0=domingo). */
export function diaSemana(dataISO: string): number {
  const [a, m, d] = dataISO.split('-').map(Number);
  return new Date(a, m - 1, d).getDay();
}
