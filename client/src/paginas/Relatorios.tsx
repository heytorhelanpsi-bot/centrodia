import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, baixar, qs } from '../api';
import { useAuth } from '../auth';
import { TIPOS_RELATORIO, TURNOS, data, dataHora, diasAtras, hojeISO } from '../formato';
import { BuscaAssistido, Campo, Carregando, ErroCaixa, Markdown, useCarregar, useConfirmar, useToast, Vazio, type AssistidoResumo } from '../componentes/ui';
import { EtiquetaStatus } from './Assistidos';

export function Relatorios() {
  const { pode } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState('todos');
  const { dados, erro, carregando, recarregar } = useCarregar<any[]>(`/relatorios${qs({ status })}`);
  const { dados: analises } = useCarregar<any[]>(pode('ia.gerar') ? '/ia/analises' : null);
  return (
    <>
      <div className="cab-pagina">
        <div><h1>Relatórios com IA</h1><p className="sub">A IA produz minutas; todo documento passa por revisão e aprovação profissional.</p></div>
        {pode('relatorios.elaborar') && <Link className="btn grande" to="/relatorios/novo">+ Novo relatório</Link>}
      </div>
      <div className="acoes" style={{ marginBottom: 12 }}>
        {['todos', 'minuta', 'aprovado', 'arquivado'].map((s) => (
          <label key={s} className="chip"><input type="radio" name="st" checked={status === s} onChange={() => setStatus(s)} />{{ todos: 'Todos', minuta: 'Minutas', aprovado: 'Aprovados', arquivado: 'Arquivados' }[s]}</label>
        ))}
      </div>
      <ErroCaixa erro={erro} tentar={recarregar} />
      {carregando && !dados ? <Carregando /> : dados && (
        <div className="cartao">
          {!dados.length ? <Vazio>Nenhum relatório.</Vazio> : (
            <div className="tabela-wrap"><table>
              <thead><tr><th>Documento</th><th>Referente a</th><th>Período</th><th>Elaborado por</th><th>Situação</th></tr></thead>
              <tbody>{dados.map((r) => (
                <tr key={r.id} className="clicavel" onClick={() => nav(`/relatorios/${r.id}`)}>
                  <td><Link to={`/relatorios/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.titulo}</Link>{r.relatorio_pai_id && <> <span className="tag">Anexo</span></>}</td>
                  <td>{r.assistido_nome ?? r.nome_atividade ?? '—'}</td>
                  <td>{data(r.periodo_inicio)} – {data(r.periodo_fim)}</td><td>{r.criado_por_nome}<br /><span className="mudo pequeno">{dataHora(r.criado_em)}</span></td>
                  <td><EtiquetaStatus s={r.status} />{r.aprovado_por_nome && <div className="mudo pequeno">por {r.aprovado_por_nome}</div>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </div>
      )}
      {analises && analises.length > 0 && (
        <div className="cartao">
          <h2>Análises com IA recentes</h2>
          <ul className="lista-simples">{analises.slice(0, 15).map((a) => (
            <li key={a.id}><span><span className="tag ia">IA</span> {a.assistido_nome} — {a.tipo === 'evolucao' ? 'análise de evolução' : `análise ${data(a.periodo_inicio)}–${data(a.periodo_fim)}`}
              <br /><span className="mudo pequeno">{dataHora(a.gerado_em)} · {a.gerado_por_nome}</span></span>
              <span className="acoes"><EtiquetaStatus s={a.status} /><Link className="btn sec peq" to={`/analises/${a.id}`}>Abrir</Link></span></li>))}</ul>
        </div>
      )}
    </>
  );
}

export function NovoRelatorio() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { pode } = useAuth();
  const { dados: ia } = useCarregar<{ disponivel: boolean }>('/ia/status');
  const [tipo, setTipo] = useState(sp.get('tipo') ?? 'individual_evolucao');
  const [assistido, setAssistido] = useState<AssistidoResumo | null>(null);
  const [coletivaId, setColetivaId] = useState(sp.get('coletiva') ?? '');
  const [p, setP] = useState({ periodo_inicio: sp.get('data') ?? diasAtras(30), periodo_fim: sp.get('data') ?? hojeISO(), objetivo: '', incluir_diagnosticos: false, identificacao: 'completa', usar_ia: true });
  const [selecionar, setSelecionar] = useState(false);
  const [registros, setRegistros] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<unknown>(null);
  const [gerando, setGerando] = useState(false);
  const grupo = tipo === 'atividade_grupo';
  const { dados: coletivas } = useCarregar<any[]>(grupo ? `/coletivas${qs({ status: 'finalizada', inicio: diasAtras(365) })}` : null);
  const { dados: evols } = useCarregar<any[]>(!grupo && assistido && selecionar ? `/evolucoes${qs({ assistido_id: assistido.id, inicio: p.periodo_inicio, fim: p.periodo_fim })}` : null);

  useEffect(() => { const a = sp.get('assistido'); if (a) api.get(`/assistidos/${a}`).then(setAssistido).catch(() => {}); }, [sp]);
  // Sem IA disponível (ou sem permissão), o relatório é criado com o modelo para preenchimento manual.
  useEffect(() => { if ((ia && !ia.disponivel) || !pode('ia.gerar')) setP((x) => ({ ...x, usar_ia: false })); }, [ia, pode]);
  useEffect(() => { if (evols) setRegistros(new Set(evols.map((e) => e.id))); }, [evols]);
  useEffect(() => {
    const hoje = hojeISO();
    if (tipo === 'mensal') setP((x) => ({ ...x, periodo_inicio: diasAtras(30), periodo_fim: hoje }));
    if (tipo === 'trimestral') setP((x) => ({ ...x, periodo_inicio: diasAtras(91), periodo_fim: hoje }));
    if (tipo === 'semestral') setP((x) => ({ ...x, periodo_inicio: diasAtras(182), periodo_fim: hoje }));
  }, [tipo]);

  const gerar = async () => {
    setGerando(true); setErro(null);
    try {
      const r = await api.post('/relatorios', {
        tipo, ...p, assistido_id: grupo ? null : assistido?.id, atividade_coletiva_id: grupo ? coletivaId || null : null,
        registros_ids: !grupo && selecionar ? [...registros] : null,
      });
      toast('ok', p.usar_ia ? 'Minuta gerada. Revise o texto antes de aprovar.' : 'Relatório criado para preenchimento.');
      nav(`/relatorios/${r.id}`);
    } catch (e) { setErro(e); window.scrollTo(0, 0); } finally { setGerando(false); }
  };

  return (
    <>
      <div className="cab-pagina"><div><h1>Novo relatório</h1><p className="sub">Selecione o tipo, o período e os registros. A IA usará somente os dados selecionados.</p></div></div>
      <ErroCaixa erro={erro} />
      <div className="cartao">
        <Campo rotulo="Tipo de relatório" obrigatorio>{(x) => <select {...x} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {Object.entries(TIPOS_RELATORIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Campo>
        {grupo ? (
          <Campo rotulo="Atividade em grupo (finalizada)" obrigatorio>{(x) => (
            <select {...x} value={coletivaId} onChange={(e) => {
              setColetivaId(e.target.value);
              const c = coletivas?.find((y) => y.id === e.target.value);
              if (c) setP({ ...p, periodo_inicio: c.data, periodo_fim: c.data });
            }}><option value="">Selecione…</option>{coletivas?.map((c) => <option key={c.id} value={c.id}>{data(c.data)} — {c.nome_atividade} ({TURNOS[c.turno]})</option>)}</select>)}</Campo>
        ) : <BuscaAssistido valor={assistido} onSelecionar={setAssistido} />}
        <div className="linha-campos">
          <Campo rotulo="Início do período" obrigatorio>{(x) => <input {...x} type="date" value={p.periodo_inicio} onChange={(e) => setP({ ...p, periodo_inicio: e.target.value })} />}</Campo>
          <Campo rotulo="Fim do período" obrigatorio>{(x) => <input {...x} type="date" value={p.periodo_fim} max={hojeISO()} onChange={(e) => setP({ ...p, periodo_fim: e.target.value })} />}</Campo>
          {!grupo && <Campo rotulo="Identificação no documento" ajuda="Conforme a finalidade e o destinatário.">{(x) => <select {...x} value={p.identificacao} onChange={(e) => setP({ ...p, identificacao: e.target.value })}>
            <option value="completa">Nome, código e idade</option><option value="codigo">Somente código interno</option></select>}</Campo>}
        </div>
        <Campo rotulo="Objetivo do relatório">{(x) => <textarea {...x} style={{ minHeight: 70 }} placeholder="Ex.: subsidiar reunião da equipe multidisciplinar" value={p.objetivo} onChange={(e) => setP({ ...p, objetivo: e.target.value })} />}</Campo>
        <div className="opcoes">
          {!grupo && <label className="chip"><input type="checkbox" checked={p.incluir_diagnosticos} onChange={(e) => setP({ ...p, incluir_diagnosticos: e.target.checked })} />Incluir diagnósticos registrados</label>}
          {!grupo && <label className="chip"><input type="checkbox" checked={selecionar} onChange={(e) => setSelecionar(e.target.checked)} />Escolher registros específicos</label>}
          <label className="chip"><input type="checkbox" checked={p.usar_ia} disabled={!pode('ia.gerar') || !ia?.disponivel} onChange={(e) => setP({ ...p, usar_ia: e.target.checked })} />Gerar minuta com IA</label>
        </div>
        {ia && !ia.disponivel && <p className="mudo pequeno">IA não configurada no servidor: o relatório será criado com o modelo de seções para preenchimento manual.</p>}
      </div>
      {selecionar && evols && (
        <div className="cartao">
          <h2>Registros a incluir <span className="contador">{registros.size} de {evols.length}</span></h2>
          {!evols.length ? <Vazio>Nenhuma evolução finalizada no período.</Vazio> : (
            <ul className="lista-simples">{evols.map((e) => (
              <li key={e.id}><label className="chip" style={{ border: 0, padding: 0 }}><input type="checkbox" checked={registros.has(e.id)}
                onChange={(x) => { const n = new Set(registros); if (x.target.checked) n.add(e.id); else n.delete(e.id); setRegistros(n); }} />
                {data(e.data)} · {e.tipo === 'individual' ? 'Individual' : 'Grupo'} · {e.atividades.join(', ')}</label>
                <span className="mudo pequeno">{e.resumo?.slice(0, 80)}</span></li>))}</ul>
          )}
        </div>
      )}
      <div className="barra-acoes">
        <button className="btn grande" disabled={gerando || (grupo ? !coletivaId : !assistido)} onClick={gerar}>
          {gerando ? (p.usar_ia ? 'Gerando minuta… (pode levar até 2 minutos)' : 'Criando…') : p.usar_ia ? '✦ Gerar minuta' : 'Criar relatório'}</button>
        <button className="btn sec grande" onClick={() => nav(-1)}>Cancelar</button>
      </div>
    </>
  );
}

export function RelatorioDetalhe() {
  const { id } = useParams();
  const { pode } = useAuth();
  const toast = useToast();
  const confirmar = useConfirmar();
  const { dados: r, erro, carregando, recarregar } = useCarregar<any>(`/relatorios/${id}`);
  const { dados: ia } = useCarregar<{ disponivel: boolean }>('/ia/status');
  const [selId, setSelId] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [instrucoes, setInstrucoes] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [comparar, setComparar] = useState(false);
  const [confirmo, setConfirmo] = useState(false);
  const versao = useMemo(() => r?.versoes.find((v: any) => v.id === selId) ?? r?.versoes[0], [r, selId]);

  if (carregando && !r) return <Carregando />;
  if (erro) return <ErroCaixa erro={erro} />;
  if (!r || !versao) return null;
  const minuta = r.status === 'minuta';
  const podeEditar = minuta && pode('relatorios.elaborar');

  const acao = async (nome: string, fn: () => Promise<unknown>, msg: string) => {
    setOcupado(nome);
    try { await fn(); toast('ok', msg); setSelId(null); recarregar(); } catch (e: any) { toast('erro', e.message); } finally { setOcupado(null); }
  };

  return (
    <>
      <div className="cab-pagina">
        <div>
          <h1>{r.titulo}</h1>
          <p className="sub">{r.assistido_nome ?? 'Atividade em grupo'} · {data(r.periodo_inicio)} a {data(r.periodo_fim)} · elaborado por {r.criado_por_nome}</p>
        </div>
        <div className="acoes">
          <EtiquetaStatus s={r.status} />
          {r.status === 'aprovado' && pode('exportar') && <button className="btn" onClick={() => baixar(`/relatorios/${r.id}/pdf`, 'relatorio.pdf').catch((e) => toast('erro', e.message))}>Exportar PDF</button>}
          {minuta && pode('relatorios.elaborar') && <button className="btn perigo" onClick={async () => {
            if (await confirmar({ titulo: 'Arquivar minuta?', texto: 'A minuta deixará de aparecer como pendente. As versões ficam preservadas.', confirmar: 'Arquivar', perigo: true }))
              acao('arq', () => api.post(`/relatorios/${r.id}/arquivar`), 'Minuta arquivada.');
          }}>Arquivar minuta</button>}
        </div>
      </div>

      {r.status === 'aprovado' && <div className="aviso ok">Aprovado por {r.aprovado_por_nome} em {dataHora(r.aprovado_em)} (versão {r.versoes.find((v: any) => v.id === r.versao_aprovada_id)?.numero}).</div>}
      {minuta && <div className="aviso atencao">Minuta — revise integralmente, compare com os registros originais e edite o que for necessário antes de aprovar.</div>}

      {r.versoes.length > 1 && (
        <div className="cartao">
          <h2>Versões</h2>
          <div className="opcoes">{r.versoes.map((v: any) => (
            <label key={v.id} className="chip"><input type="radio" name="versao" checked={v.id === versao.id} onChange={() => { setSelId(v.id); setEditando(null); }} />
              v{v.numero} · {v.origem === 'ia' ? 'Gerada pela IA' : v.modelo === null && v.numero === 1 ? 'Modelo para preenchimento manual' : 'Revisada pelo profissional'}{v.id === r.versao_aprovada_id ? ' · aprovada' : ''}</label>))}</div>
        </div>
      )}

      <div className="acoes" style={{ marginBottom: 10 }}>
        <span className={`tag ${versao.origem === 'ia' ? 'ia' : 'verde'}`}>{versao.origem === 'ia' ? `Texto produzido pela IA (${versao.modelo ?? ''})` : versao.numero === 1 ? 'Redigido pelo profissional (sem IA)' : 'Versão revisada pelo profissional'}</span>
        <span className="mudo pequeno">v{versao.numero} · {dataHora(versao.criado_em)} · {versao.autor_nome}</span>
        {podeEditar && !editando && <button className="btn sec peq" onClick={() => setEditando(versao.conteudo)}>Editar texto</button>}
        {r.registros.length > 0 && <button className="btn sec peq" aria-pressed={comparar} onClick={() => setComparar(!comparar)}>{comparar ? 'Ocultar registros originais' : 'Comparar com os registros originais'}</button>}
      </div>

      <div className={comparar ? 'comparacao' : ''}>
        {editando !== null ? (
          <div className="cartao">
            <Campo rotulo="Texto do relatório (Markdown simples: ## título, - item)">{(p) => <textarea {...p} style={{ minHeight: 480, fontFamily: 'ui-monospace, monospace', fontSize: '0.92rem' }} value={editando} onChange={(e) => setEditando(e.target.value)} />}</Campo>
            <div className="acoes">
              <button className="btn" disabled={!!ocupado} onClick={() => acao('salvar', () => api.post(`/relatorios/${r.id}/versoes`, { conteudo: editando }).then(() => setEditando(null)), 'Nova versão revisada salva.')}>{ocupado === 'salvar' ? 'Salvando…' : 'Salvar como nova versão'}</button>
              <button className="btn sec" onClick={() => setEditando(null)}>Cancelar edição</button>
            </div>
          </div>
        ) : <div className="documento"><Markdown texto={versao.conteudo} /></div>}
        {comparar && (
          <div className="cartao" style={{ maxHeight: 720, overflowY: 'auto' }}>
            <h2>Registros originais ({r.registros.length})</h2>
            {r.registros.map((e: any) => (
              <div key={e.id} style={{ borderBottom: '1px solid var(--cinza-200)', padding: '8px 0' }}>
                <strong>{data(e.data)} · {TURNOS[e.turno]} · {e.tipo === 'individual' ? 'Individual' : 'Grupo'}</strong> <span className="mudo pequeno">{e.profissional_nome}</span>
                <p className="pre pequeno">{e.texto_evolucao}</p><Link className="pequeno" to={`/evolucoes/${e.id}`}>Abrir registro</Link>
              </div>))}
          </div>
        )}
      </div>

      {minuta && pode('relatorios.elaborar') && editando === null && (
        <div className="grade grade-2" style={{ marginTop: 16 }}>
          {pode('ia.gerar') && (
            <div className="cartao">
              <h2>Solicitar nova versão à IA</h2>
              <Campo rotulo="Instruções (opcional)">{(p) => <textarea {...p} style={{ minHeight: 70 }} placeholder="Ex.: linguagem mais objetiva; detalhar a seção de apoios" value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)} />}</Campo>
              <button className="btn sec" disabled={!!ocupado || !ia?.disponivel} onClick={() => acao('regen', () => api.post(`/relatorios/${r.id}/regenerar`, { instrucoes: instrucoes || null }), 'Nova versão gerada pela IA.')}>
                {ocupado === 'regen' ? 'Gerando…' : '✦ Gerar nova versão'}</button>
            </div>
          )}
          {pode('relatorios.aprovar') && (
            <div className="cartao">
              <h2>Aprovar e salvar</h2>
              <p className="pequeno">Será aprovada a <strong>versão {versao.numero}</strong> ({versao.origem === 'ia' ? 'texto da IA sem edição' : 'revisada pelo profissional'}). Após a aprovação, o documento não pode ser alterado.</p>
              <label className="chip" style={{ marginBottom: 10 }}><input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} />Revisei integralmente o documento e confirmo que está fundamentado nos registros</label>
              <button className="btn verde" disabled={!confirmo || !!ocupado} onClick={() => acao('aprovar', () => api.post(`/relatorios/${r.id}/aprovar`, { versao_id: versao.id, confirmo_revisao: true }), 'Relatório aprovado.')}>
                {ocupado === 'aprovar' ? 'Aprovando…' : 'Aprovar relatório'}</button>
            </div>
          )}
        </div>
      )}

      {r.tipo === 'atividade_grupo' && pode('relatorios.elaborar') && (
        <div className="cartao" style={{ marginTop: 16 }}>
          <h2>Anexos individuais (acesso controlado)</h2>
          <p className="mudo pequeno">Cada anexo é um documento separado, visível apenas a quem tem acesso ao respectivo assistido.</p>
          {r.anexos.length > 0 && <ul className="lista-simples">{r.anexos.map((a: any) => <li key={a.id}><span>{a.assistido_nome} <span className="mudo">· {a.assistido_codigo}</span></span><span className="acoes"><EtiquetaStatus s={a.status} /><Link className="btn sec peq" to={`/relatorios/${a.id}`}>Abrir</Link></span></li>)}</ul>}
          <div className="acoes" style={{ marginTop: 8 }}>
            <button className="btn sec" disabled={!!ocupado} onClick={() => acao('anexos', () => api.post(`/relatorios/${r.id}/anexos`, { usar_ia: false }), 'Anexos criados.')}>Criar anexos (modelo em branco)</button>
            {pode('ia.gerar') && <button className="btn sec" disabled={!!ocupado || !ia?.disponivel} onClick={() => acao('anexos', () => api.post(`/relatorios/${r.id}/anexos`, { usar_ia: true }), 'Anexos gerados pela IA.')}>{ocupado === 'anexos' ? 'Gerando…' : '✦ Gerar anexos com IA'}</button>}
          </div>
        </div>
      )}
    </>
  );
}

const SECOES_EVOLUCAO: [string, string][] = [
  ['comportamentos_observados', 'Comportamentos observados'], ['indicadores_registrados', 'Indicadores registrados'],
  ['potencialidades', 'Potencialidades'], ['dificuldades', 'Dificuldades'], ['necessidades_apoio', 'Necessidades de apoio'],
  ['pontos_acompanhamento', 'Pontos para acompanhamento'], ['sugestoes', 'Sugestões de atividades ou estratégias (para avaliação do profissional)'],
  ['lacunas_informacao', 'Informações ausentes no registro'],
];
const SECOES_LONG: [string, string][] = [
  ['frequencia_atividades', 'Frequência das atividades'], ['participacao_engajamento', 'Participação e engajamento'],
  ['variacoes_indicadores', 'Variações nos indicadores'], ['comportamentos_recorrentes', 'Comportamentos recorrentes'],
  ['avancos', 'Avanços documentados'], ['dificuldades', 'Dificuldades documentadas'], ['contextos_individual_coletivo', 'Contextos individual e coletivo'],
  ['estrategias_e_respostas', 'Estratégias utilizadas e respostas'], ['associacoes_observadas', 'Associações observadas (não indicam causalidade)'],
  ['informacoes_ausentes', 'Informações ausentes'], ['limitacoes', 'Limitações da análise'],
];

function analiseParaTexto(tipo: string, a: any, nome: string) {
  const secoes = tipo === 'evolucao' ? SECOES_EVOLUCAO : SECOES_LONG;
  const linhas = [`## ${tipo === 'evolucao' ? 'Resumo do atendimento' : 'Síntese'}`, a.resumo ?? a.sintese ?? '', ''];
  for (const [k, t] of secoes) if (a[k]?.length) linhas.push(`## ${t}`, ...a[k].map((x: string) => `- ${x}`), '');
  return linhas.join('\n').replaceAll('[ASSISTIDO]', nome);
}

export function AnaliseDetalhe() {
  const { id } = useParams();
  const { pode } = useAuth();
  const toast = useToast();
  const { dados: a, erro, carregando, recarregar } = useCarregar<any>(`/ia/analises/${id}`);
  const [texto, setTexto] = useState<string | null>(null);
  const [comparar, setComparar] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  if (carregando && !a) return <Carregando />;
  if (erro) return <ErroCaixa erro={erro} />;
  if (!a) return null;
  const primeiroNome = a.assistido_nome.split(' ')[0];
  const textoIA = analiseParaTexto(a.tipo, a.conteudo_ia.analise, primeiroNome);
  const est = a.conteudo_ia.estatisticas;
  const revisar = async (status: 'revisada' | 'descartada') => {
    setOcupado(true);
    try { await api.put(`/ia/analises/${a.id}`, { status, texto_revisado: status === 'revisada' ? (texto ?? textoIA) : null }); toast('ok', status === 'revisada' ? 'Análise revisada e salva.' : 'Análise descartada.'); recarregar(); }
    catch (e: any) { toast('erro', e.message); } finally { setOcupado(false); }
  };
  return (
    <>
      <div className="cab-pagina">
        <div>
          <h1>{a.tipo === 'evolucao' ? 'Análise de evolução' : 'Análise longitudinal'} — {a.assistido_nome}</h1>
          <p className="sub">{a.periodo_inicio ? `${data(a.periodo_inicio)} a ${data(a.periodo_fim)} · ` : ''}gerada em {dataHora(a.gerado_em)} por {a.gerado_por_nome} · modelo {a.modelo} · prompt {a.versao_prompt}</p>
        </div>
        <div className="acoes"><EtiquetaStatus s={a.status} /><Link className="btn sec" to={`/assistidos/${a.assistido_id}`}>Ficha do assistido</Link></div>
      </div>
      <div className="aviso info pequeno">Dados enviados à IA de forma pseudonimizada (sem nome e sem data de nascimento){a.conteudo_ia.incluiu_diagnosticos ? '; diagnósticos registrados incluídos por solicitação' : '; diagnósticos não incluídos'}.
        A IA pode errar: confira cada afirmação com os registros originais.</div>
      {est && (
        <div className="grade grade-kpi" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="valor">{est.total_registros}</div><div className="rotulo">Registros analisados</div></div>
          <div className="kpi"><div className="valor">{est.por_contexto.individual}</div><div className="rotulo">Individuais</div></div>
          <div className="kpi"><div className="valor">{est.por_contexto.participacao_coletiva}</div><div className="rotulo">Em grupo</div></div>
        </div>
      )}
      <div className="acoes" style={{ marginBottom: 10 }}>
        <button className="btn sec peq" aria-pressed={comparar} onClick={() => setComparar(!comparar)}>{comparar ? 'Ocultar registros originais' : 'Comparar com os registros originais'}</button>
      </div>
      <div className={comparar ? 'comparacao' : ''}>
        <div>
          <div className="cartao">
            <h2><span className="tag ia">Texto produzido pela IA</span></h2>
            <Markdown texto={textoIA} />
          </div>
          {a.texto_revisado && <div className="cartao"><h2><span className="tag verde">Versão revisada pelo profissional</span></h2>
            <p className="mudo pequeno">{a.revisado_por_nome} · {dataHora(a.revisado_em)}</p><Markdown texto={a.texto_revisado} /></div>}
        </div>
        {comparar && (
          <div className="cartao" style={{ maxHeight: 720, overflowY: 'auto' }}>
            <h2>Registros originais ({a.registros.length})</h2>
            {a.registros.map((e: any) => (
              <div key={e.id} style={{ borderBottom: '1px solid var(--cinza-200)', padding: '8px 0' }}>
                <strong>{data(e.data)} · {TURNOS[e.turno]}</strong> <Link className="pequeno" to={`/evolucoes/${e.id}`}>abrir</Link>
                <p className="pre pequeno">{e.texto_evolucao}</p>
              </div>))}
          </div>
        )}
      </div>
      {a.status === 'minuta' && pode('ia.gerar') && (
        <div className="cartao">
          <h2>Revisão profissional</h2>
          {texto === null ? (
            <div className="acoes">
              <button className="btn" onClick={() => setTexto(textoIA)}>Editar texto</button>
              <button className="btn perigo" disabled={ocupado} onClick={() => revisar('descartada')}>Descartar análise</button>
            </div>
          ) : (
            <>
              <Campo rotulo="Texto revisado">{(p) => <textarea {...p} style={{ minHeight: 360 }} value={texto} onChange={(e) => setTexto(e.target.value)} />}</Campo>
              <div className="acoes">
                <button className="btn verde" disabled={ocupado} onClick={() => revisar('revisada')}>Aprovar e salvar revisão</button>
                <button className="btn sec" onClick={() => setTexto(null)}>Cancelar</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
