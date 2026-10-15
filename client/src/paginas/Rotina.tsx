import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { DIAS, data, hojeISO } from '../formato';
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
  situacao: 'pendente' | 'rascunho' | 'registrado'; evolucao_id: string | null; rascunho_id: string | null;
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

  const abrir = (a: ItemRotina) => {
    if (a.situacao === 'registrado') nav(`/evolucoes/${a.evolucao_id}`);
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
                <li key={a.id}>
                  <button type="button" className={`item-assistido ${a.situacao}`} onClick={() => abrir(a)}>
                    <span className="avatar" aria-hidden>{a.nome_completo.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()}</span>
                    <span className="item-texto">
                      <strong>{a.nome_completo}</strong>
                      <span className="mudo pequeno">{a.idade != null ? `${a.idade} anos` : 'Idade não informada'}{a.cids.length ? ` · CID ${a.cids.join(', ')}` : ''}</span>
                    </span>
                    <span className={`tag ${a.situacao === 'registrado' ? 'verde' : a.situacao === 'rascunho' ? 'ambar' : ''}`}>
                      {a.situacao === 'registrado' ? '✓ Registrado' : a.situacao === 'rascunho' ? 'Em andamento' : 'Registrar'}
                    </span>
                  </button>
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
  const ind = useCarregar<Indicador[]>('/indicadores');
  const ativ = useCarregar<Atividade[]>('/atividades');
  const existente = useCarregar<any>(evolucaoId ? `/evolucoes/${evolucaoId}` : null);
  const aid = assistidoId ?? existente.dados?.assistido_id ?? null;
  const assistido = useCarregar<any>(aid ? `/assistidos/${aid}` : null, [aid]);

  const [conteudo, setConteudo] = useState<Conteudo>(conteudoVazio());
  const [alterado, setAlterado] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [verAnamnese, setVerAnamnese] = useState(false);

  const dataReg: string = existente.dados?.data ?? sp.get('data') ?? hojeISO();
  const turno: string = existente.dados?.turno ?? turnoRota ?? 'manha';
  const diaRota = dia ?? String(new Date(`${dataReg}T12:00:00`).getDay());

  useEffect(() => { if (existente.dados) setConteudo(conteudoDeRegistro(existente.dados)); }, [existente.dados]);
  useEffect(() => {
    if (!alterado) return;
    const h = (ev: BeforeUnloadEvent) => { ev.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [alterado]);

  const set = (c: Conteudo) => { setConteudo(c); setAlterado(true); };
  const voltar = `/rotina/${turno}/${diaRota}${qs({ data: dataReg !== hojeISO() ? dataReg : null })}`;

  if (existente.dados && existente.dados.status === 'finalizada') {
    return <div className="aviso info">Este registro já foi concluído. <Link to={`/evolucoes/${evolucaoId}`}>Ver registro</Link></div>;
  }
  if (existente.dados?.atividade_coletiva_id) {
    return <div className="aviso info">Este registro faz parte de uma atividade em grupo. <Link to={`/grupos/${existente.dados.atividade_coletiva_id}/editar`}>Abrir atividade em grupo</Link></div>;
  }
  if (ind.carregando || ativ.carregando || existente.carregando || (aid && assistido.carregando && !assistido.dados)) return <Carregando />;
  const erroCarga = ind.erro || ativ.erro || existente.erro || assistido.erro;
  if (erroCarga) return <ErroCaixa erro={erroCarga} />;
  const a = assistido.dados;
  if (!a) return <ErroCaixa erro={{ message: 'Assistido não encontrado.' }} />;

  const salvar = async (finalizar: boolean) => {
    setSalvando(finalizar ? 'final' : 'rascunho'); setErro(null);
    const payload = { assistido_id: a.id, data: dataReg, turno, tipo: 'individual', ...conteudoParaPayload(conteudo), finalizar };
    try {
      if (evolucaoId) await api.put(`/evolucoes/${evolucaoId}`, payload);
      else await api.post('/evolucoes', payload);
      setAlterado(false);
      toast('ok', finalizar ? `Registro de ${a.nome_completo.split(' ')[0]} salvo.` : 'Rascunho salvo. Você pode continuar depois.');
      nav(voltar);
    } catch (e) { setErro(e); window.scrollTo(0, 0); } finally { setSalvando(null); }
  };

  const cancelar = async () => {
    if (alterado && !(await confirmar({ titulo: 'Descartar alterações?', texto: 'As marcações não salvas serão perdidas.', confirmar: 'Descartar', perigo: true }))) return;
    setAlterado(false);
    nav(voltar);
  };

  const erros = errosPorCampo(erro);
  const ativos = (ind.dados ?? []).filter((i) => i.ativo || conteudo.avaliacoes[i.id]);
  const marcados = Object.values(conteudo.avaliacoes).filter((x) => x.valor !== null).length;

  return (
    <form onSubmit={(e) => { e.preventDefault(); salvar(true); }} noValidate>
      <nav className="trilha" aria-label="Navegação"><Link to={voltar}>‹ {NOME_TURNO[turno]} · {DIAS[Number(diaRota)] ?? data(dataReg)}</Link></nav>
      <div className="cartao ficha">
        <span className="avatar grande" aria-hidden>{a.nome_completo.split(' ').filter(Boolean).slice(0, 2).map((p: string) => p[0]).join('').toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ marginBottom: 2 }}>{a.nome_completo}</h1>
          <div className="mudo">
            {a.idade != null ? `${a.idade} anos` : 'Idade não informada'}
            {a.diagnosticos?.filter((d: any) => d.cid_codigo).map((d: any) => <span key={d.id} className="tag azul" style={{ marginLeft: 6 }} title={d.cid_descricao ?? d.descricao}>CID {d.cid_codigo}</span>)}
          </div>
          <div className="pequeno" style={{ marginTop: 4 }}>{NOME_TURNO[turno]} · {data(dataReg)}{dataReg === hojeISO() ? ' (hoje)' : ''}</div>
          {a.anamnese && (
            <button type="button" className="btn-link pequeno" aria-expanded={verAnamnese} onClick={() => setVerAnamnese(!verAnamnese)}>
              {verAnamnese ? 'Ocultar anamnese' : 'Ver anamnese'}
            </button>
          )}
          {verAnamnese && <p className="pre pequeno anamnese">{a.anamnese}</p>}
        </div>
      </div>
      <ErroCaixa erro={erro} />

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

      <section className="cartao" aria-labelledby="t-obs">
        <h2 id="t-obs">3. Observações</h2>
        <Campo rotulo="Anotações sobre o dia" erro={erros.texto_evolucao}
          ajuda="Descreva fatos observados: participação, conquistas, dificuldades, apoio necessário e ocorrências.">
          {(p) => <textarea {...p} className="amplo" value={conteudo.texto_evolucao} onChange={(e) => set({ ...conteudo, texto_evolucao: e.target.value })} />}
        </Campo>
      </section>

      <div className="barra-acoes">
        <button type="submit" className="btn verde grande" disabled={!!salvando}>{salvando === 'final' ? 'Salvando…' : '✓ Salvar registro'}</button>
        <button type="button" className="btn sec" disabled={!!salvando} onClick={() => salvar(false)}>{salvando === 'rascunho' ? 'Salvando…' : 'Salvar rascunho'}</button>
        <button type="button" className="btn sec" disabled={!!salvando} onClick={cancelar}>Cancelar</button>
        {evolucaoId && <Link className="btn-link" to={`/evolucoes/${evolucaoId}/editar`}>Formulário completo</Link>}
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
