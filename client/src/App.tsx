import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { PERFIS } from './formato';
import { Carregando } from './componentes/ui';
import { Login, RedefinirSenha, TrocarSenha } from './paginas/Acesso';
import { Dashboard } from './paginas/Dashboard';
import { AssistidoDetalhe, AssistidoForm, Assistidos } from './paginas/Assistidos';
import { EvolucaoDetalhe, EvolucaoForm } from './paginas/Evolucao';
import { ColetivaDetalhe, ColetivaForm, Coletivas } from './paginas/Coletivas';
import { HistoricoEvolucoes } from './paginas/Historico';
import { AnaliseDetalhe, NovoRelatorio, RelatorioDetalhe, Relatorios } from './paginas/Relatorios';
import { AtividadesConfig } from './paginas/Atividades';
import { IndicadoresPagina } from './paginas/Indicadores';
import { Configuracoes } from './paginas/Configuracoes';

const MENU = [
  { to: '/', rotulo: 'Dashboard', ico: '◧', fim: true },
  { to: '/assistidos', rotulo: 'Assistidos', ico: '👤' },
  { to: '/evolucoes/nova', rotulo: 'Registrar evolução', ico: '✎', perm: 'evolucoes.registrar' },
  { to: '/grupos', rotulo: 'Atendimentos em grupo', ico: '👥' },
  { to: '/historico', rotulo: 'Histórico de evoluções', ico: '🕘' },
  { to: '/relatorios', rotulo: 'Relatórios', ico: '📄', permAlguma: ['relatorios.elaborar', 'relatorios.ver_aprovados'] },
  { to: '/atividades', rotulo: 'Atividades', ico: '🎵' },
  { to: '/indicadores', rotulo: 'Indicadores comportamentais', ico: '📈' },
  { to: '/configuracoes', rotulo: 'Usuários e configurações', ico: '⚙' },
];

export function App() {
  const { usuario, carregando, expirou } = useAuth();
  const loc = useLocation();
  if (loc.pathname === '/redefinir-senha') return <RedefinirSenha />;
  if (carregando) return <div className="login-pagina"><div className="login-cartao"><Carregando /></div></div>;
  if (!usuario) return <Login expirou={expirou} />;
  if (usuario.deveTrocarSenha) return <TrocarSenha obrigatoria />;
  return <Layout />;
}

function Layout() {
  const { usuario, pode, sair } = useAuth();
  const [aberto, setAberto] = useState(false);
  const loc = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { setAberto(false); mainRef.current?.focus(); window.scrollTo(0, 0); }, [loc.pathname]);
  const itens = MENU.filter((m) => (!m.perm || pode(m.perm)) && (!m.permAlguma || m.permAlguma.some(pode)));
  return (
    <div className="app">
      <a href="#conteudo" className="pular-link">Pular para o conteúdo</a>
      <div className="topo-movel">
        <button aria-label="Abrir menu" aria-expanded={aberto} onClick={() => setAberto(true)}>☰</button>
        <strong>Reabilita+</strong>
        <span style={{ width: 44 }} />
      </div>
      <nav className={`lateral ${aberto ? 'aberta' : ''}`} aria-label="Menu principal" onKeyDown={(e) => e.key === 'Escape' && setAberto(false)}>
        <div className="marca"><span className="marca-icone" aria-hidden>+</span><span>Reabilita+<small>Gestão e evolução dos assistidos</small></span></div>
        <ul className="menu">
          {itens.map((m) => (
            <li key={m.to}><NavLink to={m.to} end={m.fim} className={({ isActive }) => (isActive ? 'ativo' : '')}>
              <span className="ico" aria-hidden>{m.ico}</span>{m.rotulo}</NavLink></li>
          ))}
        </ul>
        <div className="lateral-rodape">
          <div><strong>{usuario!.nome}</strong></div>
          <div style={{ color: '#a9c3dd' }}>{PERFIS[usuario!.perfil]}</div>
          <NavLink to="/minha-conta" style={{ color: '#dce8f5' }}>Minha conta</NavLink>
          <button className="btn sec peq" onClick={sair}>Sair</button>
        </div>
      </nav>
      <main id="conteudo" className="principal" tabIndex={-1} ref={mainRef} style={{ outline: 'none' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/assistidos" element={<Assistidos />} />
          <Route path="/assistidos/novo" element={<AssistidoForm />} />
          <Route path="/assistidos/:id" element={<AssistidoDetalhe />} />
          <Route path="/assistidos/:id/editar" element={<AssistidoForm />} />
          <Route path="/evolucoes/nova" element={<EvolucaoForm />} />
          <Route path="/evolucoes/:id" element={<EvolucaoDetalhe />} />
          <Route path="/evolucoes/:id/editar" element={<EvolucaoForm />} />
          <Route path="/evolucoes/:id/corrigir" element={<EvolucaoForm correcao />} />
          <Route path="/grupos" element={<Coletivas />} />
          <Route path="/grupos/novo" element={<ColetivaForm />} />
          <Route path="/grupos/:id" element={<ColetivaDetalhe />} />
          <Route path="/grupos/:id/editar" element={<ColetivaForm />} />
          <Route path="/historico" element={<HistoricoEvolucoes />} />
          <Route path="/relatorios" element={<Relatorios />} />
          <Route path="/relatorios/novo" element={<NovoRelatorio />} />
          <Route path="/relatorios/:id" element={<RelatorioDetalhe />} />
          <Route path="/analises/:id" element={<AnaliseDetalhe />} />
          <Route path="/atividades" element={<AtividadesConfig />} />
          <Route path="/indicadores" element={<IndicadoresPagina />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="/minha-conta" element={<TrocarSenha />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
