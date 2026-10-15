import { useId, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { APOIO, DIRECAO, REALIZACAO } from '../formato';
import { Campo, ErroCaixa, useToast } from './ui';

export interface Nivel { valor: number; descricao: string }
export interface Indicador {
  id: string; chave: string; nome: string; descricao: string | null; tipo: string; observacao_obrigatoria: boolean;
  escala_versao_id: string; versao: number; minimo: number; maximo: number; direcao: string; niveis: Nivel[]; ativo: boolean;
}
export interface Atividade { id: string; nome: string; categoria: string; descricao: string | null; ativo: boolean; padrao?: boolean; indicadores_recomendados: string[] }

export interface Avaliacao { valor: number | null; observacao: string }
export interface Conteudo {
  participacao: string | null;
  nivel_apoio: string | null;
  atividades: Record<string, string | null>;    // atividade_id -> realização
  avaliacoes: Record<string, Avaliacao>;
  texto_evolucao: string;
  comportamentos: string;
  interacao: string;
  resposta_orientacoes: string;
  apoios_estrategias: string;
  ocorrencias: string;
  observacoes_complementares: string;
}

export const CAMPOS_TEXTO: { chave: keyof Conteudo; rotulo: string }[] = [
  { chave: 'comportamentos', rotulo: 'Comportamentos relevantes observados' },
  { chave: 'interacao', rotulo: 'Interação com outros assistidos e profissionais' },
  { chave: 'resposta_orientacoes', rotulo: 'Resposta às orientações e aos estímulos' },
  { chave: 'apoios_estrategias', rotulo: 'Apoios ou estratégias utilizados' },
  { chave: 'ocorrencias', rotulo: 'Ocorrências importantes' },
  { chave: 'observacoes_complementares', rotulo: 'Observações complementares' },
];

export const ORIENTACAO_EVOLUCAO = 'Descreva o comportamento observado, a participação nas atividades, as respostas às orientações, as interações sociais, as dificuldades, as conquistas, o nível de apoio necessário e outros acontecimentos relevantes. Registre fatos observáveis e evite interpretações sem fundamento.';

export function conteudoVazio(): Conteudo {
  return { participacao: null, nivel_apoio: null, atividades: {}, avaliacoes: {}, texto_evolucao: '', comportamentos: '', interacao: '',
    resposta_orientacoes: '', apoios_estrategias: '', ocorrencias: '', observacoes_complementares: '' };
}

export function conteudoDeRegistro(r: any): Conteudo {
  const c = conteudoVazio();
  c.participacao = r.participacao ?? null;
  c.nivel_apoio = r.nivel_apoio ?? null;
  for (const a of r.atividades ?? []) c.atividades[a.atividade_id] = a.realizacao ?? null;
  for (const a of r.avaliacoes ?? []) c.avaliacoes[a.indicador_id] = { valor: a.valor, observacao: a.observacao ?? '' };
  for (const k of ['texto_evolucao', ...CAMPOS_TEXTO.map((x) => x.chave)] as const) (c as any)[k] = r[k] ?? '';
  return c;
}

export function conteudoParaPayload(c: Conteudo) {
  return {
    participacao: c.participacao, nivel_apoio: c.nivel_apoio,
    atividades: Object.entries(c.atividades).map(([atividade_id, realizacao]) => ({ atividade_id, realizacao })),
    avaliacoes: Object.entries(c.avaliacoes)
      .filter(([, a]) => a.valor !== null || a.observacao.trim())
      .map(([indicador_id, a]) => ({ indicador_id, valor: a.valor, observacao: a.observacao.trim() || null })),
    texto_evolucao: c.texto_evolucao, comportamentos: c.comportamentos, interacao: c.interacao,
    resposta_orientacoes: c.resposta_orientacoes, apoios_estrategias: c.apoios_estrategias, ocorrencias: c.ocorrencias,
    observacoes_complementares: c.observacoes_complementares,
  };
}

// ---------------------------------------------------------------------------
// Escala 0–5 com "Não avaliado"
// ---------------------------------------------------------------------------
export function EscalaIndicador({ ind, valor, onChange, versaoRegistrada, erro }: {
  ind: Indicador; valor: Avaliacao | undefined; onChange: (a: Avaliacao) => void;
  versaoRegistrada?: { versao: number; minimo: number; maximo: number; niveis: Nivel[] }; erro?: string;
}) {
  const nome = useId();
  const esc = versaoRegistrada ?? ind;
  const atual = valor ?? { valor: null, observacao: '' };
  const [verObs, setVerObs] = useState(!!atual.observacao || ind.observacao_obrigatoria);
  const nivel = atual.valor === null ? null : esc.niveis.find((n) => n.valor === atual.valor);
  const valores = Array.from({ length: esc.maximo - esc.minimo + 1 }, (_, i) => esc.minimo + i);
  return (
    <fieldset className="indicador">
      <legend className="sr-only">{ind.nome}</legend>
      <div className="indicador-cab">
        <span className="negrito" aria-hidden>{ind.nome}</span>
        <span className="valor-sel" aria-live="polite">{atual.valor === null ? 'Não avaliado' : `${atual.valor} — ${nivel?.descricao ?? ''}`}</span>
      </div>
      <div className="mudo pequeno">{DIRECAO[ind.direcao]}{versaoRegistrada && versaoRegistrada.versao !== ind.versao ? ` · escala v${versaoRegistrada.versao} (registro original)` : ''}</div>
      <div className="escala">
        <label className="nao-av">
          <input type="radio" name={nome} checked={atual.valor === null} onChange={() => onChange({ ...atual, valor: null })} />
          <span>Não avaliado</span>
        </label>
        {valores.map((v) => {
          const d = esc.niveis.find((n) => n.valor === v)?.descricao ?? '';
          return (
            <label key={v} title={d}>
              <input type="radio" name={nome} checked={atual.valor === v} onChange={() => onChange({ ...atual, valor: v })} aria-label={`${v} — ${d}`} />
              <span aria-hidden>{v}</span>
            </label>
          );
        })}
      </div>
      <div className="nivel-desc">{nivel ? nivel.descricao : 'Sem informação suficiente: permanece como "Não avaliado" (não equivale a zero).'}</div>
      {verObs ? (
        <Campo rotulo={`Observação sobre ${ind.nome.toLowerCase()}${ind.observacao_obrigatoria ? ' (obrigatória quando avaliado)' : ''}`} erro={erro}>
          {(p) => <textarea {...p} style={{ minHeight: 70 }} value={atual.observacao} onChange={(e) => onChange({ ...atual, observacao: e.target.value })} />}
        </Campo>
      ) : (
        <button type="button" className="btn-link" onClick={() => setVerObs(true)}>+ Adicionar observação</button>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Seções do registro
// ---------------------------------------------------------------------------
export function SecaoAtividades({ atividades, conteudo, setConteudo, onNovaAtividade, mostrarRealizacao = true, erro }: {
  atividades: Atividade[]; conteudo: Conteudo; setConteudo: (c: Conteudo) => void;
  onNovaAtividade?: (a: Atividade) => void; mostrarRealizacao?: boolean; erro?: string;
}) {
  const { pode } = useAuth();
  const [nova, setNova] = useState<{ nome: string; categoria: string; descricao: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroNova, setErroNova] = useState<unknown>(null);
  const toast = useToast();
  const marcadas = conteudo.atividades;
  const alternar = (id: string) => {
    const n = { ...marcadas };
    if (id in n) delete n[id]; else n[id] = null;
    setConteudo({ ...conteudo, atividades: n });
  };
  const criar = async () => {
    if (!nova) return;
    setSalvando(true); setErroNova(null);
    try {
      const a = await api.post<Atividade>('/atividades', { ...nova, ativo: true });
      onNovaAtividade?.({ ...a, indicadores_recomendados: [] });
      setConteudo({ ...conteudo, atividades: { ...marcadas, [a.id]: null } });
      toast('ok', `Atividade "${a.nome}" adicionada e disponível para os próximos registros.`);
      setNova(null);
    } catch (e) { setErroNova(e); } finally { setSalvando(false); }
  };
  return (
    <div>
      <fieldset>
        <legend>Atividades realizadas <span className="mudo">(selecione uma ou mais)</span></legend>
        <div className="opcoes">
          {atividades.filter((a) => a.ativo || a.id in marcadas).map((a) => (
            <label key={a.id} className="chip">
              <input type="checkbox" checked={a.id in marcadas} onChange={() => alternar(a.id)} />{a.nome}
            </label>
          ))}
        </div>
        {erro && <p className="erro-campo" style={{ marginTop: 6 }}>{erro}</p>}
      </fieldset>
      {mostrarRealizacao && Object.keys(marcadas).length > 0 && (
        <div className="linha-campos">
          {Object.keys(marcadas).map((id) => {
            const a = atividades.find((x) => x.id === id);
            return (
              <Campo key={id} rotulo={`Realização — ${a?.nome ?? 'atividade'}`}>
                {(p) => (
                  <select {...p} value={marcadas[id] ?? ''} onChange={(e) => setConteudo({ ...conteudo, atividades: { ...marcadas, [id]: e.target.value || null } })}>
                    <option value="">Não informado</option>
                    {Object.entries(REALIZACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                )}
              </Campo>
            );
          })}
        </div>
      )}
      {pode('atividades.criar') && (nova ? (
        <div className="cartao" style={{ background: 'var(--azul-50)' }}>
          <h3>Adicionar nova atividade</h3>
          <ErroCaixa erro={erroNova} />
          <div className="linha-campos">
            <Campo rotulo="Nome" obrigatorio>{(p) => <input {...p} type="text" value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} />}</Campo>
            <Campo rotulo="Categoria">{(p) => <input {...p} type="text" value={nova.categoria} onChange={(e) => setNova({ ...nova, categoria: e.target.value })} />}</Campo>
          </div>
          <Campo rotulo="Descrição (opcional)">{(p) => <input {...p} type="text" value={nova.descricao} onChange={(e) => setNova({ ...nova, descricao: e.target.value })} />}</Campo>
          <div className="acoes">
            <button type="button" className="btn" disabled={salvando || nova.nome.trim().length < 2} onClick={criar}>{salvando ? 'Salvando…' : 'Salvar atividade'}</button>
            <button type="button" className="btn sec" onClick={() => setNova(null)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn sec peq" style={{ marginTop: 8 }} onClick={() => setNova({ nome: '', categoria: 'Geral', descricao: '' })}>+ Adicionar nova atividade</button>
      ))}
    </div>
  );
}

export function SecaoIndicadores({ indicadores, conteudo, setConteudo, versoesRegistradas, erros = {} }: {
  indicadores: Indicador[]; conteudo: Conteudo; setConteudo: (c: Conteudo) => void;
  versoesRegistradas?: Record<string, { versao: number; minimo: number; maximo: number; niveis: Nivel[] }>; erros?: Record<string, string>;
}) {
  return (
    <div>
      <p className="mudo pequeno">Pontue somente o que foi observado. “Não avaliado” significa ausência de informação e não é o mesmo que 0.
        A pontuação de comportamentos em monitoramento descreve o período observado, não a pessoa.</p>
      {indicadores.map((ind) => (
        <EscalaIndicador key={ind.id} ind={ind} valor={conteudo.avaliacoes[ind.id]} versaoRegistrada={versoesRegistradas?.[ind.id]}
          erro={erros[`avaliacoes.${ind.id}`]}
          onChange={(a) => setConteudo({ ...conteudo, avaliacoes: { ...conteudo.avaliacoes, [ind.id]: a } })} />
      ))}
    </div>
  );
}

export function SelectApoio({ conteudo, setConteudo }: { conteudo: Conteudo; setConteudo: (c: Conteudo) => void }) {
  return (
    <Campo rotulo="Nível de apoio necessário" ajuda="Conforme definição institucional.">
      {(p) => (
        <select {...p} value={conteudo.nivel_apoio ?? ''} onChange={(e) => setConteudo({ ...conteudo, nivel_apoio: e.target.value || null })}>
          <option value="">Não informado</option>
          {Object.entries(APOIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      )}
    </Campo>
  );
}

export function SecaoTextos({ conteudo, setConteudo, erro, compacto }: {
  conteudo: Conteudo; setConteudo: (c: Conteudo) => void; erro?: string; compacto?: boolean;
}) {
  const [extras, setExtras] = useState(CAMPOS_TEXTO.some((c) => (conteudo as any)[c.chave]));
  return (
    <div>
      <Campo rotulo="Observações do profissional" erro={erro} ajuda="Para finalizar, registre ao menos uma atividade, um comportamento ou uma observação.">
        {(p) => <textarea {...p} className={compacto ? '' : 'amplo'} placeholder={ORIENTACAO_EVOLUCAO} value={conteudo.texto_evolucao}
          onChange={(e) => setConteudo({ ...conteudo, texto_evolucao: e.target.value })} />}
      </Campo>
      {extras ? (
        <div className="grade grade-2" style={{ gap: 0, columnGap: 16 }}>
          {CAMPOS_TEXTO.map((c) => (
            <Campo key={c.chave} rotulo={c.rotulo}>
              {(p) => <textarea {...p} style={{ minHeight: 80 }} value={(conteudo as any)[c.chave]}
                onChange={(e) => setConteudo({ ...conteudo, [c.chave]: e.target.value })} />}
            </Campo>
          ))}
        </div>
      ) : (
        <button type="button" className="btn sec peq" onClick={() => setExtras(true)}>+ Campos complementares (comportamentos, interação, apoios, ocorrências…)</button>
      )}
    </div>
  );
}
