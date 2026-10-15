import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { DIAS, data, dataHora, hojeISO } from '../formato';
import { Campo, Carregando, ErroCaixa, errosPorCampo, useCarregar, useConfirmar, useToast, Vazio } from '../componentes/ui';
import { conteudoDeRegistro, conteudoParaPayload, conteudoVazio, SecaoAtividades, type Atividade, type Conteudo, type Indicador } from '../componentes/registro';

const TURNOS_ROTINA = [
  { id: 'manha', rotulo: 'Manhã', ico: '☀️', classe: 'manha' },
  { id: 'tarde', rotulo: 'Tarde', ico: '🌇', classe: 'tarde' },
] as const;
const NOME_TURNO: Record<string, string> = { manha: 'Manhã', tarde: 'Tarde' };

interface Resumo {
  hoje: string; dia_hoje: number; dias: number[];
  turnos: Record<string, Record<string, { data: string; previstos: number; registrados: number }>>;
}
interface ItemRotina {
  id: string; codigo: string; nome_completo: string; idade: number | null; cids: string[];
  situacao: 'pendente' | 'rascunho' | 'registrado' | 'falta'; evolucao_id: string | null; rascunho_id: string | null;
}

/** Desloca uma data ISO em n dias. */
function somarDias(iso: string, n: number) {
  const [a, m, d] = iso.split('-').map(Number);
  const x = new Date(a, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Início: turno → dia
// ---------------------------------------------------------------------------
export function Inicio() {
  const { usuario, pode } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const turno = sp.get('turno');
  const { dados: r, erro, carregando, recarregar } = useCarregar<Resumo>('/rotina/resumo');
  const { dados: painel } = useCarregar<any>('/dashboard');
  const rascunhos = (painel?.rascunhos ?? []).filter((x: any) => !x.atividade_coletiva_id);

  const escolherTurno = (t: string) => setSp(t === turno ? {} : { turno: t }, { replace: true });
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <>
      <div className="cab-pagina">
        <div>
          <h1>{saudacao}, {usuario!.nome.split(' ')[0]}</h1>
          <p className="sub">{r ? `${DIAS[r.dia_hoje] || 'Domingo'}, ${data(r.hoje)}` : data(hojeISO())} · Escolha o turno para começar os registros.</p>
        </div>
      </div>
      <ErroCaixa erro={erro} tentar={recarregar} />
      {carregando && !r && <Carregando />}
      {r && (
        <>
          <div className="turnos" role="group" aria-label="Turnos">
            {TURNOS_ROTINA.map((t) => {
              const tot = r.dias.reduce((s, d) => s + (r.turnos[t.id]?.[d]?.previstos ?? 0), 0);
              const hojeInfo = r.turnos[t.id]?.[r.dia_hoje];
              return (
                <button key={t.id} type="button" className={`cartao-turno ${t.classe} ${turno === t.id ? 'selecionado' : ''}`}
                  aria-expanded={turno === t.id} onClick={() => escolherTurno(t.id)}>
                  <span className="turno-ico" aria-hidden>{t.ico}</span>
                  <span className="turno-nome">{t.rotulo}</span>
                  <span className="turno-info">
                    {hojeInfo ? `Hoje: ${hojeInfo.registrados} de ${hojeInfo.previstos} registrados` : `${tot} atendimento${tot === 1 ? '' : 's'} na semana`}
                  </span>
                </button>
              );
            })}
          </div>

          {turno && (
            <section className="cartao" aria-labelledby="t-dias">
              <h2 id="t-dias">{NOME_TURNO[turno]} — escolha o dia</h2>
              <div className="dias">
                {r.dias.map((d) => {
                  const info = r.turnos[turno]?.[d];
                  const ehHoje = d === r.dia_hoje;
                  const completo = info && info.previstos > 0 && info.registrados >= info.previstos;
                  return (
                    <button key={d} type="button" className={`cartao-dia ${ehHoje ? 'hoje' : ''}`} onClick={() => nav(`/rotina/${turno}/${d}`)}>
                      <span className="dia-nome">{DIAS[d]}</span>
                      <span className="dia-data">{ehHoje ? 'Hoje' : info ? data(info.data) : ''}</span>
                      <span className={`tag ${completo ? 'verde' : info?.previstos ? 'ambar' : ''}`}>
                        {info ? `${info.registrados}/${info.previstos} registrados` : '—'}
                      </span>
                    </button>
                  );
                })}
              </div>
              {pode('usuarios.gerenciar') && <p className="mudo pequeno" style={{ marginTop: 10 }}>Os dias de funcionamento podem ser alterados em Mais › Usuários e configurações › Instituição.</p>}
            </section>
          )}

          {rascunhos.length > 0 && (
            <section className="cartao" aria-labelledby="t-rasc">
              <h2 id="t-rasc">Registros não concluídos</h2>
              <ul className="lista-simples">
                {rascunhos.map((x: any) => (
                  <li key={x.id}>
                    <span><strong>{x.assistido_nome}</strong> <span className="mudo">· {data(x.data)} · {NOME_TURNO[x.turno]}</span></span>
                    <Link className="btn sec peq" to={`/registro/${x.id}`}>Continuar</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Lista de assistidos do turno e do dia
// ---------------------------------------------------------------------------
export function ListaDoDia() {
  const { turno = 'manha', dia = '1' } = useParams();
  const [sp, setSp] = useSearchParams();
  const { pode } = useAuth();
  const nav = useNavigate();
  const [busca, setBusca] = useState('');
  const dataSel = sp.get('data');
  const { dados: l, erro, carregando, recarregar } = useCarregar<{ data: string; assistidos: ItemRotina[] }>(
    `/rotina${qs({ turno, dia, data: dataSel })}`);
  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return (l?.assistidos ?? []).filter((a) => !b || a.nome_completo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(b) || a.codigo.toLowerCase().includes(b));
  }, [l, busca]);
  const feitos = l?.assistidos.filter((a) => a.situacao === 'registrado').length ?? 0;
  const podeData = pode('evolucoes.editar_data');
  const mudarSemana = (n: number) => l && setSp({ data: somarDias(l.data, n * 7) }, { replace: true });

  const toast = useToast();
  const [marcando, setMarcando] = useState<string | null>(null);
  /** Falta com um toque, sem abrir o formulário. */
  const registrarFalta = async (a: ItemRotina) => {
    if (!l) return;
    setMarcando(a.id);
    try {
      await api.post('/evolucoes', { assistido_id: a.id, data: l.data, turno, tipo: 'individual', participacao: 'nao_realizada',
        atividades: [], avaliacoes: [], finalizar: true });
      toast('ok', `Falta de ${a.nome_completo.split(' ')[0]} registrada. Toque no nome para editar ou excluir.`);
      recarregar();
    } catch (e: any) { toast('erro', e.message); } finally { setMarcando(null); }
  };

  const abrir = (a: ItemRotina) => {
    if (a.evolucao_id) nav(pode('evolucoes.corrigir') ? `/registro/${a.evolucao_id}` : `/evolucoes/${a.evolucao_id}`);
    else if (a.rascunho_id) nav(`/registro/${a.rascunho_id}`);
    else nav(`/rotina/${turno}/${dia}/${a.id}${qs({ data: l?.data })}`);
  };

  return (
    <>
      <nav className="trilha" aria-label="Navegação"><Link to={`/?turno=${turno}`}>‹ {NOME_TURNO[turno]}</Link></nav>
      <div className="cab-pagina">
        <div>
          <h1>{NOME_TURNO[turno]} · {DIAS[Number(dia)]}</h1>
          <p className="sub">{l ? `${data(l.data)}${l.data === hojeISO() ? ' (hoje)' : ''} · ${feitos} de ${l.assistidos.length} registrados` : ' '}</p>
        </div>
        {l && podeData && (
          <div className="acoes" aria-label="Semana">
            <button className="btn sec peq" onClick={() => mudarSemana(-1)}>‹ Semana anterior</button>
            <button className="btn sec peq" disabled={somarDias(l.data, 7) > hojeISO()} onClick={() => mudarSemana(1)}>Próxima ›</button>
          </div>
        )}
      </div>
      <ErroCaixa erro={erro} tentar={recarregar} />
      {carregando && !l && <Carregando />}
      {l && (
        <>
          {l.assistidos.length > 6 && (
            <Campo rotulo="Buscar na lista">{(p) => <input {...p} type="search" placeholder="Nome ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />}</Campo>
          )}
          {!l.assistidos.length ? (
            <Vazio>
              Nenhum assistido previsto para {NOME_TURNO[turno].toLowerCase()} de {DIAS[Number(dia)].toLowerCase()}.
              {pode('assistidos.editar') && <div style={{ marginTop: 10 }}><Link className="btn" to="/assistidos/novo">+ Cadastrar assistido</Link></div>}
            </Vazio>
          ) : (
            <ul className="lista-assistidos">
              {filtrados.map((a) => (
                <li key={a.id} className="linha-assistido">
                  <button type="button" className={`item-assistido ${a.situacao}`} onClick={() => abrir(a)}>
                    <span className="avatar" aria-hidden>{a.nome_completo.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()}</span>
                    <span className="item-texto">
                      <strong>{a.nome_completo}</strong>
                      <span className="mudo pequeno">{a.idade != null ? `${a.idade} anos` : 'Idade não informada'}{a.cids.length ? ` · CID ${a.cids.join(', ')}` : ''}</span>
                    </span>
                    <span className={`tag ${{ registrado: 'verde', falta: 'vermelho', rascunho: 'ambar', pendente: '' }[a.situacao]}`}>
                      {{ registrado: '✓ Registrado', falta: '✗ Faltou', rascunho: 'Em andamento', pendente: 'Registrar' }[a.situacao]}
                    </span>
                  </button>
                  {a.situacao === 'pendente' && pode('evolucoes.registrar') && (
                    <button type="button" className="btn sec peq botao-falta" disabled={marcando === a.id}
                      aria-label={`Registrar falta de ${a.nome_completo}`} onClick={() => registrarFalta(a)}>
                      {marcando === a.id ? '…' : 'Faltou'}
                    </button>
                  )}
                </li>
              ))}
              {!filtrados.length && <Vazio>Nenhum nome corresponde à busca.</Vazio>}
            </ul>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Registro rápido: atividades, comportamentos (0–5) e observações
// ---------------------------------------------------------------------------
export function RegistroRapido() {
  const { turno: turnoRota, dia, assistidoId, evolucaoId } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const confirmar = useConfirmar();
  const { pode } = useAuth();
  const ind = useCarregar<Indicador[]>('/indicadores');
  const ativ = useCarregar<Atividade[]>('/atividades');
  const existente = useCarregar<any>(evolucaoId ? `/evolucoes/${evolucaoId}` : null);
  const aid = assistidoId ?? existente.dados?.assistido_id ?? null;
  const assistido = useCarregar<any>(aid ? `/assistidos/${aid}` : null, [aid]);

  const [conteudo, setConteudo] = useState<Conteudo>(conteudoVazio());
  const [faltou, setFaltou] = useState(sp.get('falta') === '1');
  const [ident, setIdent] = useState({ data: sp.get('data') ?? hojeISO(), turno: turnoRota ?? 'manha' });
  const [motivo, setMotivo] = useState('');
  const [excluindo, setExcluindo] = useState(false);
  const [motivoExclusao, setMotivoExclusao] = useState('');
  const [alterado, setAlterado] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [verAnamnese, setVerAnamnese] = useState(false);

  const ex = existente.dados;
  const edicao = ex?.status === 'finalizada';          // registro já salvo: alterar exige motivo
  const original = { data: ex?.data ?? sp.get('data') ?? hojeISO(), turno: ex?.turno ?? turnoRota ?? 'manha' };
  const diaRota = dia ?? String(new Date(`${original.data}T12:00:00`).getDay());

  useEffect(() => {
    if (!ex) return;
    setConteudo(conteudoDeRegistro(ex));
    setFaltou(ex.tipo === 'individual' && ex.participacao === 'nao_realizada');
    setIdent({ data: ex.data, turno: ex.turno });
  }, [ex]);
  useEffect(() => {
    if (!alterado) return;
    const h = (ev: BeforeUnloadEvent) => { ev.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [alterado]);

  const set = (c: Conteudo) => { setConteudo(c); setAlterado(true); };
  const voltar = `/rotina/${original.turno}/${diaRota}${qs({ data: original.data !== hojeISO() ? original.data : null })}`;

  if (ex?.status === 'excluida') {
    return (
      <div className="aviso atencao">
        <strong>Registro excluído</strong> em {dataHora(ex.excluida_em)}. Motivo: {ex.motivo_exclusao}
        <div style={{ marginTop: 8 }}><Link to={`/evolucoes/${evolucaoId}`}>Ver detalhes</Link></div>
      </div>
    );
  }
  if (ex?.atividade_coletiva_id) {
    return <div className="aviso info">Este registro faz parte de uma atividade em grupo. <Link to={`/grupos/${ex.atividade_coletiva_id}/editar`}>Abrir atividade em grupo</Link></div>;
  }
  if (edicao && !pode('evolucoes.corrigir')) {
    return <div className="aviso info">Este registro já foi salvo. <Link to={`/evolucoes/${evolucaoId}`}>Ver registro</Link></div>;
  }
  if (ind.carregando || ativ.carregando || existente.carregando || (aid && assistido.carregando && !assistido.dados)) return <Carregando />;
  const erroCarga = ind.erro || ativ.erro || existente.erro || assistido.erro;
  if (erroCarga) return <ErroCaixa erro={erroCarga} />;
  const a = assistido.dados;
  if (!a) return <ErroCaixa erro={{ message: 'Assistido não encontrado.' }} />;
  const nome = a.nome_completo.split(' ')[0];

  const payload = (finalizar: boolean) => ({
    assistido_id: a.id, data: ident.data, turno: ident.turno, tipo: 'individual',
    ...(faltou
      ? { ...conteudoParaPayload(conteudoVazio()), participacao: 'nao_realizada', texto_evolucao: conteudo.texto_evolucao }
      : { ...conteudoParaPayload(conteudo), participacao: null }),
    finalizar,
  });

  const salvar = async (finalizar: boolean) => {
    setSalvando(finalizar ? 'final' : 'rascunho'); setErro(null);
    try {
      if (edicao) await api.post(`/evolucoes/${evolucaoId}/correcoes`, { ...payload(true), motivo });
      else if (evolucaoId) await api.put(`/evolucoes/${evolucaoId}`, payload(finalizar));
      else await api.post('/evolucoes', payload(finalizar));
      setAlterado(false);
      toast('ok', edicao ? `Registro de ${nome} alterado. A versão anterior ficou no histórico.`
        : !finalizar ? 'Rascunho salvo. Você pode continuar depois.'
        : faltou ? `Falta de ${nome} registrada.` : `Registro de ${nome} salvo.`);
      nav(`/rotina/${ident.turno}/${new Date(`${ident.data}T12:00:00`).getDay()}${qs({ data: ident.data !== hojeISO() ? ident.data : null })}`);
    } catch (e) { setErro(e); window.scrollTo(0, 0); } finally { setSalvando(null); }
  };

  const excluir = async () => {
    setSalvando('excluir'); setErro(null);
    try {
      await api.post(`/evolucoes/${evolucaoId}/excluir`, { motivo: motivoExclusao });
      setAlterado(false);
      toast('ok', 'Registro excluído. Ele não aparece mais nas listas nem nos relatórios.');
      nav(voltar);
    } catch (e) { setErro(e); window.scrollTo(0, 0); } finally { setSalvando(null); }
  };

  const descartarRascunho = async () => {
    if (!(await confirmar({ titulo: 'Excluir rascunho?', texto: 'O rascunho será apagado.', confirmar: 'Excluir', perigo: true }))) return;
    try { await api.del(`/evolucoes/${evolucaoId}`); setAlterado(false); toast('ok', 'Rascunho excluído.'); nav(voltar); }
    catch (e) { setErro(e); }
  };

  const cancelar = async () => {
    if (alterado && !(await confirmar({ titulo: 'Descartar alterações?', texto: 'As alterações não salvas serão perdidas.', confirmar: 'Descartar', perigo: true }))) return;
    setAlterado(false);
    nav(voltar);
  };

  const erros = errosPorCampo(erro);
  const ativos = (ind.dados ?? []).filter((i) => i.ativo || conteudo.avaliacoes[i.id]);
  const marcados = Object.values(conteudo.avaliacoes).filter((x) => x.valor !== null).length;

  return (
    <form onSubmit={(e) => { e.preventDefault(); salvar(true); }} noValidate>
      <nav className="trilha" aria-label="Navegação"><Link to={voltar}>‹ {NOME_TURNO[original.turno]} · {DIAS[Number(diaRota)] || data(original.data)}</Link></nav>
      <div className="cartao ficha">
        <span className="avatar grande" aria-hidden>{a.nome_completo.split(' ').filter(Boolean).slice(0, 2).map((p: string) => p[0]).join('').toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ marginBottom: 2 }}>{a.nome_completo}</h1>
          <div className="mudo">
            {a.idade != null ? `${a.idade} anos` : 'Idade não informada'}
            {a.diagnosticos?.filter((d: any) => d.cid_codigo).map((d: any) => <span key={d.id} className="tag azul" style={{ marginLeft: 6 }} title={d.cid_descricao ?? d.descricao}>CID {d.cid_codigo}</span>)}
          </div>
          {!edicao && <div className="pequeno" style={{ marginTop: 4 }}>{NOME_TURNO[ident.turno]} · {data(ident.data)}{ident.data === hojeISO() ? ' (hoje)' : ''}</div>}
          {a.anamnese && (
            <button type="button" className="btn-link pequeno" aria-expanded={verAnamnese} onClick={() => setVerAnamnese(!verAnamnese)}>
              {verAnamnese ? 'Ocultar anamnese' : 'Ver anamnese'}
            </button>
          )}
          {verAnamnese && <p className="pre pequeno anamnese">{a.anamnese}</p>}
        </div>
      </div>
      <ErroCaixa erro={erro} />

      {edicao && (
        <section className="cartao destaque-edicao" aria-labelledby="t-edicao">
          <h2 id="t-edicao">Editar registro salvo</h2>
          <p className="mudo pequeno">Corrija a data, o turno ou os dados abaixo. A versão anterior fica guardada no histórico.</p>
          <div className="linha-campos">
            <Campo rotulo="Data" erro={erros.data} ajuda={!pode('evolucoes.editar_data') ? 'Somente usuários autorizados alteram a data.' : undefined}>
              {(p) => <input {...p} type="date" max={hojeISO()} value={ident.data} disabled={!pode('evolucoes.editar_data')}
                onChange={(e) => { setIdent({ ...ident, data: e.target.value }); setAlterado(true); }} />}
            </Campo>
            <Campo rotulo="Turno">
              {(p) => <select {...p} value={ident.turno} onChange={(e) => { setIdent({ ...ident, turno: e.target.value }); setAlterado(true); }}>
                <option value="manha">Manhã</option><option value="tarde">Tarde</option></select>}
            </Campo>
          </div>
          <Campo rotulo="O que estava errado?" obrigatorio erro={erros.motivo}>
            {(p) => <input {...p} type="text" placeholder="Ex.: data errada, marquei o comportamento errado" value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
          </Campo>
        </section>
      )}

      <div className="presenca" role="group" aria-label="Presença">
        <button type="button" className={!faltou ? 'ativo' : ''} aria-pressed={!faltou} onClick={() => { setFaltou(false); setAlterado(true); }}>✓ Compareceu</button>
        <button type="button" className={faltou ? 'ativo falta' : ''} aria-pressed={faltou} onClick={() => { setFaltou(true); setAlterado(true); }}>✗ Faltou</button>
      </div>

      {!faltou && (
        <>
          <section className="cartao" aria-labelledby="t-ativ">
            <h2 id="t-ativ">1. Atividades</h2>
            <SecaoAtividades atividades={ativ.dados ?? []} conteudo={conteudo} setConteudo={set} mostrarRealizacao={false}
              onNovaAtividade={(n) => ativ.setDados([...(ativ.dados ?? []), n])} />
          </section>

          <section className="cartao" aria-labelledby="t-comp">
            <h2 id="t-comp">2. Comportamentos <span className="contador">{marcados} marcado(s)</span></h2>
            <p className="mudo pequeno">Marque de 0 a 5 o que foi observado. Deixe em “–” o que não foi avaliado (não é o mesmo que 0). Toque de novo no número para desmarcar.</p>
            <div className="comportamentos">
              {ativos.map((i) => (
                <MarcadorComportamento key={i.id} ind={i} valor={conteudo.avaliacoes[i.id]?.valor ?? null}
                  onChange={(v) => set({ ...conteudo, avaliacoes: { ...conteudo.avaliacoes, [i.id]: { valor: v, observacao: conteudo.avaliacoes[i.id]?.observacao ?? '' } } })} />
              ))}
            </div>
            <NovoComportamento onCriado={async (id) => {
              ind.recarregar();
              set({ ...conteudo, avaliacoes: { ...conteudo.avaliacoes, [id]: { valor: null, observacao: '' } } });
            }} />
          </section>
        </>
      )}

      <section className="cartao" aria-labelledby="t-obs">
        <h2 id="t-obs">{faltou ? 'Motivo da falta (opcional)' : '3. Observações'}</h2>
        <Campo rotulo={faltou ? 'Motivo ou aviso recebido' : 'Anotações sobre o dia'} erro={erros.texto_evolucao}
          ajuda={faltou ? 'Ex.: avisou que estava doente; sem aviso.' : 'Descreva fatos observados: participação, conquistas, dificuldades, apoio necessário e ocorrências.'}>
          {(p) => <textarea {...p} className={faltou ? '' : 'amplo'} value={conteudo.texto_evolucao} onChange={(e) => set({ ...conteudo, texto_evolucao: e.target.value })} />}
        </Campo>
      </section>

      {excluindo && (
        <section className="cartao destaque-exclusao" aria-labelledby="t-excluir">
          <h2 id="t-excluir">Excluir este registro?</h2>
          <p className="pequeno">Use quando o registro foi lançado por engano (assistido, dia ou turno errados). Ele sai das listas e dos relatórios;
            a exclusão fica registrada na auditoria com seu nome e o motivo.</p>
          <Campo rotulo="Motivo da exclusão" obrigatorio erro={erros.motivo}>
            {(p) => <input {...p} type="text" autoFocus placeholder="Ex.: lançado no assistido errado" value={motivoExclusao} onChange={(e) => setMotivoExclusao(e.target.value)} />}
          </Campo>
          <div className="acoes">
            <button type="button" className="btn perigo" disabled={salvando === 'excluir' || motivoExclusao.trim().length < 5} onClick={excluir}>
              {salvando === 'excluir' ? 'Excluindo…' : 'Confirmar exclusão'}</button>
            <button type="button" className="btn sec" onClick={() => setExcluindo(false)}>Voltar</button>
          </div>
        </section>
      )}

      <div className="barra-acoes">
        <button type="submit" className="btn verde grande" disabled={!!salvando || (edicao && motivo.trim().length < 5)}>
          {salvando === 'final' ? 'Salvando…' : edicao ? '✓ Salvar alterações' : faltou ? '✓ Registrar falta' : '✓ Salvar registro'}</button>
        {!edicao && <button type="button" className="btn sec" disabled={!!salvando} onClick={() => salvar(false)}>{salvando === 'rascunho' ? 'Salvando…' : 'Salvar rascunho'}</button>}
        <button type="button" className="btn sec" disabled={!!salvando} onClick={cancelar}>Cancelar</button>
        {edicao && !excluindo && <button type="button" className="btn perigo" onClick={() => setExcluindo(true)}>Excluir registro</button>}
        {ex?.status === 'rascunho' && <button type="button" className="btn perigo" onClick={descartarRascunho}>Excluir rascunho</button>}
      </div>
    </form>
  );
}

/** Linha compacta de marcação 0–5, com "–" para não avaliado. */
function MarcadorComportamento({ ind, valor, onChange }: { ind: Indicador; valor: number | null; onChange: (v: number | null) => void }) {
  const valores = Array.from({ length: ind.maximo - ind.minimo + 1 }, (_, i) => ind.minimo + i);
  const nivel = valor === null ? null : ind.niveis.find((n) => n.valor === valor);
  return (
    <div className={`comportamento ${ind.direcao === 'menor_melhor' ? 'monitorar' : ''}`} role="group" aria-label={ind.nome}>
      <div className="comportamento-nome">
        <strong>{ind.nome}</strong>
        <span className="mudo pequeno">{valor === null ? 'Não avaliado' : `${valor} — ${nivel?.descricao ?? ''}`}</span>
      </div>
      <div className="pontos">
        <button type="button" className={valor === null ? 'marcado nulo' : ''} aria-pressed={valor === null} aria-label="Não avaliado" title="Não avaliado" onClick={() => onChange(null)}>–</button>
        {valores.map((v) => (
          <button key={v} type="button" className={valor === v ? 'marcado' : ''} aria-pressed={valor === v}
            aria-label={`${v} — ${ind.niveis.find((n) => n.valor === v)?.descricao ?? ''}`}
            title={ind.niveis.find((n) => n.valor === v)?.descricao} onClick={() => onChange(valor === v ? null : v)}>{v}</button>
        ))}
      </div>
    </div>
  );
}

/** Acrescenta um novo comportamento (parâmetro) com escala padrão 0–5. */
function NovoComportamento({ onCriado }: { onCriado: (id: string) => void }) {
  const { pode } = useAuth();
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'positivo' | 'monitoramento'>('positivo');
  const [erro, setErro] = useState<unknown>(null);
  const [salvando, setSalvando] = useState(false);
  if (!pode('indicadores.criar') && !pode('config.indicadores')) return null;
  if (!aberto) return <button type="button" className="btn sec peq" style={{ marginTop: 10 }} onClick={() => setAberto(true)}>+ Adicionar comportamento</button>;
  const criar = async () => {
    setSalvando(true); setErro(null);
    try {
      const r = await api.post<{ id: string }>('/indicadores', { nome: nome.trim(), tipo });
      toast('ok', `"${nome.trim()}" adicionado e disponível nos próximos registros.`);
      onCriado(r.id);
      setNome(''); setAberto(false);
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };
  return (
    <div className="cartao" style={{ background: 'var(--azul-50)', marginTop: 10 }}>
      <h3>Novo comportamento</h3>
      <ErroCaixa erro={erro} />
      <Campo rotulo="Nome" obrigatorio>{(p) => <input {...p} type="text" placeholder="Ex.: Autorregulação, Comunicação, Irritabilidade" value={nome} onChange={(e) => setNome(e.target.value)} />}</Campo>
      <fieldset>
        <legend>Como ler a escala</legend>
        <div className="opcoes">
          <label className="chip"><input type="radio" name="tipo-comp" checked={tipo === 'positivo'} onChange={() => setTipo('positivo')} />Quanto maior, melhor (ex.: atenção)</label>
          <label className="chip"><input type="radio" name="tipo-comp" checked={tipo === 'monitoramento'} onChange={() => setTipo('monitoramento')} />Comportamento a monitorar (ex.: agressividade)</label>
        </div>
      </fieldset>
      <div className="acoes">
        <button type="button" className="btn" disabled={salvando || nome.trim().length < 2} onClick={criar}>{salvando ? 'Salvando…' : 'Adicionar'}</button>
        <button type="button" className="btn sec" onClick={() => setAberto(false)}>Cancelar</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mais opções
// ---------------------------------------------------------------------------
export function Mais() {
  const { pode, sair, usuario } = useAuth();
  const itens = [
    { to: '/atividades', ico: '🎵', titulo: 'Atividades', texto: 'Catálogo de atividades usado nos registros.' },
    { to: '/indicadores', ico: '📈', titulo: 'Comportamentos e gráficos', texto: 'Evolução de cada comportamento ao longo do tempo e escalas.' },
    { to: '/grupos', ico: '👥', titulo: 'Atividades em grupo', texto: 'Registrar uma atividade com vários participantes.' },
    ...(pode('evolucoes.registrar') ? [{ to: '/evolucoes/nova', ico: '✎', titulo: 'Registro detalhado', texto: 'Formulário completo, com campos complementares.' }] : []),
    { to: '/painel', ico: '◧', titulo: 'Painel do dia', texto: 'Números do dia, pendências e registros recentes.' },
    { to: '/configuracoes', ico: '⚙', titulo: 'Usuários e configurações', texto: 'Equipe, permissões, instituição e dias de funcionamento.' },
    { to: '/minha-conta', ico: '🔑', titulo: 'Minha conta', texto: 'Trocar a senha.' },
  ];
  return (
    <>
      <div className="cab-pagina"><div><h1>Mais</h1><p className="sub">{usuario!.nome}</p></div></div>
      <div className="grade grade-3">
        {itens.map((i) => (
          <Link key={i.to} to={i.to} className="cartao cartao-link">
            <span className="cartao-link-ico" aria-hidden>{i.ico}</span>
            <strong>{i.titulo}</strong>
            <span className="mudo pequeno">{i.texto}</span>
          </Link>
        ))}
      </div>
      <button className="btn sec" onClick={sair}>Sair</button>
    </>
  );
}
