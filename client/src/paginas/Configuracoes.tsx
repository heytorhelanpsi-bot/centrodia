import { useEffect, useState } from 'react';
import { api, baixar, qs } from '../api';
import { useAuth } from '../auth';
import { PERFIS, data, dataHora } from '../formato';
import { Abas, BuscaAssistido, Campo, Carregando, ErroCaixa, errosPorCampo, useCarregar, useConfirmar, useToast, Vazio, type AssistidoResumo } from '../componentes/ui';

type Aba = 'usuarios' | 'permissoes' | 'instituicao' | 'auditoria' | 'lgpd' | 'cid';

export function Configuracoes() {
  const { pode, usuario } = useAuth();
  const abas = [
    ...(pode('usuarios.gerenciar') ? [{ id: 'usuarios' as Aba, rotulo: 'Usuários' }, { id: 'permissoes' as Aba, rotulo: 'Perfis e permissões' }, { id: 'instituicao' as Aba, rotulo: 'Instituição, IA e retenção' }] : []),
    ...(pode('auditoria.ver') ? [{ id: 'auditoria' as Aba, rotulo: 'Auditoria' }] : []),
    ...(pode('lgpd.gerenciar') ? [{ id: 'lgpd' as Aba, rotulo: 'LGPD' }] : []),
    ...(pode('cid.inserir_manual') && pode('usuarios.gerenciar') ? [{ id: 'cid' as Aba, rotulo: 'Catálogo CID' }] : []),
  ];
  const [aba, setAba] = useState<Aba>(abas[0]?.id ?? 'usuarios');
  return (
    <>
      <div className="cab-pagina"><div><h1>Usuários e configurações</h1><p className="sub">{usuario!.nome} · {PERFIS[usuario!.perfil]}</p></div></div>
      {!abas.length ? (
        <div className="cartao">
          <p>Seu perfil não possui permissões administrativas.</p>
          <p className="mudo">Para alterar sua senha, acesse <a href="/minha-conta">Minha conta</a>.</p>
        </div>
      ) : (
        <>
          <Abas rotulo="Seções de configuração" atual={aba} onChange={setAba} abas={abas} />
          {aba === 'usuarios' && <Usuarios />}
          {aba === 'permissoes' && <Permissoes />}
          {aba === 'instituicao' && <Instituicao />}
          {aba === 'auditoria' && <Auditoria />}
          {aba === 'lgpd' && <Lgpd />}
          {aba === 'cid' && <CidImport />}
        </>
      )}
    </>
  );
}

type FormU = { id?: string; nome: string; email: string; perfil: string; funcao: string; ativo: boolean; acesso_todos_assistidos: boolean };

