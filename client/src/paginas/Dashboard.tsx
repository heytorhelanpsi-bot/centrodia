import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../api';
import { useAuth } from '../auth';
import { DIAS, TURNOS, data, dataHora, hojeISO } from '../formato';
import { Campo, Carregando, ErroCaixa, useCarregar, Vazio } from '../componentes/ui';

export function Dashboard() {
  const { usuario, pode } = useAuth();
  const [filtro, setFiltro] = useState({ data: hojeISO(), turno: '', profissional_id: '' });
  const { dados: d, erro, carregando, recarregar } = useCarregar<any>(`/dashboard${qs(filtro)}`);
  const { dados: profs } = useCarregar<{ id: string; nome: string }[]>('/usuarios/profissionais');

  return (
    <>
      <div className="cab-pagina">
        <div>
          <h1>Olá, {usuario!.nome.split(' ')[0]}</h1>
          <p className="sub">Painel de {data(filtro.data)}{d ? ` · ${DIAS[d.dia_semana] || 'Domingo'}` : ''}</p>
        </div>
        <div className="acoes">
          {pode('evolucoes.registrar') && <Link className="btn grande" to="/evolucoes/nova">✎ Nova evolução</Link>}
          {pode('coletivas.registrar') && <Link className="btn verde grande" to="/grupos/novo">👥 Atividade em grupo</Link>}
        </div>
      </div>

      <div className="cartao">
        <div className="linha-campos">
          <Campo rotulo="Data">{(p) => <input {...p} type="date" value={filtro.data} max={hojeISO()} onChange={(e) => setFiltro({ ...filtro, data: e.target.value || hojeISO() })} />}</Campo>
          <Campo rotulo="Turno">{(p) => (
            <select {...p} value={filtro.turno} onChange={(e) => setFiltro({ ...filtro, turno: e.target.value })}>
              <option value="">Todos</option><option value="manha">Manhã</option><option value="tarde">Tarde</option>
            </select>)}</Campo>
          <Campo rotulo="Profissional responsável">{(p) => (
            <select {...p} value={filtro.profissional_id} onChange={(e) => setFiltro({ ...filtro, profissional_id: e.target.value })}>
              <option value="">Todos</option>
              {profs?.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>)}</Campo>
        </div>
      </div>

      <ErroCaixa erro={erro} tentar={recarregar} />
      {carregando && !d && <Carregando />}
      {d && (
        <>
          <section aria-label="Indicadores do dia" className="grade grade-kpi" style={{ marginBottom: 16 }}>
            <Kpi valor={d.total_assistidos} rotulo="Assistidos ativos (acessíveis)" />
            <Kpi valor={d.previstos.length} rotulo="Atendimentos previstos no dia" />
            <Kpi valor={d.registrados} rotulo="Atendimentos registrados" />
            <Kpi valor={d.pendentes_hoje} rotulo="Previstos sem registro" alerta={d.pendentes_hoje > 0} />
            <Kpi valor={d.individuais} rotulo="Individuais" />
            <Kpi valor={d.em_grupo} rotulo={`Participações em grupo (${d.atividades_grupo_realizadas} atividade${d.atividades_grupo_realizadas === 1 ? '' : 's'})`} />
          </section>

          <div className="grade grade-2">
            <section className="cartao" aria-labelledby="t-turno">
              <h2 id="t-turno">Distribuição por turno</h2>
              <BarraTurno manha={d.manha} tarde={d.tarde} />
            </section>

            <section className="cartao" aria-labelledby="t-alertas">
              <h2 id="t-alertas">Alertas de registros incompletos</h2>
              {!d.rascunhos.length && !d.grupos_rascunho.length && !d.relatorios_em_minuta ? <p className="mudo">Nenhuma pendência sua. ✓</p> : (
                <ul className="lista-simples">
                  {d.rascunhos.map((r: any) => (
                    <li key={r.id}><span><span className="tag ambar">Rascunho</span> {r.assistido_nome} <span className="mudo">· {data(r.data)}</span></span>
                      <Link className="btn sec peq" to={`/evolucoes/${r.id}/editar`}>Retomar</Link></li>
                  ))}
                  {d.grupos_rascunho.map((g: any) => (
                    <li key={g.id}><span><span className="tag ambar">Grupo em rascunho</span> {g.nome_atividade} <span className="mudo">· {data(g.data)}</span></span>
                      <Link className="btn sec peq" to={`/grupos/${g.id}/editar`}>Retomar</Link></li>
                  ))}
                  {d.relatorios_em_minuta > 0 && <li><span><span className="tag ia">Minutas</span> {d.relatorios_em_minuta} relatório(s) aguardando revisão</span>
                    <Link className="btn sec peq" to="/relatorios">Revisar</Link></li>}
                </ul>
              )}
            </section>
          </div>

          <div className="grade grade-2">
            <section className="cartao" aria-labelledby="t-prev">
              <h2 id="t-prev">Previstos para o dia <span className="contador">{d.previstos.length}</span></h2>
              {!d.previstos.length ? <Vazio>Nenhum assistido com atendimento previsto{filtro.turno ? ' neste turno' : ''}.</Vazio> : (
                <ul className="lista-simples">
                  {d.previstos.map((a: any) => (
                    <li key={a.id}>
                      <span>{a.registrado ? <span className="tag verde">Registrado</span> : <span className="tag ambar">Pendente</span>}{' '}
                        <Link to={`/assistidos/${a.id}`}>{a.nome_completo}</Link> <span className="mudo">· {TURNOS[a.turno_habitual]}</span></span>
                      {!a.registrado && pode('evolucoes.registrar') && <Link className="btn sec peq" to={`/evolucoes/nova?assistido=${a.id}`}>Registrar</Link>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="cartao" aria-labelledby="t-rec">
              <h2 id="t-rec">Evoluções recentes</h2>
              {!d.recentes.length ? <Vazio>Nenhuma evolução registrada ainda.</Vazio> : (
                <ul className="lista-simples">
                  {d.recentes.map((r: any) => (
                    <li key={r.id}>
                      <span><Link to={`/evolucoes/${r.id}`}>{r.assistido_nome}</Link>
                        <span className="mudo"> · {data(r.data)} · {TURNOS[r.turno]} · {r.tipo === 'individual' ? 'Individual' : 'Grupo'}</span>
                        <br /><span className="mudo pequeno">{r.atividades.join(', ') || 'sem atividade informada'} — {r.profissional_nome}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <p className="mudo pequeno">Atualizado em {dataHora(new Date().toISOString())}. O painel mostra apenas assistidos aos quais você tem acesso e não exibe dados clínicos.</p>
        </>
      )}
    </>
  );
}

function Kpi({ valor, rotulo, alerta }: { valor: number; rotulo: string; alerta?: boolean }) {
  return <div className={`kpi ${alerta ? 'alerta' : ''}`}><div className="valor">{valor}</div><div className="rotulo">{rotulo}</div></div>;
}

function BarraTurno({ manha, tarde }: { manha: number; tarde: number }) {
  const total = manha + tarde;
  if (!total) return <p className="mudo">Sem atendimentos registrados no período filtrado.</p>;
  const pm = Math.round((manha / total) * 100);
  return (
    <div>
      <div style={{ display: 'flex', height: 28, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--cinza-200)' }} role="img"
        aria-label={`Manhã: ${manha} atendimentos; tarde: ${tarde} atendimentos`}>
        <div style={{ width: `${pm}%`, background: 'var(--azul-600)' }} />
        <div style={{ width: `${100 - pm}%`, background: 'var(--verde-500)' }} />
      </div>
      <div className="acoes" style={{ marginTop: 8, justifyContent: 'space-between' }}>
        <span><span className="tag azul">Manhã</span> {manha} ({pm}%)</span>
        <span><span className="tag verde">Tarde</span> {tarde} ({100 - pm}%)</span>
      </div>
    </div>
  );
}
