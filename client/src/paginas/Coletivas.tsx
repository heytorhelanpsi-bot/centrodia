import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { APOIO, PARTICIPACAO, TURNOS, data, dataHora, diasAtras, hojeISO, turnoAtual } from '../formato';
import { BuscaAssistido, Campo, Carregando, ErroCaixa, errosPorCampo, useCarregar, useConfirmar, useToast, Vazio, type AssistidoResumo } from '../componentes/ui';
import {
  conteudoDeRegistro, conteudoParaPayload, conteudoVazio, EscalaIndicador, SecaoIndicadores, SecaoTextos, SelectApoio,
  type Atividade, type Avaliacao, type Conteudo, type Indicador,
} from '../componentes/registro';
import { EtiquetaStatus } from './Assistidos';

export function Coletivas() {
  const { pode } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ inicio: diasAtras(30), fim: hojeISO(), turno: '', status: 'todos' });
  const { dados, erro, carregando, recarregar } = useCarregar<any[]>(`/coletivas${qs(f)}`);
  return (
    <>
      <div className="cab-pagina">
        <div><h1>Atendimentos em grupo</h1><p className="sub">Registre a atividade uma vez e documente a evolução específica de cada participante.</p></div>
        {pode('coletivas.registrar') && <Link className="btn verde grande" to="/grupos/novo">+ Nova atividade em grupo</Link>}
      </div>
      <div className="cartao"><div className="linha-campos">
        <Campo rotulo="De">{(p) => <input {...p} type="date" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} />}</Campo>
        <Campo rotulo="Até">{(p) => <input {...p} type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} />}</Campo>
        <Campo rotulo="Turno">{(p) => <select {...p} value={f.turno} onChange={(e) => setF({ ...f, turno: e.target.value })}><option value="">Todos</option><option value="manha">Manhã</option><option value="tarde">Tarde</option></select>}</Campo>
        <Campo rotulo="Situação">{(p) => <select {...p} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="todos">Todas</option><option value="rascunho">Rascunhos</option><option value="finalizada">Finalizadas</option></select>}</Campo>
      </div></div>
      <ErroCaixa erro={erro} tentar={recarregar} />
      {carregando && !dados ? <Carregando /> : dados && (
        <div className="cartao">
          {!dados.length ? <Vazio>Nenhuma atividade em grupo no período.</Vazio> : (
            <div className="tabela-wrap"><table>
              <thead><tr><th>Data</th><th>Atividade</th><th>Turno</th><th>Responsável</th><th>Participantes*</th><th>Situação</th></tr></thead>
              <tbody>{dados.map((c) => (
                <tr key={c.id} className="clicavel" onClick={() => nav(`/grupos/${c.id}`)}>
                  <td>{data(c.data)}</td><td><Link to={`/grupos/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.nome_atividade}</Link></td>
                  <td>{TURNOS[c.turno]}</td><td>{c.profissional_nome}</td>
                  <td>{c.participantes_visiveis}{c.ausentes_visiveis ? ` (+${c.ausentes_visiveis} ausente)` : ''}</td><td><EtiquetaStatus s={c.status} /></td>
                </tr>))}</tbody>
            </table></div>
          )}
          <p className="mudo pequeno">* Contagem apenas dos participantes aos quais você tem acesso.</p>
        </div>
      )}
    </>
  );
}

interface Participante {
  assistido: AssistidoResumo;
  situacao: 'participante' | 'previsto_ausente';
  motivo_ausencia: string;
  revisado: boolean;
  conteudo: Conteudo;
  aplicadoEmLote?: boolean;
}

export function ColetivaForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const confirmar = useConfirmar();
  const ind = useCarregar<Indicador[]>('/indicadores');
  const ativ = useCarregar<Atividade[]>('/atividades');
  const existente = useCarregar<any>(id ? `/coletivas/${id}` : null);
  const [g, setG] = useState({ data: hojeISO(), horario: '', turno: turnoAtual() as string, atividade_id: '', nome_atividade: '', local: '', objetivo: '', descricao_proposta: '', observacoes_gerais: '' });
  const [parts, setParts] = useState<Participante[]>([]);
  const [erro, setErro] = useState<unknown>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  useEffect(() => {
    const c = existente.dados;
    if (!c) return;
    setG({ data: c.data, horario: c.horario ?? '', turno: c.turno, atividade_id: c.atividade_id ?? '', nome_atividade: c.nome_atividade, local: c.local ?? '',
      objetivo: c.objetivo ?? '', descricao_proposta: c.descricao_proposta ?? '', observacoes_gerais: c.observacoes_gerais ?? '' });
    setParts(c.participantes.map((p: any) => ({
      assistido: { id: p.assistido_id, nome_completo: p.nome_completo, codigo: p.codigo, idade: 0, turno_habitual: '', dias_atendimento: [], status: 'ativo' },
      situacao: p.situacao, motivo_ausencia: p.motivo_ausencia ?? '', revisado: false,
      conteudo: p.registro ? conteudoDeRegistro(p.registro) : { ...conteudoVazio(), participacao: 'integral' },
    })));
  }, [existente.dados]);

  if (existente.dados?.status === 'finalizada') return <div className="aviso info">Atividade já finalizada. <Link to={`/grupos/${id}`}>Ver registro</Link></div>;
  if (ind.carregando || ativ.carregando || (id && existente.carregando)) return <Carregando />;
  if (ind.erro || ativ.erro || existente.erro) return <ErroCaixa erro={ind.erro || ativ.erro || existente.erro} />;

  const erros = errosPorCampo(erro);
  const indicadores = (ind.dados ?? []).filter((i) => i.ativo);
  const adicionar = (lista: AssistidoResumo[]) => {
    const ja = new Set(parts.map((p) => p.assistido.id));
    setParts([...parts, ...lista.filter((a) => !ja.has(a.id)).map((a) => ({
      assistido: a, situacao: 'participante' as const, motivo_ausencia: '', revisado: false, conteudo: { ...conteudoVazio(), participacao: 'integral' },
    }))]);
  };
  const atualizar = (i: number, p: Partial<Participante>) => setParts(parts.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const salvar = async (finalizar: boolean) => {
    setSalvando(finalizar ? 'final' : 'rascunho'); setErro(null);
    const corpo = {
      ...g, atividade_id: g.atividade_id || null, finalizar,
      participantes: parts.map((p) => ({
        assistido_id: p.assistido.id, situacao: p.situacao, motivo_ausencia: p.motivo_ausencia || null, revisado: p.revisado,
        registro: p.situacao === 'participante' ? conteudoParaPayload(p.conteudo) : undefined,
      })),
    };
    try {
      const r = id ? await api.put(`/coletivas/${id}`, corpo) : await api.post('/coletivas', corpo);
      if (finalizar) { toast('ok', `Atividade finalizada: ${parts.filter((p) => p.situacao === 'participante').length} registro(s) individual(is) gerado(s).`); nav(`/grupos/${r.id}`); }
      else { toast('ok', 'Rascunho da atividade salvo.'); if (!id) nav(`/grupos/${r.id}/editar`, { replace: true }); }
    } catch (e) { setErro(e); window.scrollTo(0, 0); } finally { setSalvando(null); }
  };

  const presentes = parts.filter((p) => p.situacao === 'participante');
  const erroDe = (aid: string) => (erro as any)?.detalhes?.filter((d: any) => d.campo === `participantes.${aid}`).map((d: any) => d.mensagem) ?? [];

  return (
    <form onSubmit={(e) => { e.preventDefault(); salvar(true); }} noValidate>
      <div className="cab-pagina"><div><h1>{id ? 'Continuar atividade em grupo' : 'Nova atividade em grupo'}</h1>
        <p className="sub">A descrição geral é compartilhada; a evolução e os indicadores ficam vinculados exclusivamente a cada pessoa.</p></div></div>
      <ErroCaixa erro={erro} />

      <details className="secao" open>
        <summary>1. Identificação do grupo</summary>
        <div className="conteudo">
          <div className="linha-campos">
            <Campo rotulo="Atividade (catálogo)">{(p) => (
              <select {...p} value={g.atividade_id} onChange={(e) => {
                const a = ativ.dados?.find((x) => x.id === e.target.value);
                setG({ ...g, atividade_id: e.target.value, nome_atividade: g.nome_atividade || a?.nome || '' });
              }}><option value="">Selecione…</option>{ativ.dados?.filter((a) => a.ativo).map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select>)}</Campo>
            <Campo rotulo="Nome da atividade" obrigatorio erro={erros.nome_atividade}>{(p) => <input {...p} type="text" value={g.nome_atividade} onChange={(e) => setG({ ...g, nome_atividade: e.target.value })} />}</Campo>
          </div>
          <div className="linha-campos">
            <Campo rotulo="Data" obrigatorio>{(p) => <input {...p} type="date" max={hojeISO()} value={g.data} onChange={(e) => setG({ ...g, data: e.target.value })} />}</Campo>
            <Campo rotulo="Horário">{(p) => <input {...p} type="text" placeholder="Ex.: 14h–15h" value={g.horario} onChange={(e) => setG({ ...g, horario: e.target.value })} />}</Campo>
            <Campo rotulo="Turno" obrigatorio>{(p) => <select {...p} value={g.turno} onChange={(e) => setG({ ...g, turno: e.target.value })}><option value="manha">Manhã</option><option value="tarde">Tarde</option></select>}</Campo>
            <Campo rotulo="Local">{(p) => <input {...p} type="text" value={g.local} onChange={(e) => setG({ ...g, local: e.target.value })} />}</Campo>
          </div>
          <Campo rotulo="Objetivo da atividade">{(p) => <textarea {...p} style={{ minHeight: 70 }} value={g.objetivo} onChange={(e) => setG({ ...g, objetivo: e.target.value })} />}</Campo>
          <Campo rotulo="Descrição do que foi proposto">{(p) => <textarea {...p} style={{ minHeight: 80 }} value={g.descricao_proposta} onChange={(e) => setG({ ...g, descricao_proposta: e.target.value })} />}</Campo>
          <Campo rotulo="Observações gerais do grupo" ajuda="Não registre aqui informações individuais.">{(p) => <textarea {...p} style={{ minHeight: 70 }} value={g.observacoes_gerais} onChange={(e) => setG({ ...g, observacoes_gerais: e.target.value })} />}</Campo>
        </div>
      </details>

      <details className="secao" open>
        <summary>2. Participantes <span className="contador">{presentes.length} presente(s) · {parts.length - presentes.length} ausente(s)</span></summary>
        <div className="conteudo">
          <SelecaoParticipantes data={g.data} turno={g.turno} jaSelecionados={new Set(parts.map((p) => p.assistido.id))} onAdicionar={adicionar} />
          {erros.participantes && <p className="erro-campo">{erros.participantes}</p>}
          {parts.length > 0 && (
            <ul className="lista-simples">
              {parts.map((p, i) => (
                <li key={p.assistido.id}>
                  <span><strong>{p.assistido.nome_completo}</strong> <span className="mudo">· {p.assistido.codigo}</span></span>
                  <span className="acoes">
                    <select aria-label={`Situação de ${p.assistido.nome_completo}`} value={p.situacao} onChange={(e) => atualizar(i, { situacao: e.target.value as any })} style={{ width: 'auto' }}>
                      <option value="participante">Participante</option><option value="previsto_ausente">Previsto, não participou</option>
                    </select>
                    {p.situacao === 'previsto_ausente' && <input type="text" aria-label="Motivo da ausência" placeholder="Motivo (opcional)" value={p.motivo_ausencia} onChange={(e) => atualizar(i, { motivo_ausencia: e.target.value })} style={{ width: 200 }} />}
                    <button type="button" className="btn perigo peq" onClick={() => setParts(parts.filter((_, j) => j !== i))}>Remover</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      {presentes.length > 1 && <AvaliacaoComum indicadores={indicadores} participantes={presentes} onAplicar={(alvos, base) => {
        setParts(parts.map((p) => alvos.includes(p.assistido.id) ? {
          ...p, revisado: false, aplicadoEmLote: true,
          conteudo: { ...p.conteudo, participacao: base.participacao ?? p.conteudo.participacao, nivel_apoio: base.nivel_apoio ?? p.conteudo.nivel_apoio,
            avaliacoes: { ...p.conteudo.avaliacoes, ...base.avaliacoes } },
        } : p));
        toast('info', `Avaliação aplicada a ${alvos.length} participante(s). Revise e confirme cada registro individualmente.`);
      }} />}

      {presentes.length > 0 && (
        <section aria-labelledby="t-indiv">
          <h2 id="t-indiv" style={{ marginTop: 8 }}>3. Registro individual de cada participante</h2>
          <p className="mudo pequeno">Cada pessoa tem seu próprio registro, baseado no que foi efetivamente observado. Evoluções idênticas não são aceitas.</p>
          {parts.map((p, i) => p.situacao !== 'participante' ? null : (
            <details key={p.assistido.id} className="participante" open={!p.revisado}>
              <summary>
                <span>{p.assistido.nome_completo}</span>
                <span className="acoes">
                  {p.aplicadoEmLote && !p.revisado && <span className="tag ambar">Avaliação comum aplicada — revisar</span>}
                  {p.revisado ? <span className="tag verde">✓ Revisado</span> : <span className="tag">Pendente de revisão</span>}
                </span>
              </summary>
              <div className="conteudo">
                {erroDe(p.assistido.id).length > 0 && <div className="aviso erro"><ul>{erroDe(p.assistido.id).map((m: string, k: number) => <li key={k}>{m}</li>)}</ul></div>}
                <div className="linha-campos">
                  <Campo rotulo="Participação" obrigatorio>{(x) => (
                    <select {...x} value={p.conteudo.participacao ?? ''} onChange={(e) => atualizar(i, { conteudo: { ...p.conteudo, participacao: e.target.value || null }, revisado: false })}>
                      <option value="">Selecione…</option>{Object.entries(PARTICIPACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>)}</Campo>
                  <SelectApoio conteudo={p.conteudo} setConteudo={(c) => atualizar(i, { conteudo: c, revisado: false })} />
                </div>
                <details className="secao"><summary>Indicadores de 0 a 5 <span className="contador">{Object.values(p.conteudo.avaliacoes).filter((a) => a.valor !== null).length} avaliado(s)</span></summary>
                  <div className="conteudo"><SecaoIndicadores indicadores={indicadores} conteudo={p.conteudo} setConteudo={(c) => atualizar(i, { conteudo: c, revisado: false })} /></div>
                </details>
                <SecaoTextos compacto conteudo={p.conteudo} setConteudo={(c) => atualizar(i, { conteudo: c, revisado: false })} />
                <label className="chip" style={{ marginTop: 10 }}>
                  <input type="checkbox" checked={p.revisado} onChange={(e) => atualizar(i, { revisado: e.target.checked })} />
                  Revisei e confirmo o registro de {p.assistido.nome_completo.split(' ')[0]}
                </label>
              </div>
            </details>
          ))}
        </section>
      )}

      <div className="barra-acoes">
        <button type="submit" className="btn verde grande" disabled={!!salvando}>{salvando === 'final' ? 'Salvando…' : '✓ Salvar e gerar registros individuais'}</button>
        <button type="button" className="btn sec grande" disabled={!!salvando} onClick={() => salvar(false)}>{salvando === 'rascunho' ? 'Salvando…' : 'Salvar rascunho'}</button>
        <button type="button" className="btn sec grande" onClick={async () => {
          if (await confirmar({ titulo: 'Sair sem salvar?', texto: 'Alterações não salvas serão perdidas.', confirmar: 'Sair', perigo: true })) nav('/grupos');
        }}>Cancelar</button>
      </div>
    </form>
  );
}

function SelecaoParticipantes({ data: dt, turno, jaSelecionados, onAdicionar }: {
  data: string; turno: string; jaSelecionados: Set<string>; onAdicionar: (a: AssistidoResumo[]) => void;
}) {
  const [filtro, setFiltro] = useState({ dia: '', turno: '' });
  const [lista, setLista] = useState<AssistidoResumo[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(false);
  const carregar = async (f = filtro) => {
    setCarregando(true);
    try { setLista(await api.get(`/assistidos${qs({ dia: f.dia, turno: f.turno })}`)); setMarcados(new Set()); } finally { setCarregando(false); }
  };
  const previstos = () => {
    const d = new Date(`${dt}T12:00:00`).getDay();
    const f = { dia: d ? String(d) : '', turno };
    setFiltro(f); carregar(f);
  };
  const disponiveis = (lista ?? []).filter((a) => !jaSelecionados.has(a.id));
  return (
    <div className="cartao" style={{ background: 'var(--cinza-100)', boxShadow: 'none' }}>
      <div className="acoes" style={{ marginBottom: 10 }}>
        <button type="button" className="btn sec" onClick={previstos}>Carregar previstos para {data(dt)} ({TURNOS[turno]})</button>
      </div>
      <div className="linha-campos">
        <Campo rotulo="Filtrar por dia">{(p) => <select {...p} value={filtro.dia} onChange={(e) => setFiltro({ ...filtro, dia: e.target.value })}>
          <option value="">Todos</option>{['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select>}</Campo>
        <Campo rotulo="Filtrar por turno">{(p) => <select {...p} value={filtro.turno} onChange={(e) => setFiltro({ ...filtro, turno: e.target.value })}>
          <option value="">Todos</option><option value="manha">Manhã</option><option value="tarde">Tarde</option></select>}</Campo>
        <div className="campo" style={{ alignSelf: 'end' }}><button type="button" className="btn sec" onClick={() => carregar()}>Listar</button></div>
      </div>
      {carregando && <Carregando />}
      {lista && !carregando && (disponiveis.length ? (
        <>
          <div className="acoes" style={{ marginBottom: 8 }}>
            <button type="button" className="btn-link" onClick={() => setMarcados(new Set(disponiveis.map((a) => a.id)))}>Marcar todos</button>
            <button type="button" className="btn-link" onClick={() => setMarcados(new Set())}>Desmarcar</button>
          </div>
          <div className="opcoes">
            {disponiveis.map((a) => (
              <label key={a.id} className="chip"><input type="checkbox" checked={marcados.has(a.id)}
                onChange={(e) => { const n = new Set(marcados); if (e.target.checked) n.add(a.id); else n.delete(a.id); setMarcados(n); }} />{a.nome_completo}</label>
            ))}
          </div>
          <button type="button" className="btn" style={{ marginTop: 10 }} disabled={!marcados.size}
            onClick={() => { onAdicionar(disponiveis.filter((a) => marcados.has(a.id))); setMarcados(new Set()); }}>Adicionar {marcados.size} selecionado(s)</button>
        </>
      ) : <p className="mudo">Nenhum assistido disponível com esses filtros.</p>)}
      <div style={{ marginTop: 12 }}>
        <BuscaAssistido valor={null} rotulo="Ou pesquise um assistido" onSelecionar={(a) => a && onAdicionar([a])} />
      </div>
    </div>
  );
}

function AvaliacaoComum({ indicadores, participantes, onAplicar }: {
  indicadores: Indicador[]; participantes: Participante[];
  onAplicar: (alvos: string[], base: { participacao: string | null; nivel_apoio: string | null; avaliacoes: Record<string, Avaliacao> }) => void;
}) {
  const [base, setBase] = useState<Conteudo>(conteudoVazio());
  const [alvos, setAlvos] = useState<Set<string>>(new Set());
  return (
    <details className="secao">
      <summary>Aplicar avaliação comum a vários participantes (opcional)</summary>
      <div className="conteudo">
        <p className="aviso atencao pequeno">Aplica participação, nível de apoio e pontuações selecionadas aos participantes marcados.
          A evolução escrita nunca é copiada, e cada registro precisa ser revisado e confirmado individualmente antes de salvar.</p>
        <div className="linha-campos">
          <Campo rotulo="Participação">{(p) => <select {...p} value={base.participacao ?? ''} onChange={(e) => setBase({ ...base, participacao: e.target.value || null })}>
            <option value="">Não aplicar</option>{Object.entries(PARTICIPACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Campo>
          <Campo rotulo="Nível de apoio">{(p) => <select {...p} value={base.nivel_apoio ?? ''} onChange={(e) => setBase({ ...base, nivel_apoio: e.target.value || null })}>
            <option value="">Não aplicar</option>{Object.entries(APOIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Campo>
        </div>
        {indicadores.map((i) => <EscalaIndicador key={i.id} ind={i} valor={base.avaliacoes[i.id]} onChange={(a) => setBase({ ...base, avaliacoes: { ...base.avaliacoes, [i.id]: { valor: a.valor, observacao: '' } } })} />)}
        <fieldset><legend>Aplicar a</legend><div className="opcoes">
          {participantes.map((p) => <label key={p.assistido.id} className="chip"><input type="checkbox" checked={alvos.has(p.assistido.id)}
            onChange={(e) => { const n = new Set(alvos); if (e.target.checked) n.add(p.assistido.id); else n.delete(p.assistido.id); setAlvos(n); }} />{p.assistido.nome_completo}</label>)}
        </div></fieldset>
        <button type="button" className="btn sec" disabled={!alvos.size} onClick={() => {
          const avs = Object.fromEntries(Object.entries(base.avaliacoes).filter(([, a]) => a.valor !== null));
          onAplicar([...alvos], { participacao: base.participacao, nivel_apoio: base.nivel_apoio, avaliacoes: avs });
          setAlvos(new Set());
        }}>Aplicar e marcar para revisão</button>
      </div>
    </details>
  );
}

export function ColetivaDetalhe() {
  const { id } = useParams();
  const { usuario, pode } = useAuth();
  const { dados: c, erro, carregando } = useCarregar<any>(`/coletivas/${id}`);
  if (carregando) return <Carregando />;
  if (erro) return <ErroCaixa erro={erro} />;
  if (!c) return null;
  const presentes = c.participantes.filter((p: any) => p.situacao === 'participante');
  const ausentes = c.participantes.filter((p: any) => p.situacao === 'previsto_ausente');
  return (
    <>
      <div className="cab-pagina">
        <div><h1>{c.nome_atividade}</h1><p className="sub">{data(c.data)} · {TURNOS[c.turno]}{c.horario ? ` · ${c.horario}` : ''}{c.local ? ` · ${c.local}` : ''} · {c.profissional_nome}</p></div>
        <div className="acoes">
          <EtiquetaStatus s={c.status} />
          {c.status === 'rascunho' && c.profissional_id === usuario!.id && <Link className="btn" to={`/grupos/${c.id}/editar`}>Continuar registro</Link>}
          {c.status === 'finalizada' && pode('relatorios.elaborar') && <Link className="btn sec" to={`/relatorios/novo?tipo=atividade_grupo&coletiva=${c.id}&data=${c.data}`}>Relatório do grupo</Link>}
        </div>
      </div>
      <div className="cartao">
        <h2>Descrição geral</h2>
        {c.objetivo && <><h3>Objetivo</h3><p className="pre">{c.objetivo}</p></>}
        {c.descricao_proposta && <><h3>Proposta</h3><p className="pre">{c.descricao_proposta}</p></>}
        {c.observacoes_gerais && <><h3>Observações gerais</h3><p className="pre">{c.observacoes_gerais}</p></>}
        <p className="mudo pequeno">Registrado em {dataHora(c.criado_em)}{c.finalizada_em && ` · finalizado em ${dataHora(c.finalizada_em)}`}</p>
      </div>
      <div className="cartao">
        <h2>Registros individuais <span className="contador">{presentes.length}</span></h2>
        {c.registros_visiveis > presentes.length && <p className="mudo pequeno">Há registros de participantes aos quais você não tem acesso.</p>}
        {!presentes.length ? <Vazio>Nenhum participante visível.</Vazio> : (
          <ul className="lista-simples">{presentes.map((p: any) => (
            <li key={p.assistido_id}>
              <span><strong>{p.nome_completo}</strong> {p.registro?.participacao && <span className="tag">{PARTICIPACAO[p.registro.participacao]}</span>}
                <br /><span className="mudo pequeno">{p.registro?.texto_evolucao?.slice(0, 160) ?? 'Sem registro'}{(p.registro?.texto_evolucao?.length ?? 0) > 160 ? '…' : ''}</span></span>
              {p.evolucao_id && <Link className="btn sec peq" to={`/evolucoes/${p.evolucao_id}`}>Abrir registro</Link>}
            </li>))}</ul>
        )}
        {ausentes.length > 0 && <><h3 style={{ marginTop: 14 }}>Previstos que não participaram</h3>
          <ul className="lista-simples">{ausentes.map((p: any) => <li key={p.assistido_id}><span>{p.nome_completo}</span><span className="mudo">{p.motivo_ausencia ?? ''}</span></li>)}</ul></>}
      </div>
    </>
  );
}