function Usuarios() {
  const toast = useToast();
  const confirmar = useConfirmar();
  const { dados, erro, carregando, recarregar } = useCarregar<any[]>('/usuarios');
  const [form, setForm] = useState<FormU | null>(null);
  const [erroForm, setErroForm] = useState<unknown>(null);
  const [segredo, setSegredo] = useState<{ titulo: string; valor: string } | null>(null);
  const [atribuir, setAtribuir] = useState<any | null>(null);

  const salvar = async () => {
    if (!form) return;
    setErroForm(null);
    const { id, ...corpo } = form;
    try {
      if (id) { await api.put(`/usuarios/${id}`, corpo); toast('ok', 'Usuário atualizado.'); }
      else { const r = await api.post('/usuarios', corpo); setSegredo({ titulo: `Senha provisória de ${corpo.email}`, valor: r.senha_provisoria }); }
      setForm(null); recarregar();
    } catch (e) { setErroForm(e); }
  };
  const recuperar = async (u: any) => {
    if (!(await confirmar({ titulo: 'Gerar link de redefinição?', texto: <p>Um link de uso único, válido por 24 horas, será gerado para <strong>{u.nome}</strong>. Entregue-o por canal seguro. Links anteriores são invalidados.</p>, confirmar: 'Gerar link' }))) return;
    try { const r = await api.post(`/usuarios/${u.id}/recuperacao`); setSegredo({ titulo: `Link de redefinição de ${u.email} (válido por 24 h)`, valor: r.link }); } catch (e: any) { toast('erro', e.message); }
  };
  const encerrar = async (u: any) => {
    try { await api.post(`/usuarios/${u.id}/encerrar-sessoes`); toast('ok', 'Sessões encerradas.'); recarregar(); } catch (e: any) { toast('erro', e.message); }
  };
  const erros = errosPorCampo(erroForm);

  return (
    <>
      {segredo && (
        <div className="aviso atencao" role="alert">
          <strong>{segredo.titulo}</strong>
          <p style={{ wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', margin: '8px 0' }}>{segredo.valor}</p>
          <p className="pequeno">Exibido somente agora. Transmita por canal seguro.</p>
          <div className="acoes"><button className="btn sec peq" onClick={() => navigator.clipboard?.writeText(segredo.valor).then(() => toast('ok', 'Copiado.'))}>Copiar</button>
            <button className="btn sec peq" onClick={() => setSegredo(null)}>Fechar</button></div>
        </div>
      )}
      {!form && <button className="btn" style={{ marginBottom: 16 }} onClick={() => setForm({ nome: '', email: '', perfil: 'profissional', funcao: '', ativo: true, acesso_todos_assistidos: false })}>+ Novo usuário</button>}
      {form && (
        <div className="cartao">
          <h2>{form.id ? 'Editar usuário' : 'Novo usuário'}</h2>
          <ErroCaixa erro={erroForm} />
          <div className="linha-campos">
            <Campo rotulo="Nome" obrigatorio erro={erros.nome}>{(p) => <input {...p} type="text" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />}</Campo>
            <Campo rotulo="E-mail" obrigatorio erro={erros.email}>{(p) => <input {...p} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Campo>
          </div>
          <div className="linha-campos">
            <Campo rotulo="Perfil de acesso">{(p) => <select {...p} value={form.perfil} onChange={(e) => setForm({ ...form, perfil: e.target.value })}>
              {Object.entries(PERFIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Campo>
            <Campo rotulo="Função na equipe" ajuda="Ex.: psicóloga, educador físico, musicoterapeuta">{(p) => <input {...p} type="text" value={form.funcao} onChange={(e) => setForm({ ...form, funcao: e.target.value })} />}</Campo>
          </div>
          <div className="opcoes">
            <label className="chip"><input type="checkbox" checked={form.acesso_todos_assistidos} onChange={(e) => setForm({ ...form, acesso_todos_assistidos: e.target.checked })} />Acesso a todos os assistidos</label>
            <label className="chip"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />Ativo</label>
          </div>
          <p className="mudo pequeno" style={{ marginTop: 8 }}>Por padrão, o acesso é restrito aos assistidos atribuídos (acesso mínimo necessário).</p>
          <div className="acoes"><button className="btn" onClick={salvar}>Salvar</button><button className="btn sec" onClick={() => setForm(null)}>Cancelar</button></div>
        </div>
      )}
      {atribuir && <Atribuicoes usuario={atribuir} fechar={() => { setAtribuir(null); recarregar(); }} />}
      <ErroCaixa erro={erro} tentar={recarregar} />
      {carregando && !dados ? <Carregando /> : (
        <div className="cartao"><div className="tabela-wrap"><table>
          <thead><tr><th>Nome</th><th>Perfil</th><th>Acesso</th><th>Último acesso</th><th>Ações</th></tr></thead>
          <tbody>{dados?.map((u) => (
            <tr key={u.id}>
              <td><strong>{u.nome}</strong>{!u.ativo && <> <span className="tag">Inativo</span></>}{u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date() && <> <span className="tag vermelho">Bloqueado</span></>}
                <br /><span className="mudo pequeno">{u.email}{u.funcao ? ` · ${u.funcao}` : ''}</span></td>
              <td>{PERFIS[u.perfil]}</td>
              <td>{u.perfil === 'admin' || u.acesso_todos_assistidos ? 'Todos os assistidos' : `${u.assistidos_atribuidos} atribuído(s)`}</td>
              <td>{dataHora(u.ultimo_login)}<br /><span className="mudo pequeno">{u.sessoes_ativas} sessão(ões) ativa(s)</span></td>
              <td><div className="acoes">
                <button className="btn sec peq" onClick={() => setForm({ id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, funcao: u.funcao ?? '', ativo: u.ativo, acesso_todos_assistidos: u.acesso_todos_assistidos })}>Editar</button>
                {u.perfil !== 'admin' && !u.acesso_todos_assistidos && <button className="btn sec peq" onClick={() => setAtribuir(u)}>Assistidos</button>}
                <button className="btn sec peq" onClick={() => recuperar(u)}>Redefinir senha</button>
                {u.sessoes_ativas > 0 && <button className="btn sec peq" onClick={() => encerrar(u)}>Encerrar sessões</button>}
              </div></td>
            </tr>))}</tbody>
        </table></div></div>
      )}
    </>
  );
}

function Atribuicoes({ usuario, fechar }: { usuario: any; fechar: () => void }) {
  const toast = useToast();
  const { dados: todos } = useCarregar<any[]>('/assistidos?status=ativo');
  const { dados: atuais } = useCarregar<string[]>(`/usuarios/${usuario.id}/assistidos`);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState('');
  useEffect(() => { if (atuais) setSel(new Set(atuais)); }, [atuais]);
  const salvar = async () => {
    try { await api.put(`/usuarios/${usuario.id}/assistidos`, { assistidos: [...sel] }); toast('ok', 'Atribuições salvas.'); fechar(); } catch (e: any) { toast('erro', e.message); }
  };
  const lista = (todos ?? []).filter((a) => a.nome_completo.toLowerCase().includes(filtro.toLowerCase()) || a.codigo.includes(filtro.toUpperCase()));
  return (
    <div className="cartao">
      <h2>Assistidos atribuídos a {usuario.nome} <span className="contador">{sel.size}</span></h2>
      <Campo rotulo="Filtrar">{(p) => <input {...p} type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} />}</Campo>
      {!todos || !atuais ? <Carregando /> : (
        <div className="opcoes" style={{ maxHeight: 320, overflowY: 'auto' }}>
          {lista.map((a) => <label key={a.id} className="chip"><input type="checkbox" checked={sel.has(a.id)}
            onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(a.id); else n.delete(a.id); setSel(n); }} />{a.nome_completo}</label>)}
        </div>
      )}
      <div className="acoes" style={{ marginTop: 12 }}><button className="btn" onClick={salvar}>Salvar atribuições</button><button className="btn sec" onClick={fechar}>Cancelar</button></div>
    </div>
  );
}

function Permissoes() {
  const toast = useToast();
  const { dados, erro, carregando, recarregar } = useCarregar<{ descricoes: Record<string, string>; matriz: Record<string, string[]> }>('/permissoes');
  const [m, setM] = useState<Record<string, string[]> | null>(null);
  useEffect(() => { if (dados) setM(dados.matriz); }, [dados]);
  if (carregando || !m || !dados) return <Carregando />;
  if (erro) return <ErroCaixa erro={erro} />;
  const salvar = async (perfil: string) => {
    try { await api.put(`/permissoes/${perfil}`, { permissoes: m[perfil] }); toast('ok', `Permissões de ${PERFIS[perfil]} salvas.`); recarregar(); } catch (e: any) { toast('erro', e.message); }
  };
  return (
    <div className="cartao">
      <p className="mudo pequeno">As permissões são verificadas no servidor e as regras de acesso aos dados também no banco. Adapte os perfis às funções reais da equipe, sem conceder acesso amplo por padrão.</p>
      <div className="tabela-wrap"><table>
        <thead><tr><th>Permissão</th>{Object.keys(PERFIS).map((p) => <th key={p}>{PERFIS[p]}</th>)}</tr></thead>
        <tbody>{Object.entries(dados.descricoes).map(([k, d]) => (
          <tr key={k}><td>{d}<br /><span className="mudo pequeno">{k}</span></td>
            {Object.keys(PERFIS).map((p) => <td key={p}><input type="checkbox" aria-label={`${d} — ${PERFIS[p]}`} style={{ width: 22, height: 22 }} checked={m[p].includes(k)}
              onChange={(e) => setM({ ...m, [p]: e.target.checked ? [...m[p], k] : m[p].filter((x) => x !== k) })} /></td>)}</tr>))}</tbody>
      </table></div>
      <div className="acoes" style={{ marginTop: 12 }}>{Object.keys(PERFIS).map((p) => <button key={p} className="btn sec" onClick={() => salvar(p)}>Salvar {PERFIS[p]}</button>)}</div>
    </div>
  );
}

function Instituicao() {
  const toast = useToast();
  const { dados, erro, carregando, recarregar } = useCarregar<any>('/config');
  const [inst, setInst] = useState<any>(null);
  const [ret, setRet] = useState<any>(null);
  const [iaHab, setIaHab] = useState(true);
  const [erroS, setErroS] = useState<unknown>(null);
  const { dados: iaStatus } = useCarregar<{ disponivel: boolean; provedor?: string; modelo?: string }>('/ia/status');
  useEffect(() => { if (dados) { setInst(dados.instituicao); setRet(dados.retencao); setIaHab(dados.ia?.habilitada !== false); } }, [dados]);
  if (carregando || !inst) return <Carregando />;
  if (erro) return <ErroCaixa erro={erro} />;
  const salvar = async (chave: string, valor: unknown) => {
    setErroS(null);
    try { await api.put(`/config/${chave}`, valor); toast('ok', 'Configuração salva.'); recarregar(); } catch (e) { setErroS(e); }
  };
  return (
    <>
      <ErroCaixa erro={erroS} />
      <div className="cartao">
        <h2>Identificação institucional (usada nos relatórios)</h2>
        <div className="linha-campos">
          <Campo rotulo="Nome da instituição">{(p) => <input {...p} type="text" value={inst.nome} onChange={(e) => setInst({ ...inst, nome: e.target.value })} />}</Campo>
          <Campo rotulo="CNPJ">{(p) => <input {...p} type="text" value={inst.cnpj} onChange={(e) => setInst({ ...inst, cnpj: e.target.value })} />}</Campo>
        </div>
        <div className="linha-campos">
          <Campo rotulo="Endereço">{(p) => <input {...p} type="text" value={inst.endereco} onChange={(e) => setInst({ ...inst, endereco: e.target.value })} />}</Campo>
          <Campo rotulo="Responsável técnico">{(p) => <input {...p} type="text" value={inst.responsavel_tecnico} onChange={(e) => setInst({ ...inst, responsavel_tecnico: e.target.value })} />}</Campo>
        </div>
        <button className="btn" onClick={() => salvar('instituicao', inst)}>Salvar</button>
      </div>
      <div className="cartao">
        <h2>Inteligência artificial</h2>
        <p className="pequeno">Situação no servidor: {iaStatus?.disponivel ? <span className="tag verde">Configurada — {iaStatus.provedor} · {iaStatus.modelo}</span> : <span className="tag ambar">Não configurada (defina GEMINI_API_KEY ou ANTHROPIC_API_KEY no servidor)</span>}</p>
        <p className="mudo pequeno">Os relatórios automáticos funcionam sem IA. A IA é opcional e serve apenas para redigir minutas em texto corrido.</p>
        <p className="mudo pequeno">Os dados são enviados pseudonimizados (sem nome nem data de nascimento) apenas pelo servidor. Antes de habilitar em produção, avalie o contrato com o provedor, a política de retenção e a base legal (veja docs/LGPD.md).</p>
        <label className="chip"><input type="checkbox" checked={iaHab} onChange={(e) => setIaHab(e.target.checked)} />Permitir o uso de IA na instituição</label>
        <div style={{ marginTop: 10 }}><button className="btn" onClick={() => salvar('ia', { habilitada: iaHab, enviar_nome: false })}>Salvar</button></div>
      </div>
      <div className="cartao">
        <h2>Política de retenção e descarte</h2>
        <Campo rotulo="Descrição da política">{(p) => <textarea {...p} value={ret.descricao} onChange={(e) => setRet({ ...ret, descricao: e.target.value })} />}</Campo>
        <Campo rotulo="Prazo de guarda após arquivamento (anos)" ajuda="Defina com assessoria jurídica e conselhos profissionais. Deixe vazio enquanto não definido.">
          {(p) => <input {...p} type="number" min={1} max={100} value={ret.prazo_anos ?? ''} onChange={(e) => setRet({ ...ret, prazo_anos: e.target.value ? Number(e.target.value) : null })} />}</Campo>
        <button className="btn" onClick={() => salvar('retencao', ret)}>Salvar</button>
      </div>
    </>
  );
}

function Auditoria() {
  const [f, setF] = useState({ acao: '', inicio: '', fim: '', pagina: 1 });
  const { dados, erro, carregando } = useCarregar<any[]>(`/auditoria${qs(f)}`);
  return (
    <>
      <div className="cartao"><div className="linha-campos">
        <Campo rotulo="Ação contém">{(p) => <input {...p} type="search" placeholder="ex.: exportacao, login, acesso" value={f.acao} onChange={(e) => setF({ ...f, acao: e.target.value, pagina: 1 })} />}</Campo>
        <Campo rotulo="De">{(p) => <input {...p} type="date" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value, pagina: 1 })} />}</Campo>
        <Campo rotulo="Até">{(p) => <input {...p} type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value, pagina: 1 })} />}</Campo>
      </div></div>
      <ErroCaixa erro={erro} />
      {carregando && !dados ? <Carregando /> : (
        <div className="cartao">
          {!dados?.length ? <Vazio>Nenhum evento.</Vazio> : <div className="tabela-wrap"><table>
            <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Detalhes</th></tr></thead>
            <tbody>{dados.map((a) => (
              <tr key={a.id}><td>{dataHora(a.ocorrido_em)}</td><td>{a.usuario_nome ?? '—'}<br /><span className="mudo pequeno">{a.ip}</span></td><td>{a.acao}</td>
                <td>{a.entidade}{a.entidade_id ? <><br /><span className="mudo pequeno">{String(a.entidade_id).slice(0, 8)}</span></> : ''}</td>
                <td><code className="pequeno" style={{ wordBreak: 'break-word' }}>{JSON.stringify(a.detalhes)}</code></td></tr>))}</tbody>
          </table></div>}
          <div className="acoes" style={{ marginTop: 10 }}>
            <button className="btn sec peq" disabled={f.pagina === 1} onClick={() => setF({ ...f, pagina: f.pagina - 1 })}>Anterior</button>
            <span className="mudo">Página {f.pagina}</span>
            <button className="btn sec peq" disabled={(dados?.length ?? 0) < 100} onClick={() => setF({ ...f, pagina: f.pagina + 1 })}>Próxima</button>
          </div>
        </div>
      )}
    </>
  );
}

