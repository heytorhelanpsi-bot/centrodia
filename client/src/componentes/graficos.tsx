import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { qs } from '../api';
import { DIRECAO, data } from '../formato';
import { Carregando, ErroCaixa, useCarregar, Vazio } from './ui';

interface Serie { versao: number; escala: string; direcao: string; observacoes: number; serie: { data: string; valor: number }[];
  minimo_observado: number | null; maximo_observado: number | null; mediana: number | null; dados_suficientes_para_tendencia: boolean }
interface Resp {
  minimo_para_tendencia: number; total_registros: number; datas_registros: { id: string; data: string; tipo: string }[];
  por_contexto: { individual: number; participacao_coletiva: number };
  frequencia_atividades: Record<string, number>;
  indicadores: { indicador: string; registros_sem_avaliacao: number; versoes_de_escala: Serie[] }[];
  escalas: { indicador_id: string; nome: string; versao: number; niveis: { valor: number; descricao: string }[] }[];
}

/**
 * Gráficos descritivos por indicador. Cada versão de escala é exibida separadamente
 * (escalas diferentes não são comparadas) e o número de observações é sempre mostrado.
 * Não há médias: a mediana só aparece quando há dados suficientes.
 */
export function GraficosIndicadores({ assistidoId, inicio, fim }: { assistidoId: string; inicio: string; fim: string }) {
  const { dados, erro, carregando } = useCarregar<Resp>(`/assistidos/${assistidoId}/indicadores${qs({ inicio, fim })}`);
  if (carregando && !dados) return <Carregando />;
  if (erro) return <ErroCaixa erro={erro} />;
  if (!dados) return null;
  if (!dados.total_registros) return <div className="cartao"><Vazio>Nenhuma evolução finalizada no período.</Vazio></div>;
  return (
    <>
      <div className="grade grade-kpi" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="valor">{dados.total_registros}</div><div className="rotulo">Registros no período</div></div>
        <div className="kpi"><div className="valor">{dados.por_contexto.individual}</div><div className="rotulo">Individuais</div></div>
        <div className="kpi"><div className="valor">{dados.por_contexto.participacao_coletiva}</div><div className="rotulo">Em grupo</div></div>
      </div>
      <div className="cartao">
        <h3>Frequência das atividades</h3>
        <ul className="lista-simples">
          {Object.entries(dados.frequencia_atividades).map(([n, q]) => <li key={n}><span>{n}</span><strong>{q}</strong></li>)}
        </ul>
      </div>
      <p className="aviso info pequeno">Gráficos descritivos: mostram os valores registrados ao longo do tempo e não indicam causa.
        Tendências só são sinalizadas com pelo menos {dados.minimo_para_tendencia} observações na mesma versão de escala.
        Registros sem avaliação aparecem como lacunas e nunca como zero.</p>
      <div className="grade grade-2">
        {dados.indicadores.map((ind) => ind.versoes_de_escala.length === 0 ? (
          <div className="cartao" key={ind.indicador}><h3>{ind.indicador}</h3><p className="mudo">Nenhuma pontuação no período ({ind.registros_sem_avaliacao} registro(s) sem avaliação).</p></div>
        ) : ind.versoes_de_escala.map((v) => (
          <GraficoSerie key={`${ind.indicador}-${v.versao}`} nome={ind.indicador} v={v} semAvaliacao={ind.registros_sem_avaliacao}
            datas={dados.datas_registros.map((d) => d.data)} multiplasVersoes={ind.versoes_de_escala.length > 1} />
        )))}
      </div>
    </>
  );
}

function GraficoSerie({ nome, v, semAvaliacao, datas, multiplasVersoes }: { nome: string; v: Serie; semAvaliacao: number; datas: string[]; multiplasVersoes: boolean }) {
  const [min, max] = v.escala.split('–').map(Number);
  // Inclui todas as datas de registro: datas sem avaliação ficam como lacuna (null).
  const porData = new Map<string, number[]>();
  for (const p of v.serie) porData.set(p.data, [...(porData.get(p.data) ?? []), p.valor]);
  const pontos = [...new Set(datas)].sort().map((d) => ({ data: d, valor: porData.get(d)?.at(-1) ?? null }));
  return (
    <figure className="cartao" style={{ margin: 0 }}>
      <figcaption>
        <h3 style={{ marginBottom: 2 }}>{nome}{multiplasVersoes && <span className="tag" style={{ marginLeft: 6 }}>Escala v{v.versao}</span>}</h3>
        <p className="mudo pequeno">{v.observacoes} observação(ões) · {semAvaliacao} sem avaliação · escala {v.escala} · {DIRECAO[v.direcao]}</p>
      </figcaption>
      <div style={{ width: '100%', height: 200 }} role="img"
        aria-label={`${nome}: ${v.serie.map((p) => `${data(p.data)} = ${p.valor}`).join('; ')}`}>
        <ResponsiveContainer>
          <LineChart data={pontos} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#e3e7ed" strokeDasharray="3 3" />
            <XAxis dataKey="data" tickFormatter={(d) => data(d).slice(0, 5)} fontSize={12} />
            <YAxis domain={[min, max]} ticks={Array.from({ length: max - min + 1 }, (_, i) => min + i)} allowDecimals={false} fontSize={12} />
            <Tooltip formatter={(val) => (val === null ? 'Não avaliado' : val)} labelFormatter={(d) => data(String(d))} />
            <Line type="linear" dataKey="valor" stroke="#1f5f99" strokeWidth={2} dot={{ r: 4 }} connectNulls={false} isAnimationActive={false} name="Pontuação" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="pequeno" style={{ marginTop: 6 }}>
        Valores observados: {v.minimo_observado ?? '—'} a {v.maximo_observado ?? '—'}
        {v.dados_suficientes_para_tendencia ? <> · mediana {v.mediana}</> : <> · <span className="tag ambar">Dados insuficientes para tendência</span></>}
      </p>
    </figure>
  );
}
