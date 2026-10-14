export class ErroApi extends Error {
  constructor(public status: number, message: string, public detalhes?: { campo: string; mensagem: string }[]) {
    super(message);
  }
}

let aoExpirar: (() => void) | null = null;
export function definirAoExpirar(fn: () => void) { aoExpirar = fn; }

async function req<T>(metodo: string, url: string, corpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${url}`, {
      method: metodo,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'reabilita', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new ErroApi(0, 'Sem conexão com o servidor. Verifique a internet e tente novamente.');
  }
  if (r.status === 401 && !url.startsWith('/auth/login')) aoExpirar?.();
  const tipo = r.headers.get('content-type') ?? '';
  const dados = tipo.includes('application/json') ? await r.json() : null;
  if (!r.ok) {
    throw new ErroApi(r.status, dados?.erro ?? `Erro ${r.status}`, Array.isArray(dados?.detalhes) ? dados.detalhes : undefined);
  }
  return dados as T;
}

export const api = {
  get: <T = any>(url: string) => req<T>('GET', url),
  post: <T = any>(url: string, corpo: unknown = {}) => req<T>('POST', url, corpo),
  put: <T = any>(url: string, corpo: unknown = {}) => req<T>('PUT', url, corpo),
  del: <T = any>(url: string) => req<T>('DELETE', url),
};

/** Baixa um arquivo autenticado (PDF, CSV, XLSX, JSON). */
export async function baixar(url: string, nomePadrao: string) {
  const r = await fetch(`/api${url}`, { credentials: 'same-origin' });
  if (!r.ok) {
    const d = await r.json().catch(() => null);
    throw new ErroApi(r.status, d?.erro ?? 'Falha ao gerar o arquivo.');
  }
  const blob = await r.blob();
  const nome = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? nomePadrao;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function qs(params: Record<string, string | number | undefined | null | boolean>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
