import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { baixar, qs } from '../api';
import { useAuth } from '../auth';
import { APOIO, PARTICIPACAO, REALIZACAO, TURNOS, data, dataHora, diasAtras, hojeISO } from '../formato';
import { BuscaAssistido, Campo, Carregando, ErroCaixa, useCarregar, useToast, Vazio, type AssistidoResumo } from '../componentes/ui';
import { CAMPOS_TEXTO } from '../componentes/registro';
import { EtiquetaStatus } from './Assistidos';

function FiltrosComuns({ f, setF, semAssistido }: { f: any; setF: (f: any) => void; semAssistido?: boolean }) {
  const { dados: profs } = useCarregar<any[]>('/usuarios/profissionais');
  const { dados: ativs } = useCarregar<any[]>('/atividades?todas=1');
  const { dados: inds } = useCarregar<any[]>('/indicadores?todos=1');
  const [assistido, setAssistido] = useState<AssistidoResumo | null>(null);
  return (
    <div className="cartao">
      {!semAssistido && <BuscaAssistido rotulo="Assistido (opcional)" valor={assistido} onSelecionar={(a) => { setAssistido(a); setF({ ...f, assistido_id: a?.id ?? '' }); }} />}
      <div className="linha-campos">
        <Campo rotulo="De">{(p) => <input {...p} type="date" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} />}</Campo>
        <Campo rotulo="Até">{(p) => <input {...p} type="date" value={f.fim} max={hojeISO()} onChange={(e) => setF({ ...f, fim: e.target.value })} />}</Campo>
        <Campo rotulo="Turno">{(p) => <select {...p} value={f.turno} onChange={(e) => setF({ ...f, turno: e.target.value })}><option value="">Todos</option><option value="manha">Manhã</option><option value="tarde">Tarde</option></select>}</Campo>
        <Campo rotulo="Tipo de atendimento">{(p) => <select {...p} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="">Todos</option><option value="individual">Individual</option><option value="participacao_coletiva">Em grupo</option></select>}</Campo>
      </div>
      <div className="linha-campos">
        <Campo rotulo="Profissional">{(p) => <select {...p} value={f.profissional_id} onChange={(e) => setF({ ...f, profissional_id: e.target.value })}><option value="">Todos</option>{profs?.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select>}</Campo>
        <Campo rotulo="Atividade">{(p) => <select {...p} value={f.atividade_id} onChange={(e) => setF({ ...f, atividade_id: e.target.value })}><option value="">Todas</option>{ativs?.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select>}</Campo>
        <Campo rotulo="Com o indicador avaliado">{(p) => <select {...p} value={f.indicador_id} onChange={(e) => setF({ ...f, indicador_id: e.target.value })}><option value="">Qualquer</option>{inds?.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select>}</Campo>
      </div>
    </div>
  );
}

const filtroInicial = () => ({ assistido_id: '', inicio: diasAtras(30), fim: hojeISO(), turno: '', tipo: '', profissional_id: '', atividade_id: '', indicador_id: '' });

export function HistoricoEvolucoes() {
  const { pode } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useState(filtroInicial());
  const [status, setStatus] = useState('finalizada');
  const { dados, erro, carregando, recarregar } = useCarregar<any[]>(`/evolucoes${qs({ ...f, status })}`);
  return (
    <>
      <div className="cab-pagina">
        <div><h1>Histórico de evoluções</h1><p className="sub">Consulta de registros com filtros por período, atividade, turno, profissional e tipo.</p></div>
        {pode('exportar') && (
          <div className="acoes">
            <button className="btn sec" onClick={() => baixar(`/exportar/evolucoes${qs({ ...f, formato: 'csv' })}`, 'evolucoes.csv').catch((e) => toast('erro', e.message))}>Exportar CSV</button>
            <button className="btn sec" onClick={() => baixar(`/exportar/evolucoes${qs({ ...f, formato: 'xlsx' })}`, 'evolucoes.xlsx').catch((e) => toast('erro', e.message))}>Exportar XLSX</button>
          </div>
        )}
      </div>
      <FiltrosComuns f={f} setF={setF} />
      <div className="acoes" style={{ marginBottom: 12 }}>
        <label className="chip"><input type="radio" name="st" checked={status === 'finalizada'} onChange={() => setStatus('finalizada')} />Finalizadas</label>
        <label className="chip"><input type="radio" name="st" checked={status === 'rascunho'} onChange={() => setStatus('rascunho')} />Meus rascunhos</label>
      </div>
      <ErroCaixa erro={erro} tentar={recarregar} />
      {carregando && !dados ? <Carregando /> : dados && (
        <div className="cartao">
          {!dados.length ? <Vazio>Nenhum registro encontrado com os filtros.</Vazio> : (
            <div className="tabela-wrap"><table>
              <thead><tr><th>Data</th><th>Assistido</th><th>Tipo</th><th>Atividades</th><th>Profissional</th><th>Indicadores</th><th>Situação</th></tr></thead>
              <tbody>{dados.map((e) => (
                <tr key={e.id} className="clicavel" onClick={() => nav(e.status === 'rascunho' && !e.atividade_coletiva_id ? `/evolucoes/${e.id}/editar` : `/evolucoes/${e.id}`)}>
                  <td>{data(e.data)}<br /><span className="mudo pequeno">{TURNOS[e.turno]}</span></td>
                  <td><Link to={`/evolucoes/${e.id}`} onClick={(x) => x.stopPropagation()}>{e.assistido_nome}</Link><br /><span className="mudo pequeno">{e.assistido_codigo}</span></td>
                  <td>{e.tipo === 'individual' ? 'Individual' : 'Grupo'}</td>
                  <td>{e.atividades.join(', ') || '—'}</td><td>{e.profissional_nome}</td><td>{e.indicadores_avaliados}</td>
                  <td><EtiquetaStatus s={e.status} />{e.correcoes > 0 && <> <span className="tag azul">v{e.versao}</span></>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
          <p className="mudo pequeno">{dados.length} registro(s){dados.length >= 200 ? ' (limite de exibição atingido — refine os filtros)' : ''}.</p>
        </div>
      )}
    </>
  );
}

/** Linha do tempo do histórico individual. */
export function LinhaDoTempo({ assistidoId }: { assistidoId: string }) {
  const [f, setF] = useState({ ...filtroInicial(), inicio: diasAtras(90) });
  const { dados, erro, carregando, recarregar } = useCarregar<any>(`/assistidos/${assistidoId}/historico${qs({ ...f, assistido_id: undefined })}`);
  const [aberto, setAberto] = useState<Set<string>>(new Set());
  const itens = !dados ? [] : [
    ...dados.evolucoes.map((e: any) => ({ tipo: 'evolucao', quando: e.data + 'T' + (e.finalizada_em ?? e.criado_em).slice(11), e })),
    ...dados.analises.filter((a: any) => a.gerado_em.slice(0, 10) >= f.inicio && a.gerado_em.slice(0, 10) <= f.fim).map((a: any) => ({ tipo: 'analise', quando: a.gerado_em, a })),
    ...dados.relatorios.filter((r: any) => r.criado_em.slice(0, 10) >= f.inicio && r.criado_em.slice(0, 10) <= f.fim).map((r: any) => ({ tipo: 'relatorio', quando: r.criado_em, r })),
  ].sort((x, y) => y.quando.localeCompare(x.quando));
  const alternar = (id: string) => { const n = new Set(aberto); if (n.has(id)) n.delete(id); else n.add(id); setAberto(n); };
  return (
    <>
      <FiltrosComuns f={f} setF={setF} semAssistido />
      <ErroCaixa erro={erro} tentar={recarregar} />
      {carregando && !dados ? <Carregando /> : dados && (
        <>
          {!itens.length ? <div className="cartao"><Vazio>Nada registrado no período.</Vazio></div> : (
            <ol className="timeline" aria-label="Linha do tempo">
              {itens.map((it) => it.tipo === 'evolucao' ? (
                <li key={it.e.id} className={it.e.tipo === 'individual' ? '' : 'grupo'}>
                  <article className="cartao" style={{ marginBottom: 0 }}>
                    <div className="acoes" style={{ justifyContent: 'space-between' }}>
                      <h3 style={{ margin: 0 }}>{data(it.e.data)} · {TURNOS[it.e.turno]} — {it.e.tipo === 'individual' ? 'Atendimento individual' : `Grupo: ${it.e.coletiva_nome}`}</h3>
                      <span className="acoes"><EtiquetaStatus s={it.e.status} />{it.e.correcoes > 0 && <span className="tag azul">Corrigido (v{it.e.versao})</span>}</span>
                    </div>
                    <p className="mudo pequeno">{it.e.profissional_nome} · {it.e.atividades.map((a: any) => a.nome + (a.realizacao ? ` (${REALIZACAO[a.realizacao].toLowerCase()})` : '')).join(', ') || 'sem atividade'}
                      {it.e.participacao && ` · ${PARTICIPACAO[it.e.participacao]}`}{it.e.nivel_apoio && ` · ${APOIO[it.e.nivel_apoio]}`}</p>
                    {it.e.avaliacoes.length > 0 && <div className="opcoes" style={{ margin: '6px 0' }}>{it.e.avaliacoes.map((a: any) => (
                      <span key={a.nome} className="tag" title={a.nivel ?? 'Não avaliado'}>{a.nome}: {a.valor ?? 'n/a'}{a.versao > 1 ? ` (v${a.versao})` : ''}</span>))}</div>}
                    <p className={aberto.has(it.e.id) ? 'pre' : ''}>{aberto.has(it.e.id) ? it.e.texto_evolucao : `${(it.e.texto_evolucao ?? '').slice(0, 220)}${(it.e.texto_evolucao?.length ?? 0) > 220 ? '…' : ''}`}</p>
                    {aberto.has(it.e.id) && CAMPOS_TEXTO.filter((c) => it.e[c.chave]).map((c) => <div key={c.chave}><strong className="pequeno">{c.rotulo}:</strong> <span className="pre">{it.e[c.chave]}</span></div>)}
                    <div className="acoes" style={{ marginTop: 6 }}>
                      <button className="btn-link" aria-expanded={aberto.has(it.e.id)} onClick={() => alternar(it.e.id)}>{aberto.has(it.e.id) ? 'Recolher' : 'Ver conteúdo completo'}</button>
                      <Link to={`/evolucoes/${it.e.id}`}>Abrir registro</Link>
                    </div>
                  </article>
                </li>
              ) : it.tipo === 'analise' ? (
                <li key={it.a.id} className="ia"><div className="cartao" style={{ marginBottom: 0 }}>
                  <span className="tag ia">Análise IA</span> {it.a.tipo === 'evolucao' ? 'Análise de evolução' : `Análise longitudinal ${data(it.a.periodo_inicio)}–${data(it.a.periodo_fim)}`}
                  <span className="mudo pequeno"> · {dataHora(it.a.gerado_em)} · {it.a.gerado_por_nome}</span> <EtiquetaStatus s={it.a.status} /> <Link to={`/analises/${it.a.id}`}>Abrir</Link>
                </div></li>
              ) : (
                <li key={it.r.id} className="ia"><div className="cartao" style={{ marginBottom: 0 }}>
                  <span className="tag azul">Relatório</span> {it.r.titulo} <span className="mudo pequeno">· {dataHora(it.r.criado_em)}</span> <EtiquetaStatus s={it.r.status} /> <Link to={`/relatorios/${it.r.id}`}>Abrir</Link>
                </div></li>
              ))}
            </ol>
          )}
          {dados.correcoes.length > 0 && (
            <div className="cartao" style={{ marginTop: 16 }}>
              <h3>Correções e alterações registradas</h3>
              <ul className="lista-simples">{dados.correcoes.map((c: any) => (
                <li key={c.id}><span>Registro de {data(c.evolucao_data)} — {c.motivo}<br /><span className="mudo pequeno">{dataHora(c.alterado_em)} · {c.alterado_por_nome}</span></span>
                  <Link className="btn sec peq" to={`/evolucoes/${c.evolucao_id}`}>Ver</Link></li>))}</ul>
            </div>
          )}
        </>
      )}
    </>
  );
}