function Lgpd() {
  const toast = useToast();
  const confirmar = useConfirmar();
  const { pode } = useAuth();
  const { dados: ret, recarregar } = useCarregar<any>('/lgpd/retencao');
  const [a, setA] = useState<AssistidoResumo | null>(null);
  const [conf, setConf] = useState({ codigo: '', motivo: '' });
  const [erro, setErro] = useState<unknown>(null);
  const anonimizar = async () => {
    setErro(null);
    try { await api.post(`/lgpd/assistidos/${a!.id}/anonimizar`, { confirmacao_codigo: conf.codigo, motivo: conf.motivo }); toast('ok', 'Cadastro anonimizado.'); setA(null); setConf({ codigo: '', motivo: '' }); }
    catch (e) { setErro(e); }
  };
  const removerExemplos = async () => {
    if (!(await confirmar({ titulo: 'Remover dados de exemplo?', texto: 'Somente registros marcados como exemplo (demonstração) serão excluídos definitivamente. Dados reais não são afetados.', confirmar: 'Remover exemplos', perigo: true }))) return;
    try { const r = await api.post('/lgpd/remover-exemplos'); toast('ok', `Removidos: ${r.assistidos} assistido(s), ${r.evolucoes} evolução(ões).`); recarregar(); } catch (e: any) { toast('erro', e.message); }
  };
  return (
    <>
      <div className="cartao">
        <h2>Direitos dos titulares</h2>
        <p className="mudo pequeno">Dados de saúde são dados pessoais sensíveis. Atenda solicitações de acesso, correção, portabilidade e eliminação/anonimização conforme a base legal definida pela instituição e as obrigações de guarda documental.</p>
        <BuscaAssistido valor={a} onSelecionar={setA} rotulo="Titular (assistido)" />
        {a && (
          <>
            <div className="acoes" style={{ marginBottom: 14 }}>
              <button className="btn sec" onClick={() => baixar(`/lgpd/assistidos/${a.id}/exportar`, `dados-${a.codigo}.json`).catch((e) => toast('erro', e.message))}>Exportar todos os dados (acesso/portabilidade)</button>
              <a className="btn sec" href={`/assistidos/${a.id}/editar`}>Corrigir cadastro</a>
            </div>
            <div className="aviso atencao">
              <strong>Anonimização do cadastro</strong>
              <p className="pequeno">Substitui nome por identificador, reduz a data de nascimento ao ano, apaga observações restritas e arquiva o cadastro. Os registros técnicos são mantidos (guarda documental); textos livres podem conter identificadores e devem ser revisados manualmente. Operação irreversível.</p>
              <ErroCaixa erro={erro} />
              <div className="linha-campos">
                <Campo rotulo={`Digite o código ${a.codigo} para confirmar`}>{(p) => <input {...p} type="text" value={conf.codigo} onChange={(e) => setConf({ ...conf, codigo: e.target.value })} />}</Campo>
                <Campo rotulo="Motivo / fundamento">{(p) => <input {...p} type="text" value={conf.motivo} onChange={(e) => setConf({ ...conf, motivo: e.target.value })} />}</Campo>
              </div>
              <button className="btn perigo" disabled={conf.codigo !== a.codigo || conf.motivo.length < 10} onClick={anonimizar}>Anonimizar cadastro</button>
            </div>
          </>
        )}
      </div>
      <div className="cartao">
        <h2>Retenção</h2>
        {!ret ? <Carregando /> : ret.configuracao.prazo_anos ? (
          !ret.vencidos.length ? <p>Nenhum cadastro arquivado com prazo de guarda vencido ({ret.configuracao.prazo_anos} anos).</p> : (
            <ul className="lista-simples">{ret.vencidos.map((v: any) => <li key={v.id}><span>{v.codigo} · arquivado em {data(v.arquivado_em)} · último registro {data(v.ultimo_registro)}</span></li>)}</ul>)
        ) : <p className="mudo">Prazo de guarda não definido. Configure em “Instituição, IA e retenção”.</p>}
      </div>
      {pode('usuarios.gerenciar') && (
        <div className="cartao">
          <h2>Dados de demonstração</h2>
          <p className="pequeno">{ret?.exemplos ?? 0} assistido(s) marcado(s) como exemplo.</p>
          <button className="btn perigo" disabled={!ret?.exemplos} onClick={removerExemplos}>Remover dados de exemplo</button>
        </div>
      )}
    </>
  );
}

