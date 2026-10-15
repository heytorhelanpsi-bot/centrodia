import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, baixar, qs } from '../api';
import { useAuth } from '../auth';
import { DIAS, DIAS_CURTOS, TURNOS, data, dataHora, diasAtras, hojeISO } from '../formato';
import { Abas, Campo, Carregando, ErroCaixa, errosPorCampo, useCarregar, useConfirmar, useToast, Vazio } from '../componentes/ui';
import { GraficosIndicadores } from '../componentes/graficos';
import { LinhaDoTempo } from './Historico';

export function Assistidos() {
  const { pode } = useAuth();
  const [f, setF] = useState({ busca: '', turno: '', dia: '', status: 'ativo' });
  const [buscaDeb, setBuscaDeb] = useState('');
  useEffect(() => { const t = setTimeout(() => setBuscaDeb(f.busca), 250); return () => clearTimeout(t); }, [f.busca]);
  const { dados, erro, carregando, recarregar } = useCarregar<any[]>(`/assistidos${qs({ ...f, busca: buscaDeb })}`);
  const nav = useNavigate();
  return (
    <>
      <div className="cab-pagina">
        <div><h1>Assistidos</h1><p className="sub">Cadastro, consulta e histórico individual</p></div>
        {pode('assistidos.editar') && <Link className="btn grande" to="/assistidos/novo">+ Novo assistido</Link>}
      </div>
      <div className="cartao">
        <div className="linha-campos">
          <Campo rotulo="Pesquisar por nome ou código">{(p) => <input {...p} type="search" value={f.busca} onChange={(e) => setF({ ...f, busca: e.target.value })} placeholder="Ex.: Maria ou PD-00012" />}</Campo>
          <Campo rotulo="Turno">{(p) => (
            <select {...p} value={f.turno} onChange={(e) => setF({ ...f, turno: e.target.value })}>
              <option value="">Todos</option><option value="manha">Manhã</option><option value="tarde">Tarde</option><option value="ambos">Ambos os turnos</option>
            </select>)}</Campo>
          <Campo rotulo="Dia de atendimento">{(p) => (
            <select {...p} value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })}>
              <option value="">Todos</option>{DIAS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
            </select>)}</Campo>
          <Campo rotulo="Situação">{(p) => (
            <select {...p} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="ativo">Ativos</option><option value="arquivado">Arquivados</option><option value="todos">Todos</option>
            </select>)}</Campo>
        </div>
      </div>
      <ErroCaixa erro={erro} tentar={recarregar} />
      {carregando && !dados ? <Carregando /> : dados && (
        <div className="cartao">
          {!dados.length ? <Vazio>Nenhum assistido encontrado com os filtros atuais.</Vazio> : (
            <div className="tabela-wrap">
              <table>
                <caption className="sr-only">Lista de assistidos</caption>
                <thead><tr><th>Nome</th><th>Código</th><th>Idade</th><th>Turno</th><th>Dias</th><th>Situação</th></tr></thead>
                <tbody>
                  {dados.map((a) => (
                    <tr key={a.id} className="clicavel" onClick={() => nav(`/assistidos/${a.id}`)}>
                      <td><Link to={`/assistidos/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.nome_completo}</Link>{a.exemplo && <> <span className="tag ambar">Exemplo</span></>}</td>
                      <td>{a.codigo}</td><td>{a.idade} anos</td><td>{TURNOS[a.turno_habitual]}</td>
                      <td>{a.dias_atendimento.map((d: number) => DIAS_CURTOS[d]).join(', ') || '—'}</td>
                      <td>{a.status === 'ativo' ? <span className="tag verde">Ativo</span> : <span className="tag">Arquivado</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mudo pequeno" style={{ marginTop: 8 }}>{dados.length} assistido(s). Exibidos apenas os cadastros aos quais você tem acesso.</p>
        </div>
      )}
    </>
  );
}

interface Diag { descricao: string; cid_codigo: string | null; situacao: string; fonte_documental: string | null; cid_descricao?: string }

function calcIdade(nasc: string) {
  if (!nasc) return null;
  const [a, m, d] = nasc.split('-').map(Number);
  const h = new Date();
  let i = h.getFullYear() - a;
  if (h.getMonth() + 1 < m || (h.getMonth() + 1 === m && h.getDate() < d)) i--;
  return i >= 0 ? i : null;
}

export function AssistidoForm() {
  const { id } = useParams();
  const { pode } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const existente = useCarregar<any>(id ? `/assistidos/${id}` : null);
  const { dados: cfg } = useCarregar<any>('/config');
  const [f, setF] = useState({ nome_completo: '', idade: '', data_nascimento: '', anamnese: '', turno_habitual: 'ambos',
    dias_atendimento: [] as number[], observacoes_restritas: '' });
  const [diags, setDiags] = useState<Diag[]>([diagVazio()]);
  const [comNascimento, setComNascimento] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [salvando, setSalvando] = useState(false);
  const [duplicados, setDuplicados] = useState<any[]>([]);
  const diasCentro: number[] = cfg?.rotina?.dias ?? [1, 3, 5];

  useEffect(() => {
    const a = existente.dados;
    if (!a) return;
    setF({ nome_completo: a.nome_completo, idade: a.idade != null ? String(a.idade) : '', data_nascimento: a.data_nascimento ?? '',
      anamnese: a.anamnese ?? '', turno_habitual: a.turno_habitual, dias_atendimento: a.dias_atendimento, observacoes_restritas: a.observacoes_restritas ?? '' });
    setComNascimento(!!a.data_nascimento);
    setDiags(a.diagnosticos.length ? a.diagnosticos : [diagVazio()]);
  }, [existente.dados]);
  // Novo cadastro: começa com os dias de funcionamento do centro marcados.
  useEffect(() => { if (!id && cfg) setF((x) => (x.dias_atendimento.length ? x : { ...x, dias_atendimento: diasCentro })); }, [cfg, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Verificação de duplicidade enquanto digita.
  useEffect(() => {
    if (f.nome_completo.trim().length < 5) { setDuplicados([]); return; }
    const t = setTimeout(() => {
      api.get(`/assistidos/verificar-duplicidade${qs({ nome: f.nome_completo, data_nascimento: comNascimento ? f.data_nascimento || undefined : undefined, ignorar: id })}`)
        .then(setDuplicados).catch(() => setDuplicados([]));
    }, 400);
    return () => clearTimeout(t);
  }, [f.nome_completo, f.data_nascimento, comNascimento, id]);

  const erros = errosPorCampo(erro);
  const idadeNasc = comNascimento ? calcIdade(f.data_nascimento) : null;

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setSalvando(true); setErro(null);
    const corpo = {
      nome_completo: f.nome_completo, anamnese: f.anamnese, turno_habitual: f.turno_habitual, dias_atendimento: f.dias_atendimento,
      idade: comNascimento ? null : f.idade === '' ? null : Number(f.idade),
      data_nascimento: comNascimento ? f.data_nascimento || null : null,
      diagnosticos: diags.filter((d) => d.cid_codigo || d.descricao.trim())
        .map((d) => ({ ...d, descricao: d.descricao.trim() || d.cid_descricao || d.cid_codigo || '', cid_codigo: d.cid_codigo || null })),
      observacoes_restritas: f.observacoes_restritas || null, manter_observacoes_restritas: !pode('assistidos.observacoes_restritas'),
    };
    try {
      if (id) { await api.put(`/assistidos/${id}`, corpo); toast('ok', 'Cadastro atualizado com sucesso.'); nav(`/assistidos/${id}`); }
      else { const r = await api.post('/assistidos', corpo); toast('ok', `Assistido cadastrado com o código ${r.codigo}.`); nav(`/assistidos/${r.id}`); }
    } catch (er) { setErro(er); window.scrollTo(0, 0); } finally { setSalvando(false); }
  };

  if (id && existente.carregando) return <Carregando />;
  if (id && existente.erro) return <ErroCaixa erro={existente.erro} />;

  return (
    <form onSubmit={salvar} noValidate>
      <div className="cab-pagina"><div><h1>{id ? 'Editar cadastro' : 'Novo assistido'}</h1>
        <p className="sub">{id ? existente.dados?.codigo : 'Campos obrigatórios: nome, idade, CID e anamnese.'}</p></div></div>
      <ErroCaixa erro={erro} />
      <div className="cartao">
        <h2>Dados essenciais</h2>
        <Campo rotulo="Nome completo" obrigatorio erro={erros.nome_completo}>
          {(p) => <input {...p} type="text" autoComplete="off" value={f.nome_completo} onChange={(e) => setF({ ...f, nome_completo: e.target.value })} />}
        </Campo>
        {duplicados.length > 0 && (
          <div className="aviso atencao" role="status">
            <strong>Possível cadastro duplicado:</strong>
            <ul>{duplicados.map((d) => <li key={d.id}><Link to={`/assistidos/${d.id}`}>{d.nome_completo}</Link> · {d.codigo}{d.data_nascimento ? ` · nasc. ${data(d.data_nascimento)}` : ''} {d.status === 'arquivado' && '(arquivado)'}</li>)}</ul>
          </div>
        )}
        <div className="linha-campos">
          {comNascimento ? (
            <Campo rotulo="Data de nascimento" obrigatorio erro={erros.data_nascimento || erros.idade} ajuda={idadeNasc !== null ? `Idade: ${idadeNasc} anos` : undefined}>
              {(p) => <input {...p} type="date" max={hojeISO()} value={f.data_nascimento} onChange={(e) => setF({ ...f, data_nascimento: e.target.value })} />}
            </Campo>
          ) : (
            <Campo rotulo="Idade (anos)" obrigatorio erro={erros.idade}>
              {(p) => <input {...p} type="number" min={0} max={120} inputMode="numeric" value={f.idade} onChange={(e) => setF({ ...f, idade: e.target.value })} />}
            </Campo>
          )}
          <div className="campo" style={{ alignSelf: 'end' }}>
            <button type="button" className="btn-link" onClick={() => setComNascimento(!comNascimento)}>
              {comNascimento ? 'Informar só a idade' : 'Prefiro informar a data de nascimento'}
            </button>
          </div>
        </div>

        <fieldset>
          <legend>CID <span className="mudo">(obrigatório, ao menos um)</span></legend>
          {erros.diagnosticos && <p className="erro-campo" role="alert">{erros.diagnosticos}</p>}
          {diags.map((d, i) => (
            <EditorDiagnostico key={i} d={d} onChange={(n) => setDiags(diags.map((x, j) => (j === i ? n : x)))}
              onRemover={diags.length > 1 ? () => setDiags(diags.filter((_, j) => j !== i)) : undefined} />
          ))}
          <button type="button" className="btn sec peq" onClick={() => setDiags([...diags, diagVazio()])}>+ Outro CID</button>
        </fieldset>

        <Campo rotulo="Anamnese" obrigatorio erro={erros.anamnese}
          ajuda="Histórico relevante: desenvolvimento, saúde, rotina familiar, medicações, preferências, sinais de alerta e objetivos do acompanhamento.">
          {(p) => <textarea {...p} className="amplo" value={f.anamnese} onChange={(e) => setF({ ...f, anamnese: e.target.value })} />}
        </Campo>
      </div>

      <div className="cartao">
        <h2>Quando frequenta o centro</h2>
        <p className="mudo pequeno">Define em quais listas (turno e dia) o assistido aparece na tela inicial.</p>
        <fieldset>
          <legend>Turno</legend>
          <div className="opcoes">
            {[['manha', 'Manhã'], ['tarde', 'Tarde'], ['ambos', 'Manhã e tarde']].map(([v, r]) => (
              <label key={v} className="chip"><input type="radio" name="turno" checked={f.turno_habitual === v} onChange={() => setF({ ...f, turno_habitual: v })} />{r}</label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Dias</legend>
          <div className="opcoes">
            {DIAS.slice(1).map((d, i) => (diasCentro.includes(i + 1) || f.dias_atendimento.includes(i + 1)) && (
              <label key={d} className="chip">
                <input type="checkbox" checked={f.dias_atendimento.includes(i + 1)}
                  onChange={(e) => setF({ ...f, dias_atendimento: e.target.checked ? [...f.dias_atendimento, i + 1].sort() : f.dias_atendimento.filter((x) => x !== i + 1) })} />{d}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {pode('assistidos.observacoes_restritas') && (
        <details className="secao">
          <summary>Observações restritas (opcional) <span className="tag vermelho">Acesso restrito</span></summary>
          <div className="conteudo">
            <Campo rotulo="Observações restritas" ajuda="Armazenadas cifradas; visíveis somente a perfis autorizados. Cada acesso é registrado.">
              {(p) => <textarea {...p} value={f.observacoes_restritas} onChange={(e) => setF({ ...f, observacoes_restritas: e.target.value })} />}
            </Campo>
          </div>
        </details>
      )}
      <div className="barra-acoes">
        <button className="btn grande" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar cadastro'}</button>
        <button type="button" className="btn sec grande" onClick={() => nav(-1)}>Cancelar</button>
      </div>
    </form>
  );
}

function diagVazio(): Diag { return { descricao: '', cid_codigo: null, situacao: 'pendente_documentacao', fonte_documental: null }; }

function EditorDiagnostico({ d, onChange, onRemover }: { d: Diag; onChange: (d: Diag) => void; onRemover?: () => void }) {
  const { pode } = useAuth();
  const toast = useToast();
  const [busca, setBusca] = useState(d.cid_codigo ?? '');
  const [res, setRes] = useState<any[]>([]);
  const [pesquisado, setPesquisado] = useState('');   // termo cuja busca já terminou
  const [detalhes, setDetalhes] = useState(false);
  useEffect(() => { if (d.cid_codigo && busca !== d.cid_codigo) setBusca(d.cid_codigo); }, [d.cid_codigo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (busca.length < 2 || busca === d.cid_codigo) { setRes([]); return; }
    const t = setTimeout(() => api.get(`/cid?busca=${encodeURIComponent(busca)}`).then(setRes).catch(() => setRes([]))
      .finally(() => setPesquisado(busca)), 250);
    return () => clearTimeout(t);
  }, [busca, d.cid_codigo]);
  const codigoDigitado = busca.trim().toUpperCase();
  const pareceCid = /^[A-Z]\d{2}(\.\d{1,2})?$/.test(codigoDigitado);
  const inserirManual = async () => {
    try {
      await api.post('/cid', { codigo: codigoDigitado, descricao: d.descricao.trim() || codigoDigitado });
      onChange({ ...d, cid_codigo: codigoDigitado, cid_descricao: d.descricao.trim() || undefined });
      toast('ok', `CID ${codigoDigitado} incluído no catálogo.`);
    } catch (e: any) { toast('erro', e.message); }
  };
  return (
    <div className="indicador">
      <div className="linha-campos">
        <Campo rotulo="Código CID" obrigatorio ajuda={d.cid_codigo ? `✓ ${d.cid_codigo}${d.cid_descricao ? ` — ${d.cid_descricao}` : ''}` : 'Digite o código (ex.: F84.0) ou parte da descrição'}>
          {(p) => <input {...p} type="search" value={busca} onChange={(e) => { setBusca(e.target.value); if (d.cid_codigo) onChange({ ...d, cid_codigo: null }); }} />}
        </Campo>
        <Campo rotulo="Descrição">{(p) => <input {...p} type="text" placeholder="Preenchida ao escolher o CID" value={d.descricao} onChange={(e) => onChange({ ...d, descricao: e.target.value })} />}</Campo>
      </div>
      {res.length > 0 && (
        <ul className="lista-simples" style={{ marginBottom: 8 }}>
          {res.slice(0, 6).map((c) => (
            <li key={c.codigo}><span><strong>{c.codigo}</strong> — {c.descricao}</span>
              <button type="button" className="btn sec peq" onClick={() => { onChange({ ...d, cid_codigo: c.codigo, cid_descricao: c.descricao, descricao: d.descricao || c.descricao }); setBusca(c.codigo); setRes([]); }}>Usar</button></li>
          ))}
        </ul>
      )}
      {busca.length >= 3 && pesquisado === busca && !res.length && !d.cid_codigo && (
        pode('cid.inserir_manual') && pareceCid
          ? <div className="acoes"><span className="pequeno">“{codigoDigitado}” não está no catálogo.</span><button type="button" className="btn peq" onClick={inserirManual}>Usar e incluir no catálogo</button></div>
          : <p className="mudo pequeno">Código não encontrado no catálogo.{pode('cid.inserir_manual') ? ' Digite no formato A00 ou A00.0 para incluí-lo.' : ' A inclusão requer autorização.'}</p>
      )}
      <div className="acoes">
        <button type="button" className="btn-link pequeno" aria-expanded={detalhes} onClick={() => setDetalhes(!detalhes)}>{detalhes ? 'Ocultar documentação' : 'Documentação (opcional)'}</button>
        {onRemover && <button type="button" className="btn-link pequeno" style={{ color: 'var(--vermelho-700)' }} onClick={onRemover}>Remover</button>}
      </div>
      {detalhes && (
        <div className="linha-campos">
          <Campo rotulo="Situação documental">{(p) => (
            <select {...p} value={d.situacao} onChange={(e) => onChange({ ...d, situacao: e.target.value })}>
              <option value="documentado_prontuario">Documentado no prontuário</option>
              <option value="pendente_documentacao">Informado — pendente de documentação</option>
            </select>)}</Campo>
          <Campo rotulo="Fonte documental">{(p) => <input {...p} type="text" placeholder="Ex.: laudo de 03/2025" value={d.fonte_documental ?? ''} onChange={(e) => onChange({ ...d, fonte_documental: e.target.value || null })} />}</Campo>
        </div>
      )}
    </div>
  );
}

type Aba = 'dados' | 'historico' | 'indicadores' | 'ia';

export function AssistidoDetalhe() {
  const { id } = useParams();
  const { pode } = useAuth();
  const toast = useToast();
  const confirmar = useConfirmar();
  const [aba, setAba] = useState<Aba>('dados');
  const { dados: a, erro, carregando, recarregar } = useCarregar<any>(`/assistidos/${id}`);
  if (carregando && !a) return <Carregando />;
  if (erro) return <ErroCaixa erro={erro} />;
  if (!a) return null;

  const arquivar = async () => {
    const arq = a.status === 'ativo';
    const ok = await confirmar({
      titulo: arq ? 'Arquivar cadastro?' : 'Reativar cadastro?',
      texto: arq ? <p>O cadastro de <strong>{a.nome_completo}</strong> será arquivado. Todo o histórico clínico é preservado e o cadastro pode ser reativado depois.</p>
        : <p>O cadastro voltará a aparecer nas listas e poderá receber novos registros.</p>,
      confirmar: arq ? 'Arquivar' : 'Reativar', perigo: arq,
    });
    if (!ok) return;
    try { await api.post(`/assistidos/${id}/arquivar`, { arquivar: arq }); toast('ok', arq ? 'Cadastro arquivado.' : 'Cadastro reativado.'); recarregar(); }
    catch (e: any) { toast('erro', e.message); }
  };

  return (
    <>
      <div className="cab-pagina">
        <div>
          <h1>{a.nome_completo}</h1>
          <p className="sub">{a.codigo} · {a.idade} anos · {TURNOS[a.turno_habitual]}
            {a.status === 'arquivado' && <> · <span className="tag">Arquivado</span></>}{a.exemplo && <> · <span className="tag ambar">Registro de exemplo</span></>}</p>
        </div>
        <div className="acoes">
          {a.status === 'ativo' && pode('evolucoes.registrar') && <Link className="btn" to={`/evolucoes/nova?assistido=${a.id}`}>✎ Registrar evolução</Link>}
          {pode('assistidos.editar') && !a.anonimizado_em && <Link className="btn sec" to={`/assistidos/${a.id}/editar`}>Editar</Link>}
          {pode('assistidos.arquivar') && !a.anonimizado_em && <button className="btn sec" onClick={arquivar}>{a.status === 'ativo' ? 'Arquivar' : 'Reativar'}</button>}
        </div>
      </div>
      <Abas rotulo="Seções do assistido" atual={aba} onChange={setAba} abas={[
        { id: 'dados', rotulo: 'Dados cadastrais' }, { id: 'historico', rotulo: 'Histórico' },
        { id: 'indicadores', rotulo: 'Indicadores' }, { id: 'ia', rotulo: 'Análises e relatórios' },
      ]} />
      {aba === 'dados' && <DadosCadastrais a={a} />}
      {aba === 'historico' && <LinhaDoTempo assistidoId={a.id} />}
      {aba === 'indicadores' && <IndicadoresAssistido assistidoId={a.id} />}
      {aba === 'ia' && <AnalisesAssistido a={a} />}
    </>
  );
}

function DadosCadastrais({ a }: { a: any }) {
  const { pode } = useAuth();
  const toast = useToast();
  return (
    <div className="grade grade-2">
      <div className="cartao">
        <h2>Cadastro</h2>
        <dl className="grade" style={{ gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', margin: 0 }}>
          <dt className="negrito">Código</dt><dd style={{ margin: 0 }}>{a.codigo}</dd>
          <dt className="negrito">Idade</dt><dd style={{ margin: 0 }}>{a.idade != null ? `${a.idade} anos` : 'Não informada'}{a.data_nascimento ? ` (nasc. ${data(a.data_nascimento)})` : ''}</dd>
          <dt className="negrito">Turno habitual</dt><dd style={{ margin: 0 }}>{TURNOS[a.turno_habitual]}</dd>
          <dt className="negrito">Dias</dt><dd style={{ margin: 0 }}>{a.dias_atendimento.map((d: number) => DIAS[d]).join(', ') || 'Não definidos'}</dd>
          <dt className="negrito">Cadastrado em</dt><dd style={{ margin: 0 }}>{dataHora(a.criado_em)} por {a.criado_por_nome}</dd>
          {a.arquivado_em && <><dt className="negrito">Arquivado em</dt><dd style={{ margin: 0 }}>{dataHora(a.arquivado_em)}</dd></>}
          {a.anonimizado_em && <><dt className="negrito">Anonimizado em</dt><dd style={{ margin: 0 }}>{dataHora(a.anonimizado_em)}</dd></>}
        </dl>
      </div>
      <div className="cartao">
        <h2>Anamnese</h2>
        {a.anamnese ? <p className="pre">{a.anamnese}</p> : <p className="mudo">Não preenchida. Edite o cadastro para registrá-la.</p>}
      </div>
      <div className="cartao">
        <h2>CID e diagnósticos</h2>
        {!a.diagnosticos.length ? <p className="mudo">Nenhum diagnóstico registrado.</p> : (
          <ul className="lista-simples">
            {a.diagnosticos.map((d: any) => (
              <li key={d.id}><span>{d.descricao}{d.cid_codigo && <> — <strong>{d.cid_codigo}</strong></>}<br />
                <span className="mudo pequeno">{d.fonte_documental ? `Fonte: ${d.fonte_documental} · ` : ''}registrado por {d.criado_por_nome}</span></span>
                {d.situacao === 'documentado_prontuario' ? <span className="tag verde">Documentado</span> : <span className="tag ambar">Pendente de documentação</span>}</li>
            ))}
          </ul>
        )}
      </div>
      {pode('assistidos.observacoes_restritas') && (
        <div className="cartao">
          <h2>Observações restritas <span className="tag vermelho">Acesso restrito</span></h2>
          <p className="pre">{a.observacoes_restritas || <span className="mudo">Nenhuma observação.</span>}</p>
        </div>
      )}
      {pode('lgpd.gerenciar') && (
        <div className="cartao">
          <h2>Direitos do titular (LGPD)</h2>
          <p className="mudo pequeno">Exportação completa dos dados do titular. A anonimização é feita em Usuários e configurações › LGPD.</p>
          <button className="btn sec" onClick={() => baixar(`/lgpd/assistidos/${a.id}/exportar`, `dados-${a.codigo}.json`).catch((e) => toast('erro', e.message))}>Exportar dados do titular (JSON)</button>
        </div>
      )}
    </div>
  );
}

function IndicadoresAssistido({ assistidoId }: { assistidoId: string }) {
  const [p, setP] = useState({ inicio: diasAtras(90), fim: hojeISO() });
  return (
    <>
      <div className="cartao">
        <div className="linha-campos">
          <Campo rotulo="De">{(x) => <input {...x} type="date" value={p.inicio} max={p.fim} onChange={(e) => setP({ ...p, inicio: e.target.value })} />}</Campo>
          <Campo rotulo="Até">{(x) => <input {...x} type="date" value={p.fim} max={hojeISO()} onChange={(e) => setP({ ...p, fim: e.target.value })} />}</Campo>
        </div>
      </div>
      <GraficosIndicadores assistidoId={assistidoId} inicio={p.inicio} fim={p.fim} />
    </>
  );
}

function AnalisesAssistido({ a }: { a: any }) {
  const { pode } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { dados: analises } = useCarregar<any[]>(`/ia/analises?assistido_id=${a.id}`);
  const { dados: relatorios } = useCarregar<any[]>(pode('relatorios.elaborar') || pode('relatorios.ver_aprovados') ? `/relatorios?assistido_id=${a.id}` : null);
  const { dados: ia } = useCarregar<{ disponivel: boolean }>('/ia/status');
  const [p, setP] = useState({ inicio: diasAtras(30), fim: hojeISO(), incluir_diagnosticos: false });
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const gerar = async () => {
    setGerando(true); setErro(null);
    try {
      const r = await api.post('/ia/analises/longitudinal', { assistido_id: a.id, ...p });
      toast('ok', 'Minuta de análise gerada. Revise antes de utilizar.');
      nav(`/analises/${r.id}`);
    } catch (e) { setErro(e); } finally { setGerando(false); }
  };
  return (
    <div className="grade grade-2">
      {pode('ia.gerar') && (
        <div className="cartao">
          <h2>Análise longitudinal com IA</h2>
          {ia && !ia.disponivel && <div className="aviso atencao">A integração com IA não está configurada neste servidor.</div>}
          <div className="opcoes" style={{ marginBottom: 10 }}>
            {[30, 60, 90].map((n) => <button key={n} type="button" className="btn sec peq" onClick={() => setP({ ...p, inicio: diasAtras(n), fim: hojeISO() })}>Últimos {n} dias</button>)}
          </div>
          <div className="linha-campos">
            <Campo rotulo="De">{(x) => <input {...x} type="date" value={p.inicio} onChange={(e) => setP({ ...p, inicio: e.target.value })} />}</Campo>
            <Campo rotulo="Até">{(x) => <input {...x} type="date" value={p.fim} max={hojeISO()} onChange={(e) => setP({ ...p, fim: e.target.value })} />}</Campo>
          </div>
          <label className="chip" style={{ marginBottom: 10 }}><input type="checkbox" checked={p.incluir_diagnosticos} onChange={(e) => setP({ ...p, incluir_diagnosticos: e.target.checked })} />Incluir diagnósticos registrados</label>
          <p className="mudo pequeno">O nome e a data de nascimento não são enviados ao serviço de IA. O resultado é uma minuta para revisão profissional.</p>
          <ErroCaixa erro={erro} />
          <button className="btn" disabled={gerando || !ia?.disponivel} onClick={gerar}>{gerando ? 'Gerando análise… (pode levar até 1 minuto)' : 'Gerar análise do período'}</button>
          {pode('relatorios.elaborar') && <Link className="btn sec" style={{ marginLeft: 8 }} to={`/relatorios/novo?assistido=${a.id}`}>Elaborar relatório</Link>}
        </div>
      )}
      <div className="cartao">
        <h2>Análises produzidas pela IA</h2>
        {!analises?.length ? <p className="mudo">Nenhuma análise.</p> : (
          <ul className="lista-simples">{analises.map((x) => (
            <li key={x.id}><span><span className="tag ia">IA</span> {x.tipo === 'evolucao' ? 'Análise de evolução' : `Análise ${data(x.periodo_inicio)}–${data(x.periodo_fim)}`}
              <br /><span className="mudo pequeno">{dataHora(x.gerado_em)} · {x.gerado_por_nome}</span></span>
              <span className="acoes"><EtiquetaStatus s={x.status} /><Link className="btn sec peq" to={`/analises/${x.id}`}>Abrir</Link></span></li>))}</ul>
        )}
      </div>
      {relatorios && (
        <div className="cartao">
          <h2>Relatórios</h2>
          {!relatorios.length ? <p className="mudo">Nenhum relatório.</p> : (
            <ul className="lista-simples">{relatorios.map((r) => (
              <li key={r.id}><span>{r.titulo}<br /><span className="mudo pequeno">{data(r.periodo_inicio)}–{data(r.periodo_fim)}</span></span>
                <span className="acoes"><EtiquetaStatus s={r.status} /><Link className="btn sec peq" to={`/relatorios/${r.id}`}>Abrir</Link></span></li>))}</ul>
          )}
        </div>
      )}
    </div>
  );
}

export function EtiquetaStatus({ s }: { s: string }) {
  const m: Record<string, [string, string]> = {
    minuta: ['Minuta — revisão pendente', 'ambar'], revisada: ['Revisada', 'verde'], aprovado: ['Aprovado', 'verde'],
    descartada: ['Descartada', ''], arquivado: ['Arquivado', ''], rascunho: ['Rascunho', 'ambar'], finalizada: ['Finalizada', 'verde'],
  };
  const [t, c] = m[s] ?? [s, ''];
  return <span className={`tag ${c}`}>{t}</span>;
}
