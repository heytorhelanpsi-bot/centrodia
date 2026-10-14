import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { DIRECAO, TIPO_INDICADOR, dataHora, diasAtras, hojeISO } from '../formato';
import { Abas, BuscaAssistido, Campo, Carregando, ErroCaixa, useCarregar, useConfirmar, useToast, type AssistidoResumo } from '../componentes/ui';
import { GraficosIndicadores } from '../componentes/graficos';
import type { Indicador, Nivel } from '../componentes/registro';

export function IndicadoresPagina() {
  const { pode } = useAuth();
  const [aba, setAba] = useState<'acomp' | 'escalas' | 'config'>('acomp');
  return (
    <>
      <div className="cab-pagina"><div><h1>Indicadores comportamentais</h1><p className="sub">Acompanhamento ao longo do tempo e definição das escalas.</p></div></div>
      <Abas rotulo="Seções de indicadores" atual={aba} onChange={setAba} abas={[
        { id: 'acomp', rotulo: 'Acompanhamento' }, { id: 'escalas', rotulo: 'Guia das escalas' },
        ...(pode('config.indicadores') ? [{ id: 'config' as const, rotulo: 'Configuração' }] : []),
      ]} />
      {aba === 'acomp' && <Acompanhamento />}
      {aba === 'escalas' && <GuiaEscalas />}
      {aba === 'config' && <ConfigIndicadores />}
    </>
  );
}

function Acompanhamento() {
  const [a, setA] = useState<AssistidoResumo | null>(null);
  const [p, setP] = useState({ inicio: diasAtras(90), fim: hojeISO() });
  return (
    <>
      <div className="cartao">
        <BuscaAssistido valor={a} onSelecionar={setA} />
        <div className="linha-campos">
          <Campo rotulo="De">{(x) => <input {...x} type="date" value={p.inicio} onChange={(e) => setP({ ...p, inicio: e.target.value })} />}</Campo>
          <Campo rotulo="Até">{(x) => <input {...x} type="date" value={p.fim} max={hojeISO()} onChange={(e) => setP({ ...p, fim: e.target.value })} />}</Campo>
        </div>
      </div>
      {a ? <GraficosIndicadores assistidoId={a.id} inicio={p.inicio} fim={p.fim} /> : <p className="mudo">Selecione um assistido para visualizar os indicadores.</p>}
    </>
  );
}

function GuiaEscalas() {
  const { dados, erro, carregando } = useCarregar<Indicador[]>('/indicadores');
  if (carregando) return <Carregando />;
  if (erro) return <ErroCaixa erro={erro} />;
  return (
    <>
      <div className="aviso info">Use estas descrições para padronizar a pontuação entre profissionais. “Não avaliado” indica ausência de informação e nunca equivale a 0.</div>
      <div className="grade grade-2">
        {dados?.map((i) => (
          <div key={i.id} className="cartao">
            <h3>{i.nome} <span className="tag">{TIPO_INDICADOR[i.tipo]}</span></h3>
            {i.descricao && <p className="mudo pequeno">{i.descricao}</p>}
            <p className="pequeno"><strong>{DIRECAO[i.direcao]}</strong> · escala v{i.versao}</p>
            <ul className="lista-simples">{i.niveis.map((n) => <li key={n.valor}><span><strong>{n.valor}</strong> — {n.descricao}</span></li>)}</ul>
          </div>
        ))}
      </div>
    </>
  );
}

const MODELOS: Record<string, string[]> = {
  positivo: ['Não observado ou ausência da habilidade na situação registrada', 'Muito reduzido', 'Baixo', 'Moderado', 'Bom', 'Muito bom'],
  monitoramento: ['Não observado no período avaliado', 'Muito baixo', 'Baixo', 'Moderado', 'Elevado', 'Muito elevado'],
};

type FormInd = { id?: string; nome: string; descricao: string; tipo: string; observacao_obrigatoria: boolean; ativo: boolean; ordem: number;
  escala: { minimo: number; maximo: number; direcao: string; niveis: Nivel[] } };

