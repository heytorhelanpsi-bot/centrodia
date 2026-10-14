import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api, ErroApi } from '../api';

// ---------------------------------------------------------------------------
// Estados de carregamento, erro e vazio
// ---------------------------------------------------------------------------
export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return <div className="carregando" role="status"><span className="giro" aria-hidden />{texto}</div>;
}

export function ErroCaixa({ erro, tentar }: { erro: unknown; tentar?: () => void }) {
  if (!erro) return null;
  const e = erro as ErroApi;
  return (
    <div className="aviso erro" role="alert">
      <strong>{e.message || 'Ocorreu um erro.'}</strong>
      {e.detalhes?.length ? <ul>{e.detalhes.map((d, i) => <li key={i}>{d.mensagem}</li>)}</ul> : null}
      {tentar && <div style={{ marginTop: 8 }}><button className="btn sec peq" onClick={tentar}>Tentar novamente</button></div>}
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="vazio">{children}</div>;
}

/** Busca dados com estados de carregamento/erro e recarga. */
export function useCarregar<T>(url: string | null, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [carregando, setCarregando] = useState(!!url);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    if (!url) { setCarregando(false); return; }
    let ativo = true;
    setCarregando(true);
    setErro(null);
    api.get<T>(url).then((d) => { if (ativo) setDados(d); }).catch((e) => { if (ativo) setErro(e); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, versao, ...deps]);
  return { dados, erro, carregando, recarregar: () => setVersao((v) => v + 1), setDados };
}

// ---------------------------------------------------------------------------
// Notificações (toasts) — anunciadas a leitores de tela
// ---------------------------------------------------------------------------
type Toast = { id: number; tipo: 'ok' | 'erro' | 'info'; texto: string };
const ToastCtx = createContext<(tipo: Toast['tipo'], texto: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([]);
  const mostrar = useCallback((tipo: Toast['tipo'], texto: string) => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l, { id, tipo, texto }]);
    setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), tipo === 'erro' ? 8000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={mostrar}>
      {children}
      <div className="toast-area" aria-live="polite" aria-atomic="false">
        {lista.map((t) => (
          <div key={t.id} className={`toast ${t.tipo}`} role={t.tipo === 'erro' ? 'alert' : 'status'}>
            <span aria-hidden>{t.tipo === 'ok' ? '✓' : t.tipo === 'erro' ? '⚠' : 'ℹ'}</span>{t.texto}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------------------
// Diálogo de confirmação
// ---------------------------------------------------------------------------
interface ConfirmarOpts { titulo: string; texto: ReactNode; confirmar?: string; perigo?: boolean }
const ConfirmCtx = createContext<(o: ConfirmarOpts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [opts, setOpts] = useState<ConfirmarOpts | null>(null);
  const resolver = useRef<(v: boolean) => void>();
  const confirmar = useCallback((o: ConfirmarOpts) => {
    setOpts(o);
    setTimeout(() => ref.current?.showModal(), 0);
    return new Promise<boolean>((res) => { resolver.current = res; });
  }, []);
  const fechar = (v: boolean) => { ref.current?.close(); resolver.current?.(v); setOpts(null); };
  return (
    <ConfirmCtx.Provider value={confirmar}>
      {children}
      <dialog ref={ref} onCancel={(e) => { e.preventDefault(); fechar(false); }} aria-labelledby="dlg-titulo">
        {opts && (
          <div className="dialogo">
            <h2 id="dlg-titulo">{opts.titulo}</h2>
            <div>{opts.texto}</div>
            <div className="acoes">
              <button className="btn sec" onClick={() => fechar(false)} autoFocus>Cancelar</button>
              <button className={`btn ${opts.perigo ? 'perigo' : ''}`} onClick={() => fechar(true)}>{opts.confirmar ?? 'Confirmar'}</button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmCtx.Provider>
  );
}
export const useConfirmar = () => useContext(ConfirmCtx);

// ---------------------------------------------------------------------------
// Campos de formulário (rótulos explícitos e erros associados)
// ---------------------------------------------------------------------------
export function Campo({ rotulo, ajuda, erro, children, obrigatorio }: {
  rotulo: string; ajuda?: ReactNode; erro?: string | null; obrigatorio?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const desc = [ajuda ? `${id}-ajuda` : null, erro ? `${id}-erro` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}{obrigatorio && <span aria-hidden style={{ color: 'var(--vermelho-700)' }}> *</span>}</label>
      {children({ id, 'aria-describedby': desc, 'aria-invalid': erro ? true : undefined })}
      {ajuda && <span className="ajuda" id={`${id}-ajuda`}>{ajuda}</span>}
      {erro && <span className="erro-campo" id={`${id}-erro`}>{erro}</span>}
    </div>
  );
}

export function errosPorCampo(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of (e as ErroApi)?.detalhes ?? []) out[d.campo] ??= d.mensagem;
  return out;
}

// ---------------------------------------------------------------------------
// Abas acessíveis
// ---------------------------------------------------------------------------
export function Abas<T extends string>({ abas, atual, onChange, rotulo }: {
  abas: { id: T; rotulo: string }[]; atual: T; onChange: (t: T) => void; rotulo: string;
}) {
  return (
    <div className="abas" role="tablist" aria-label={rotulo}>
      {abas.map((a) => (
        <button key={a.id} role="tab" aria-selected={a.id === atual} onClick={() => onChange(a.id)}>{a.rotulo}</button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Renderização segura de Markdown simples (sem HTML arbitrário)
// ---------------------------------------------------------------------------
function inline(t: string): ReactNode[] {
  const partes = t.split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
  return partes.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^_[^_]+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    return p;
  });
}

export function Markdown({ texto }: { texto: string }) {
  const blocos: ReactNode[] = [];
  let lista: string[] = [];
  const fecharLista = () => {
    if (lista.length) blocos.push(<ul key={`l${blocos.length}`}>{lista.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    lista = [];
  };
  texto.split('\n').forEach((linha, i) => {
    const l = linha.trimEnd();
    if (/^\s*[-*] /.test(l)) { lista.push(l.replace(/^\s*[-*] /, '')); return; }
    fecharLista();
    if (l.startsWith('# ')) blocos.push(<h1 key={i}>{inline(l.slice(2))}</h1>);
    else if (l.startsWith('## ')) blocos.push(<h2 key={i}>{inline(l.slice(3))}</h2>);
    else if (l.startsWith('### ')) blocos.push(<h3 key={i}>{inline(l.slice(4))}</h3>);
    else if (l === '---') blocos.push(<hr key={i} />);
    else if (l) blocos.push(<p key={i}>{inline(l)}</p>);
  });
  fecharLista();
  return <>{blocos}</>;
}

// ---------------------------------------------------------------------------
// Busca de assistido (reutilizada em vários módulos)
// ---------------------------------------------------------------------------
export interface AssistidoResumo { id: string; codigo: string; nome_completo: string; idade: number; turno_habitual: string; dias_atendimento: number[]; status: string }

export function BuscaAssistido({ valor, onSelecionar, rotulo = 'Assistido', erro, desabilitado }: {
  valor: AssistidoResumo | null; onSelecionar: (a: AssistidoResumo | null) => void; rotulo?: string; erro?: string; desabilitado?: boolean;
}) {
  const [busca, setBusca] = useState('');
  const [res, setRes] = useState<AssistidoResumo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const id = useId();
  useEffect(() => {
    if (valor || busca.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(async () => {
      setCarregando(true);
      try { setRes(await api.get(`/assistidos?busca=${encodeURIComponent(busca)}`)); } catch { setRes([]); } finally { setCarregando(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [busca, valor]);
  if (valor) {
    return (
      <div className="campo">
        <span className="rotulo-campo">{rotulo}</span>
        <div className="aviso info" style={{ marginBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span><strong>{valor.nome_completo}</strong> <span className="mudo">· {valor.codigo} · {valor.idade} anos</span></span>
          {!desabilitado && <button type="button" className="btn sec peq" onClick={() => { onSelecionar(null); setBusca(''); }}>Trocar</button>}
        </div>
      </div>
    );
  }
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo} <span aria-hidden style={{ color: 'var(--vermelho-700)' }}>*</span></label>
      <input id={id} type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite nome ou código (ex.: RB-00012)"
        aria-invalid={erro ? true : undefined} autoComplete="off" aria-describedby={`${id}-r`} />
      <div id={`${id}-r`} aria-live="polite">
        {carregando && <span className="mudo">Buscando…</span>}
        {!carregando && busca.trim().length >= 2 && !res.length && <span className="mudo">Nenhum assistido encontrado.</span>}
      </div>
      {res.length > 0 && (
        <ul className="lista-simples cartao" style={{ padding: '4px 12px', marginTop: 4 }}>
          {res.slice(0, 8).map((a) => (
            <li key={a.id}>
              <span><strong>{a.nome_completo}</strong> <span className="mudo">· {a.codigo} · {a.idade} anos</span></span>
              <button type="button" className="btn peq" onClick={() => onSelecionar(a)}>Selecionar</button>
            </li>
          ))}
        </ul>
      )}
      {erro && <span className="erro-campo">{erro}</span>}
    </div>
  );
}