function CidImport() {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [res, setRes] = useState<any>(null);
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    setEnviando(true);
    try { setRes(await api.post('/cid/importar', { csv })); toast('ok', 'Importação concluída.'); } catch (e: any) { toast('erro', e.message); } finally { setEnviando(false); }
  };
  return (
    <div className="cartao">
      <h2>Importar tabela CID-10</h2>
      <p className="mudo pequeno">O sistema inclui um catálogo inicial parcial. Importe a tabela oficial (DATASUS) no formato <code>codigo;descricao</code> por linha (ex.: <code>F840;Autismo infantil</code> ou <code>F84.0;Autismo infantil</code>). Códigos existentes são mantidos.</p>
      <Campo rotulo="Arquivo CSV">{(p) => <input {...p} type="file" accept=".csv,.txt" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />}</Campo>
      <Campo rotulo="Ou cole o conteúdo">{(p) => <textarea {...p} value={csv} onChange={(e) => setCsv(e.target.value)} />}</Campo>
      <button className="btn" disabled={!csv || enviando} onClick={enviar}>{enviando ? 'Importando…' : 'Importar'}</button>
      {res && <div className="aviso ok" style={{ marginTop: 12 }}>Inseridos: {res.inseridos} · já existentes: {res.ignorados} · linhas inválidas: {res.erros.length}</div>}
    </div>
  );
}