function niveisPadrao(min: number, max: number, tipo: string): Nivel[] {
  return Array.from({ length: max - min + 1 }, (_, i) => ({ valor: min + i, descricao: (max - min === 5 && MODELOS[tipo]?.[i]) || '' }));
}

function ConfigIndicadores() {
  const toast = useToast();
  const confirmar = useConfirmar();
  const { dados, erro, carregando, recarregar } = useCarregar<Indicador[]>('/indicadores?todos=1');
  const [form, setForm] = useState<FormInd | null>(null);
  const [soEscala, setSoEscala] = useState(false);
  const [versoesDe, setVersoesDe] = useState<string | null>(null);
  const [erroForm, setErroForm] = useState<unknown>(null);
  const [salvando, setSalvando] = useState(false);
  const { dados: versoes } = useCarregar<any[]>(versoesDe ? `/indicadores/${versoesDe}/versoes` : null);

  const salvar = async () => {
    if (!form) return;
    setSalvando(true); setErroForm(null);
    const meta = { nome: form.nome, descricao: form.descricao, tipo: form.tipo, observacao_obrigatoria: form.observacao_obrigatoria, ativo: form.ativo, ordem: form.ordem };
    try {
      if (!form.id) await api.post('/indicadores', { ...meta, escala: form.escala });
      else if (soEscala) {
        if (!(await confirmar({ titulo: 'Criar nova versão da escala?', texto: 'Avaliações já registradas continuam vinculadas à versão anterior; a nova versão vale para os próximos registros. Versões diferentes não são comparadas nos gráficos.', confirmar: 'Criar nova versão' }))) { setSalvando(false); return; }
        await api.post(`/indicadores/${form.id}/versoes`, form.escala);
      } else await api.put(`/indicadores/${form.id}`, meta);
      toast('ok', 'Indicador salvo.'); setForm(null); recarregar();
    } catch (e) { setErroForm(e); } finally { setSalvando(false); }
  };

  const setEscala = (e: Partial<FormInd['escala']>) => {
    if (!form) return;
    const n = { ...form.escala, ...e };
    if (e.minimo !== undefined || e.maximo !== undefined) {
      const ant = new Map(form.escala.niveis.map((x) => [x.valor, x.descricao]));
      n.niveis = Array.from({ length: Math.max(0, n.maximo - n.minimo + 1) }, (_, i) => ({ valor: n.minimo + i, descricao: ant.get(n.minimo + i) ?? '' }));
    }
    setForm({ ...form, escala: n });
  };

  return (
    <>
      {!form && <button className="btn" style={{ marginBottom: 16 }} onClick={() => { setSoEscala(false); setForm({ nome: '', descricao: '', tipo: 'positivo', observacao_obrigatoria: false, ativo: true, ordem: 100,
        escala: { minimo: 0, maximo: 5, direcao: 'maior_melhor', niveis: niveisPadrao(0, 5, 'positivo') } }); }}>+ Novo indicador personalizado</button>}
      {form && (
        <div className="cartao">
          <h2>{!form.id ? 'Novo indicador' : soEscala ? `Nova versão da escala — ${form.nome}` : `Editar ${form.nome}`}</h2>
          <ErroCaixa erro={erroForm} />
          {!soEscala && <>
            <div className="linha-campos">
              <Campo rotulo="Nome" obrigatorio>{(p) => <input {...p} type="text" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />}</Campo>
              <Campo rotulo="Tipo de indicador">{(p) => <select {...p} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                {Object.entries(TIPO_INDICADOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Campo>
              <Campo rotulo="Ordem de exibição">{(p) => <input {...p} type="number" value={form.ordem} onChange={(e) => setForm({ ...form, ordem: Number(e.target.value) })} />}</Campo>
            </div>
            <Campo rotulo="Descrição">{(p) => <textarea {...p} style={{ minHeight: 60 }} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />}</Campo>
            <div className="opcoes" style={{ marginBottom: 12 }}>
              <label className="chip"><input type="checkbox" checked={form.observacao_obrigatoria} onChange={(e) => setForm({ ...form, observacao_obrigatoria: e.target.checked })} />Observação obrigatória quando avaliado</label>
              <label className="chip"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />Ativo</label>
            </div>
          </>}
          {(!form.id || soEscala) && (
            <fieldset>
              <legend>Escala</legend>
              <div className="linha-campos">
                <Campo rotulo="Mínimo">{(p) => <input {...p} type="number" min={0} max={9} value={form.escala.minimo} onChange={(e) => setEscala({ minimo: Number(e.target.value) })} />}</Campo>
                <Campo rotulo="Máximo">{(p) => <input {...p} type="number" min={1} max={10} value={form.escala.maximo} onChange={(e) => setEscala({ maximo: Number(e.target.value) })} />}</Campo>
                <Campo rotulo="Direção de interpretação">{(p) => <select {...p} value={form.escala.direcao} onChange={(e) => setEscala({ direcao: e.target.value })}>
                  {Object.entries(DIRECAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Campo>
              </div>
              {form.escala.niveis.map((n, i) => (
                <Campo key={n.valor} rotulo={`Descrição do nível ${n.valor}`}>{(p) => <input {...p} type="text" value={n.descricao}
                  onChange={(e) => setEscala({ niveis: form.escala.niveis.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)) })} />}</Campo>
              ))}
            </fieldset>
          )}
          <div className="acoes">
            <button className="btn" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            <button className="btn sec" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      )}
      <ErroCaixa erro={erro} tentar={recarregar} />
      {carregando && !dados ? <Carregando /> : (
        <div className="cartao">
          <ul className="lista-simples">{dados?.map((i) => (
            <li key={i.id}>
              <span><strong>{i.nome}</strong> <span className="tag">{TIPO_INDICADOR[i.tipo]}</span> <span className="tag azul">Escala v{i.versao} ({i.minimo}–{i.maximo})</span>
                {!i.ativo && <> <span className="tag">Inativo</span></>}<br /><span className="mudo pequeno">{DIRECAO[i.direcao]}</span></span>
              <span className="acoes">
                <button className="btn sec peq" onClick={() => { setSoEscala(false); setForm({ id: i.id, nome: i.nome, descricao: i.descricao ?? '', tipo: i.tipo, observacao_obrigatoria: i.observacao_obrigatoria, ativo: i.ativo, ordem: (i as any).ordem ?? 100, escala: { minimo: i.minimo, maximo: i.maximo, direcao: i.direcao, niveis: i.niveis } }); }}>Editar</button>
                <button className="btn sec peq" onClick={() => { setSoEscala(true); setForm({ id: i.id, nome: i.nome, descricao: '', tipo: i.tipo, observacao_obrigatoria: false, ativo: true, ordem: 0, escala: { minimo: i.minimo, maximo: i.maximo, direcao: i.direcao, niveis: i.niveis.map((n) => ({ ...n })) } }); }}>Nova versão da escala</button>
                <button className="btn-link" onClick={() => setVersoesDe(versoesDe === i.id ? null : i.id)}>Histórico de versões</button>
              </span>
              {versoesDe === i.id && versoes && (
                <div style={{ width: '100%' }}>{versoes.map((v) => (
                  <div key={v.id} className="indicador"><strong>v{v.versao}</strong> · {v.minimo}–{v.maximo} · {DIRECAO[v.direcao]} · {dataHora(v.criado_em)}{v.criado_por_nome ? ` · ${v.criado_por_nome}` : ''}
                    <div className="pequeno">{v.niveis.map((n: Nivel) => `${n.valor}: ${n.descricao}`).join(' · ')}</div></div>))}</div>
              )}
            </li>))}</ul>
        </div>
      )}
    </>
  );
}
