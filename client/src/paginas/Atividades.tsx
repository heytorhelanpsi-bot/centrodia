import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Campo, Carregando, ErroCaixa, errosPorCampo, useCarregar, useToast, Vazio } from '../componentes/ui';
import type { Atividade, Indicador } from '../componentes/registro';

type Form = { id?: string; nome: string; categoria: string; descricao: string; ativo: boolean; indicadores_recomendados: string[] };

export function AtividadesConfig() {
  const { pode } = useAuth();
  const toast = useToast();
  const { dados, erro, carregando, recarregar } = useCarregar<Atividade[]>('/atividades?todas=1');
  const { dados: inds } = useCarregar<Indicador[]>('/indicadores');
  const [form, setForm] = useState<Form | null>(null);
  const [erroForm, setErroForm] = useState<unknown>(null);
  const [salvando, setSalvando] = useState(false);
  const podeConfig = pode('config.atividades');
  const podeCriar = pode('atividades.criar');

  const salvar = async () => {
    if (!form) return;
    setSalvando(true); setErroForm(null);
    const { id, ...corpo } = form;
    try {
      if (id) await api.put(`/atividades/${id}`, corpo); else await api.post('/atividades', corpo);
      toast('ok', id ? 'Atividade atualizada.' : 'Atividade adicionada.');
      setForm(null); recarregar();
    } catch (e) { setErroForm(e); } finally { setSalvando(false); }
  };
  const alternarAtivo = async (a: Atividade) => {
    try {
      await api.put(`/atividades/${a.id}`, { nome: a.nome, categoria: a.categoria, descricao: a.descricao, ativo: !a.ativo, indicadores_recomendados: a.indicadores_recomendados });
      toast('ok', a.ativo ? 'Atividade desativada (registros antigos preservados).' : 'Atividade reativada.'); recarregar();
    } catch (e: any) { toast('erro', e.message); }
  };
  const erros = errosPorCampo(erroForm);
  const porCategoria = (dados ?? []).reduce<Record<string, Atividade[]>>((m, a) => { (m[a.categoria] ??= []).push(a); return m; }, {});

  return (
    <>
      <div className="cab-pagina">
        <div><h1>Atividades</h1><p className="sub">Catálogo usado nos registros individuais e em grupo.</p></div>
        {podeCriar && !form && <button className="btn grande" onClick={() => setForm({ nome: '', categoria: 'Geral', descricao: '', ativo: true, indicadores_recomendados: [] })}>+ Nova atividade</button>}
      </div>
      {form && (
        <div className="cartao">
          <h2>{form.id ? 'Editar atividade' : 'Nova atividade'}</h2>
          <ErroCaixa erro={erroForm} />
          <div className="linha-campos">
            <Campo rotulo="Nome" obrigatorio erro={erros.nome}>{(p) => <input {...p} type="text" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />}</Campo>
            <Campo rotulo="Categoria" erro={erros.categoria}>{(p) => <input {...p} type="text" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} />}</Campo>
          </div>
          <Campo rotulo="Descrição">{(p) => <textarea {...p} style={{ minHeight: 70 }} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />}</Campo>
          <fieldset><legend>Indicadores recomendados para avaliação</legend><div className="opcoes">
            {inds?.map((i) => <label key={i.id} className="chip"><input type="checkbox" checked={form.indicadores_recomendados.includes(i.id)}
              onChange={(e) => setForm({ ...form, indicadores_recomendados: e.target.checked ? [...form.indicadores_recomendados, i.id] : form.indicadores_recomendados.filter((x) => x !== i.id) })} />{i.nome}</label>)}
          </div></fieldset>
          <label className="chip"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />Ativa</label>
          <div className="acoes" style={{ marginTop: 12 }}>
            <button className="btn" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            <button className="btn sec" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      )}
      <ErroCaixa erro={erro} tentar={recarregar} />
      {carregando && !dados ? <Carregando /> : !dados?.length ? <Vazio>Nenhuma atividade.</Vazio> : Object.entries(porCategoria).map(([cat, lista]) => (
        <div key={cat} className="cartao">
          <h2>{cat}</h2>
          <ul className="lista-simples">{lista.map((a) => (
            <li key={a.id}>
              <span><strong>{a.nome}</strong> {a.padrao && <span className="tag azul">Padrão</span>} {!a.ativo && <span className="tag">Inativa</span>}
                {a.descricao && <><br /><span className="mudo pequeno">{a.descricao}</span></>}
                {a.indicadores_recomendados.length > 0 && <><br /><span className="mudo pequeno">Recomendados: {a.indicadores_recomendados.map((x) => inds?.find((i) => i.id === x)?.nome).filter(Boolean).join(', ')}</span></>}</span>
              {podeConfig && <span className="acoes">
                <button className="btn sec peq" onClick={() => setForm({ id: a.id, nome: a.nome, categoria: a.categoria, descricao: a.descricao ?? '', ativo: a.ativo, indicadores_recomendados: a.indicadores_recomendados })}>Editar</button>
                <button className="btn sec peq" onClick={() => alternarAtivo(a)}>{a.ativo ? 'Desativar' : 'Reativar'}</button>
              </span>}
            </li>))}</ul>
        </div>
      ))}
    </>
  );
}
