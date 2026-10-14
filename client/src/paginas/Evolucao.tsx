import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { APOIO, PARTICIPACAO, REALIZACAO, TURNOS, data, dataHora, hojeISO, turnoAtual } from '../formato';
import { BuscaAssistido, Campo, Carregando, ErroCaixa, errosPorCampo, useCarregar, useConfirmar, useToast, type AssistidoResumo } from '../componentes/ui';
import {
  CAMPOS_TEXTO, conteudoDeRegistro, conteudoParaPayload, conteudoVazio, SecaoAtividades, SecaoIndicadores, SecaoTextos, SelectApoio,
  type Atividade, type Conteudo, type Indicador,
} from '../componentes/registro';
import { EtiquetaStatus } from './Assistidos';

/** Formulário de evolução individual — criação, edição de rascunho e correção auditada. */
export function EvolucaoForm({ correcao }: { correcao?: boolean }) {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { pode } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const confirmar = useConfirmar();
  const ind = useCarregar<Indicador[]>('/indicadores');
  const ativ = useCarregar<Atividade[]>('/atividades');
  const existente = useCarregar<any>(id ? `/evolucoes/${id}` : null);
  const { dados: ia } = useCarregar<{ disponivel: boolean }>('/ia/status');

  const [assistido, setAssistido] = useState<AssistidoResumo | null>(null);
  const [ident, setIdent] = useState({ data: hojeISO(), horario: '', turno: turnoAtual() as string, duracao_minutos: '', local: '' });
  const [conteudo, setConteudo] = useState<Conteudo>(conteudoVazio());
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<unknown>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [rascunhoId, setRascunhoId] = useState<string | null>(id ?? null);
  const [alterado, setAlterado] = useState(false);

  // Pré-seleção a partir do dashboard/ficha do assistido.
  useEffect(() => {
    const aid = sp.get('assistido');
    if (aid && !id) api.get(`/assistidos/${aid}`).then(setAssistido).catch(() => {});
  }, [sp, id]);

  useEffect(() => {
    const e = existente.dados;
    if (!e) return;
    setAssistido({ id: e.assistido_id, nome_completo: e.assistido_nome, codigo: e.assistido_codigo, idade: 0, turno_habitual: '', dias_atendimento: [], status: 'ativo' });
    setIdent({ data: e.data, horario: e.horario ?? '', turno: e.turno, duracao_minutos: e.duracao_minutos ? String(e.duracao_minutos) : '', local: e.local ?? '' });
    setConteudo(conteudoDeRegistro(e));
  }, [existente.dados]);

  // Aviso ao sair com alterações não salvas.
  useEffect(() => {
    if (!alterado) return;
    const h = (ev: BeforeUnloadEvent) => { ev.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [alterado]);

  const versoesRegistradas = useMemo(() => {
    const e = existente.dados;
    if (!e) return undefined;
    return Object.fromEntries(e.avaliacoes.map((a: any) => [a.indicador_id, { versao: a.escala_versao, minimo: a.minimo, maximo: a.maximo, niveis: a.niveis }]));
  }, [existente.dados]);

  const indicadoresVisiveis = useMemo(() => {
    const todos = ind.dados ?? [];
    // Mantém indicadores inativos que já tenham avaliação neste registro.
    return todos.filter((i) => i.ativo || conteudo.avaliacoes[i.id]);
  }, [ind.dados, conteudo.avaliacoes]);

  const recomendados = useMemo(() => {
    const ids = new Set<string>();
    for (const aid of Object.keys(conteudo.atividades)) for (const r of ativ.dados?.find((a) => a.id === aid)?.indicadores_recomendados ?? []) ids.add(r);
    return ids;
  }, [conteudo.atividades, ativ.dados]);

  const set = (c: Conteudo) => { setConteudo(c); setAlterado(true); };
  const erros = errosPorCampo(erro);
  const ehGrupo = existente.dados?.atividade_coletiva_id;

  if (existente.dados && existente.dados.status === 'finalizada' && !correcao) {
    return <div className="aviso info">Este registro já foi finalizado. <Link to={`/evolucoes/${id}`}>Ver registro</Link></div>;
  }
  if (ehGrupo && !correcao) {
    return <div className="aviso info">Este registro faz parte de uma atividade em grupo. <Link to={`/grupos/${ehGrupo}/editar`}>Editar pelo módulo de grupos</Link></div>;
  }

  const payload = () => ({
    assistido_id: assistido?.id, ...ident,
    duracao_minutos: ident.duracao_minutos ? Number(ident.duracao_minutos) : null,
    tipo: existente.dados?.tipo ?? 'individual',
    ...conteudoParaPayload(conteudo),
  });

  const salvar = async (modo: 'rascunho' | 'final' | 'proxima' | 'ia') => {
    if (!assistido) { setErro({ message: 'Selecione o assistido.', detalhes: [{ campo: 'assistido_id', mensagem: 'Selecione o assistido.' }] }); window.scrollTo(0, 0); return; }
    setSalvando(modo); setErro(null);
    try {
      let rid = rascunhoId;
      if (correcao) {
        await api.post(`/evolucoes/${id}/correcoes`, { ...payload(), motivo });
        toast('ok', 'Correção registrada. O histórico da alteração foi preservado.');
        setAlterado(false);
        nav(`/evolucoes/${id}`);
        return;
      }
      const finalizar = modo !== 'rascunho';
      if (rid) await api.put(`/evolucoes/${rid}`, { ...payload(), finalizar });
      else rid = (await api.post('/evolucoes', { ...payload(), finalizar })).id;
      setRascunhoId(rid);
      setAlterado(false);
      if (!finalizar) {
        setSalvoEm(new Date().toISOString());
        toast('ok', 'Rascunho salvo. Você pode retomá-lo pelo painel inicial.');
        if (!id) nav(`/evolucoes/${rid}/editar`, { replace: true });
        return;
      }
      toast('ok', 'Evolução salva e finalizada com sucesso.');
      if (modo === 'proxima') {
        setAssistido(null); setConteudo(conteudoVazio()); setRascunhoId(null); setSalvoEm(null);
        nav('/evolucoes/nova', { replace: true }); window.scrollTo(0, 0);
      } else if (modo === 'ia') {
        try {
          const an = await api.post('/ia/analises/evolucao', { evolucao_id: rid });
          nav(`/analises/${an.id}`);
        } catch (e: any) { toast('erro', `Evolução salva, mas a análise não foi gerada: ${e.message}`); nav(`/evolucoes/${rid}`); }
      } else nav(`/evolucoes/${rid}`);
    } catch (e) { setErro(e); window.scrollTo(0, 0); } finally { setSalvando(null); }
  };

  const cancelar = async () => {
    if (alterado && !(await confirmar({ titulo: 'Descartar alterações?', texto: 'As alterações não salvas serão perdidas.', confirmar: 'Descartar', perigo: true }))) return;
    setAlterado(false);
    nav(-1);
  };

  const descartarRascunho = async () => {
    if (!(await confirmar({ titulo: 'Excluir rascunho?', texto: 'O rascunho será excluído definitivamente. Registros finalizados nunca são excluídos.', confirmar: 'Excluir rascunho', perigo: true }))) return;
    try { await api.del(`/evolucoes/${rascunhoId}`); toast('ok', 'Rascunho excluído.'); setAlterado(false); nav('/'); } catch (e: any) { toast('erro', e.message); }
  };

  if (ind.carregando || ativ.carregando || (id && existente.carregando)) return <Carregando />;
  const erroCarga = ind.erro || ativ.erro || existente.erro;
  if (erroCarga) return <ErroCaixa erro={erroCarga} />;

  const nAvaliados = Object.values(conteudo.avaliacoes).filter((a) => a.valor !== null).length;
  const ocupado = !!salvando;

  return (
    <form onSubmit={(e) => { e.preventDefault(); salvar('final'); }} noValidate>
      <div className="cab-pagina">
        <div>
          <h1>{correcao ? 'Registrar correção' : rascunhoId ? 'Continuar evolução (rascunho)' : 'Registrar evolução'}</h1>
          <p className="sub">{correcao ? 'O registro original e a nova versão ficarão guardados no histórico.' : 'Preenchimento rápido: identifique, marque as atividades, pontue e descreva.'}</p>
        </div>
        {salvoEm && <span className="tag verde" role="status">Rascunho salvo às {new Date(salvoEm).toLocaleTimeString('pt-BR', { timeStyle: 'short' })}</span>}
      </div>
      <ErroCaixa erro={erro} />

      {correcao && (
        <div className="cartao" style={{ borderColor: '#f0d38a' }}>
          <Campo rotulo="Motivo da correção" obrigatorio erro={erros.motivo} ajuda="Ficará registrado com seu nome, data e as versões anterior e nova.">
            {(p) => <input {...p} type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
          </Campo>
        </div>
      )}

      <details className="secao" open>
        <summary>A. Identificação do atendimento</summary>
        <div className="conteudo">
          <BuscaAssistido valor={assistido} onSelecionar={(a) => { setAssistido(a); setAlterado(true); }} desabilitado={!!id} erro={erros.assistido_id} />
          <div className="linha-campos">
            <Campo rotulo="Data do atendimento" obrigatorio erro={erros.data} ajuda={!pode('evolucoes.editar_data') ? 'Somente usuários autorizados alteram a data.' : undefined}>
              {(p) => <input {...p} type="date" value={ident.data} max={hojeISO()} disabled={!pode('evolucoes.editar_data')} onChange={(e) => { setIdent({ ...ident, data: e.target.value }); setAlterado(true); }} />}
            </Campo>
            <Campo rotulo="Turno" obrigatorio>
              {(p) => <select {...p} value={ident.turno} onChange={(e) => { setIdent({ ...ident, turno: e.target.value }); setAlterado(true); }}>
                <option value="manha">Manhã</option><option value="tarde">Tarde</option></select>}
            </Campo>
            <Campo rotulo="Horário ou período">{(p) => <input {...p} type="text" placeholder="Ex.: 9h–10h" value={ident.horario} onChange={(e) => { setIdent({ ...ident, horario: e.target.value }); setAlterado(true); }} />}</Campo>
            <Campo rotulo="Duração (min, opcional)">{(p) => <input {...p} type="number" min={1} max={720} inputMode="numeric" value={ident.duracao_minutos} onChange={(e) => { setIdent({ ...ident, duracao_minutos: e.target.value }); setAlterado(true); }} />}</Campo>
          </div>
          <div className="linha-campos">
            <Campo rotulo="Contexto ou local (opcional)">{(p) => <input {...p} type="text" placeholder="Ex.: sala de música, pátio" value={ident.local} onChange={(e) => { setIdent({ ...ident, local: e.target.value }); setAlterado(true); }} />}</Campo>
            <SelectApoio conteudo={conteudo} setConteudo={set} />
          </div>
          {existente.dados?.tipo === 'participacao_coletiva' && (
            <Campo rotulo="Participação na atividade coletiva">
              {(p) => <select {...p} value={conteudo.participacao ?? ''} onChange={(e) => set({ ...conteudo, participacao: e.target.value || null })}>
                {Object.entries(PARTICIPACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
            </Campo>
          )}
          <p className="mudo pequeno">Profissional responsável: você (vinculado ao usuário autenticado). Tipo: {existente.dados?.tipo === 'participacao_coletiva' ? 'participação individual em atividade coletiva' : 'atendimento individual'}.</p>
        </div>
      </details>

      <details className="secao" open>
        <summary>B. Atividades <span className="contador">{Object.keys(conteudo.atividades).length} selecionada(s)</span></summary>
        <div className="conteudo">
          <SecaoAtividades atividades={ativ.dados ?? []} conteudo={conteudo} setConteudo={set} erro={erros.atividades}
            onNovaAtividade={(a) => ativ.setDados([...(ativ.dados ?? []), a])} />
        </div>
      </details>

      <details className="secao" open>
        <summary>C. Indicadores comportamentais e funcionais <span className="contador">{nAvaliados} avaliado(s)</span></summary>
        <div className="conteudo">
          {recomendados.size > 0 && <p className="aviso info pequeno">Indicadores recomendados para as atividades selecionadas aparecem primeiro.</p>}
          <SecaoIndicadores conteudo={conteudo} setConteudo={set} versoesRegistradas={versoesRegistradas} erros={erros}
            indicadores={[...indicadoresVisiveis].sort((a, b) => Number(recomendados.has(b.id)) - Number(recomendados.has(a.id)))} />
        </div>
      </details>

      <details className="secao" open>
        <summary>D. Evolução e observações</summary>
        <div className="conteudo"><SecaoTextos conteudo={conteudo} setConteudo={set} erro={erros.texto_evolucao} /></div>
      </details>

      <div className="barra-acoes" role="group" aria-label="Ações do registro">
        {correcao ? (
          <button type="submit" className="btn grande" disabled={ocupado}>{salvando ? 'Salvando…' : 'Salvar correção'}</button>
        ) : (
          <>
            <button type="submit" className="btn grande" disabled={ocupado}>{salvando === 'final' ? 'Salvando…' : '✓ Salvar evolução'}</button>
            <button type="button" className="btn sec grande" disabled={ocupado} onClick={() => salvar('rascunho')}>{salvando === 'rascunho' ? 'Salvando…' : 'Salvar rascunho'}</button>
            <button type="button" className="btn sec grande" disabled={ocupado} onClick={() => salvar('proxima')}>{salvando === 'proxima' ? 'Salvando…' : 'Salvar e registrar próxima'}</button>
            {pode('ia.gerar') && (
              <button type="button" className="btn sec grande" disabled={ocupado || !ia?.disponivel} title={!ia?.disponivel ? 'IA não configurada no servidor' : undefined}
                onClick={() => salvar('ia')}>{salvando === 'ia' ? 'Salvando e analisando…' : '✦ Salvar e gerar análise com IA'}</button>
            )}
            {rascunhoId && <button type="button" className="btn perigo" disabled={ocupado} onClick={descartarRascunho}>Excluir rascunho</button>}
          </>
        )}
        <button type="button" className="btn sec grande" disabled={ocupado} onClick={cancelar}>Cancelar</button>
      </div>
    </form>
  );
}

export function EvolucaoDetalhe() {
  const { id } = useParams();
  const { pode, usuario } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { dados: e, erro, carregando } = useCarregar<any>(`/evolucoes/${id}`);
  const { dados: ia } = useCarregar<{ disponivel: boolean }>('/ia/status');
  const [gerando, setGerando] = useState(false);
  const [incluirDiag, setIncluirDiag] = useState(false);
  if (carregando) return <Carregando />;
  if (erro) return <ErroCaixa erro={erro} />;
  if (!e) return null;
  const podeCorrigir = e.status === 'finalizada' && pode('evolucoes.corrigir') && (e.profissional_id === usuario!.id || usuario!.perfil === 'admin');
  const gerar = async () => {
    setGerando(true);
    try { const r = await api.post('/ia/analises/evolucao', { evolucao_id: e.id, incluir_diagnosticos: incluirDiag }); nav(`/analises/${r.id}`); }
    catch (er: any) { toast('erro', er.message); } finally { setGerando(false); }
  };
  return (
    <>
      <div className="cab-pagina">
        <div>
          <h1>Evolução — {e.assistido_nome}</h1>
          <p className="sub">{data(e.data)} · {TURNOS[e.turno]}{e.horario ? ` · ${e.horario}` : ''} · {e.tipo === 'individual' ? 'Atendimento individual' : `Grupo: ${e.coletiva_nome}`} · {e.profissional_nome}</p>
        </div>
        <div className="acoes">
          <EtiquetaStatus s={e.status} />{e.versao > 1 && <span className="tag azul">Versão {e.versao}</span>}
          {e.status === 'rascunho' && e.profissional_id === usuario!.id && !e.atividade_coletiva_id && <Link className="btn" to={`/evolucoes/${e.id}/editar`}>Continuar rascunho</Link>}
          {podeCorrigir && <Link className="btn sec" to={`/evolucoes/${e.id}/corrigir`}>Registrar correção</Link>}
          <Link className="btn sec" to={`/assistidos/${e.assistido_id}`}>Ficha do assistido</Link>
        </div>
      </div>
      <div className="grade grade-2">
        <div className="cartao">
          <h2>Atividades</h2>
          {!e.atividades.length ? <p className="mudo">Nenhuma atividade informada.</p> : (
            <ul className="lista-simples">{e.atividades.map((a: any) => <li key={a.atividade_id}><span>{a.nome}</span>{a.realizacao && <span className="tag">{REALIZACAO[a.realizacao]}</span>}</li>)}</ul>
          )}
          <p className="pequeno" style={{ marginTop: 10 }}>
            {e.participacao && <>Participação: <strong>{PARTICIPACAO[e.participacao]}</strong> · </>}
            {e.nivel_apoio && <>Nível de apoio: <strong>{APOIO[e.nivel_apoio]}</strong> · </>}
            {e.duracao_minutos && <>Duração: {e.duracao_minutos} min · </>}{e.local && <>Local: {e.local}</>}
          </p>
        </div>
        <div className="cartao">
          <h2>Indicadores</h2>
          {!e.avaliacoes.length ? <p className="mudo">Nenhum indicador avaliado neste registro.</p> : (
            <ul className="lista-simples">{e.avaliacoes.map((a: any) => (
              <li key={a.indicador_id}><span>{a.nome}<br /><span className="mudo pequeno">
                {a.valor === null ? 'Não avaliado' : a.niveis.find((n: any) => n.valor === a.valor)?.descricao} · escala v{a.escala_versao} ({a.minimo}–{a.maximo})
                {a.observacao ? ` · ${a.observacao}` : ''}</span></span>
                <strong style={{ fontSize: '1.2rem' }}>{a.valor ?? '—'}</strong></li>))}</ul>
          )}
        </div>
      </div>
      <div className="cartao">
        <h2>Evolução do atendimento</h2>
        <p className="pre">{e.texto_evolucao || <span className="mudo">Não preenchido.</span>}</p>
        {CAMPOS_TEXTO.filter((c) => e[c.chave]).map((c) => <div key={c.chave} style={{ marginTop: 12 }}><h3>{c.rotulo}</h3><p className="pre">{e[c.chave]}</p></div>)}
        <p className="mudo pequeno" style={{ marginTop: 12 }}>Criado em {dataHora(e.criado_em)}{e.finalizada_em && ` · finalizado em ${dataHora(e.finalizada_em)}`}</p>
      </div>
      {e.status === 'finalizada' && pode('ia.gerar') && (
        <div className="cartao">
          <h2>Análise com IA</h2>
          <p className="mudo pequeno">Gera uma minuta organizada a partir deste registro. Nome e data de nascimento não são enviados. Revisão humana obrigatória.</p>
          <label className="chip" style={{ marginBottom: 10 }}><input type="checkbox" checked={incluirDiag} onChange={(x) => setIncluirDiag(x.target.checked)} />Incluir diagnósticos registrados</label>
          <div className="acoes">
            <button className="btn" disabled={gerando || !ia?.disponivel} onClick={gerar}>{gerando ? 'Gerando…' : '✦ Gerar análise com IA'}</button>
            {ia && !ia.disponivel && <span className="mudo pequeno">IA não configurada no servidor.</span>}
          </div>
          {e.analises.length > 0 && <ul className="lista-simples" style={{ marginTop: 10 }}>{e.analises.map((a: any) => (
            <li key={a.id}><span><span className="tag ia">IA</span> {dataHora(a.gerado_em)}</span><span className="acoes"><EtiquetaStatus s={a.status} /><Link className="btn sec peq" to={`/analises/${a.id}`}>Abrir</Link></span></li>))}</ul>}
        </div>
      )}
      {e.correcoes.length > 0 && (
        <div className="cartao">
          <h2>Histórico de correções</h2>
          {e.correcoes.map((c: any, i: number) => (
            <details key={c.id} className="secao">
              <summary>Correção {i + 1} — {dataHora(c.alterado_em)} por {c.alterado_por_nome}</summary>
              <div className="conteudo">
                <p><strong>Motivo:</strong> {c.motivo}</p>
                <Diferencas antes={c.dados_anteriores} depois={c.dados_novos} />
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

const ROTULOS: Record<string, string> = {
  data: 'Data', turno: 'Turno', horario: 'Horário', duracao_minutos: 'Duração', local: 'Local', participacao: 'Participação', nivel_apoio: 'Nível de apoio',
  texto_evolucao: 'Evolução', ...Object.fromEntries(CAMPOS_TEXTO.map((c) => [c.chave, c.rotulo])),
};

function Diferencas({ antes, depois }: { antes: any; depois: any }) {
  if (!depois) return null;
  const linhas: { campo: string; a: string; d: string }[] = [];
  for (const k of Object.keys(ROTULOS)) if (String(antes[k] ?? '') !== String(depois[k] ?? '')) linhas.push({ campo: ROTULOS[k], a: antes[k] ?? '—', d: depois[k] ?? '—' });
  const fmtAt = (x: any) => x.atividades.map((a: any) => a.nome).join(', ');
  if (fmtAt(antes) !== fmtAt(depois)) linhas.push({ campo: 'Atividades', a: fmtAt(antes), d: fmtAt(depois) });
  const fmtAv = (x: any) => x.avaliacoes.map((a: any) => `${a.nome}: ${a.valor ?? 'não avaliado'}`).join('; ');
  if (fmtAv(antes) !== fmtAv(depois)) linhas.push({ campo: 'Indicadores', a: fmtAv(antes), d: fmtAv(depois) });
  if (!linhas.length) return <p className="mudo">Sem diferenças de conteúdo.</p>;
  return (
    <div className="tabela-wrap"><table><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
      <tbody>{linhas.map((l) => <tr key={l.campo}><td>{l.campo}</td><td className="pre">{String(l.a)}</td><td className="pre">{String(l.d)}</td></tr>)}</tbody></table></div>
  );
}
