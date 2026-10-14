import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Campo, ErroCaixa, useToast } from '../componentes/ui';

export function Login({ expirou }: { expirou?: boolean }) {
  const [inicial, setInicial] = useState<boolean | null>(null);
  useEffect(() => {
    api.get<{ necessaria: boolean }>('/auth/configuracao-inicial').then((r) => setInicial(r.necessaria)).catch(() => setInicial(false));
  }, []);
  if (inicial) return <ConfiguracaoInicial />;
  return <FormLogin expirou={expirou} />;
}

/** Primeiro acesso após o deploy: cria a conta de administração (somente enquanto não houver usuários). */
function ConfiguracaoInicial() {
  const { recarregar } = useAuth();
  const [f, setF] = useState({ nome: '', email: '', senha: '', conf: '' });
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);
  const criar = async (e: FormEvent) => {
    e.preventDefault();
    if (f.senha !== f.conf) { setErro(new Error('A confirmação não confere com a senha.')); return; }
    setEnviando(true); setErro(null);
    try { await api.post('/auth/configuracao-inicial', { nome: f.nome, email: f.email, senha: f.senha }); await recarregar(); }
    catch (er) { setErro(er); } finally { setEnviando(false); }
  };
  return (
    <div className="login-pagina">
      <main className="login-cartao">
        <div className="marca" style={{ color: 'var(--azul-900)', padding: '0 0 16px' }}>
          <img className="marca-icone" src="/icone.svg" alt="" aria-hidden />
          <span>PsiDia<small style={{ color: 'var(--cinza-500)' }}>Configuração inicial</small></span>
        </div>
        <h1 style={{ fontSize: '1.3rem' }}>Crie a conta de administração</h1>
        <p className="mudo pequeno">Este é o primeiro acesso ao PsiDia. A conta criada aqui terá acesso total e poderá cadastrar a equipe.
          Esta tela só aparece enquanto nenhum usuário existir.</p>
        <ErroCaixa erro={erro} />
        <form onSubmit={criar}>
          <Campo rotulo="Seu nome">{(p) => <input {...p} type="text" autoComplete="name" required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />}</Campo>
          <Campo rotulo="E-mail">{(p) => <input {...p} type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Campo>
          <Campo rotulo="Senha" ajuda="Mínimo de 10 caracteres, com letras e números.">{(p) => <input {...p} type="password" autoComplete="new-password" required value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} />}</Campo>
          <Campo rotulo="Confirme a senha">{(p) => <input {...p} type="password" autoComplete="new-password" required value={f.conf} onChange={(e) => setF({ ...f, conf: e.target.value })} />}</Campo>
          <button className="btn grande" style={{ width: '100%' }} disabled={enviando}>{enviando ? 'Criando…' : 'Criar conta e entrar'}</button>
        </form>
      </main>
    </div>
  );
}

function FormLogin({ expirou }: { expirou?: boolean }) {
  const { recarregar } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);
  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true); setErro(null);
    try { await api.post('/auth/login', { email, senha }); await recarregar(); } catch (er) { setErro(er); } finally { setEnviando(false); }
  };
  return (
    <div className="login-pagina">
      <main className="login-cartao">
        <div className="marca" style={{ color: 'var(--azul-900)', padding: '0 0 16px' }}>
          <img className="marca-icone" src="/icone.svg" alt="" aria-hidden />
          <span>PsiDia<small style={{ color: 'var(--cinza-500)' }}>Gestão e evolução dos assistidos</small></span>
        </div>
        <h1 style={{ fontSize: '1.3rem' }}>Entrar</h1>
        {expirou && <div className="aviso atencao" role="status">Sua sessão foi encerrada por inatividade. Entre novamente.</div>}
        <ErroCaixa erro={erro} />
        <form onSubmit={entrar}>
          <Campo rotulo="E-mail">{(p) => <input {...p} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Campo>
          <Campo rotulo="Senha">{(p) => <input {...p} type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />}</Campo>
          <button className="btn grande" style={{ width: '100%' }} disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <p className="mudo pequeno" style={{ marginTop: 16 }}>Esqueceu a senha? Solicite à administração um link de redefinição.
          Acesso restrito à equipe autorizada — dados pessoais sensíveis protegidos pela LGPD.</p>
      </main>
    </div>
  );
}

export function TrocarSenha({ obrigatoria }: { obrigatoria?: boolean }) {
  const { recarregar, sair, usuario } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (nova !== conf) { setErro(new Error('A confirmação não confere com a nova senha.')); return; }
    setEnviando(true); setErro(null);
    try {
      await api.post('/auth/trocar-senha', { atual, nova });
      toast('ok', 'Senha alterada com sucesso. Outras sessões foram encerradas.');
      await recarregar();
      if (!obrigatoria) nav('/');
    } catch (er) { setErro(er); } finally { setEnviando(false); }
  };
  const form = (
    <form onSubmit={salvar} style={{ maxWidth: 420 }}>
      <ErroCaixa erro={erro} />
      <Campo rotulo="Senha atual">{(p) => <input {...p} type="password" autoComplete="current-password" required value={atual} onChange={(e) => setAtual(e.target.value)} />}</Campo>
      <Campo rotulo="Nova senha" ajuda="Mínimo de 10 caracteres, com letras e números.">{(p) => <input {...p} type="password" autoComplete="new-password" required value={nova} onChange={(e) => setNova(e.target.value)} />}</Campo>
      <Campo rotulo="Confirme a nova senha">{(p) => <input {...p} type="password" autoComplete="new-password" required value={conf} onChange={(e) => setConf(e.target.value)} />}</Campo>
      <div className="acoes">
        <button className="btn" disabled={enviando}>{enviando ? 'Salvando…' : 'Alterar senha'}</button>
        {obrigatoria && <button type="button" className="btn sec" onClick={sair}>Sair</button>}
      </div>
    </form>
  );
  if (obrigatoria) {
    return (
      <div className="login-pagina"><main className="login-cartao">
        <h1 style={{ fontSize: '1.3rem' }}>Defina sua senha</h1>
        <p className="mudo">Olá, {usuario?.nome}. Por segurança, troque a senha provisória antes de continuar.</p>
        {form}
      </main></div>
    );
  }
  return (
    <>
      <div className="cab-pagina"><div><h1>Minha conta</h1><p className="sub">{usuario?.email}</p></div></div>
      <div className="cartao"><h2>Alterar senha</h2>{form}</div>
    </>
  );
}

export function RedefinirSenha() {
  const token = window.location.hash.slice(1);
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [erro, setErro] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (nova !== conf) { setErro(new Error('A confirmação não confere com a nova senha.')); return; }
    try { await api.post('/auth/redefinir-senha', { token, nova }); setOk(true); history.replaceState(null, '', '/redefinir-senha'); } catch (er) { setErro(er); }
  };
  return (
    <div className="login-pagina"><main className="login-cartao">
      <h1 style={{ fontSize: '1.3rem' }}>Redefinir senha</h1>
      {ok ? (
        <><div className="aviso ok" role="status">Senha redefinida com sucesso.</div><a className="btn" href="/">Ir para o login</a></>
      ) : (
        <form onSubmit={salvar}>
          <ErroCaixa erro={erro} />
          {!token && <div className="aviso erro">Link inválido. Solicite um novo à administração.</div>}
          <Campo rotulo="Nova senha" ajuda="Mínimo de 10 caracteres, com letras e números.">{(p) => <input {...p} type="password" autoComplete="new-password" required value={nova} onChange={(e) => setNova(e.target.value)} />}</Campo>
          <Campo rotulo="Confirme a nova senha">{(p) => <input {...p} type="password" autoComplete="new-password" required value={conf} onChange={(e) => setConf(e.target.value)} />}</Campo>
          <button className="btn" disabled={!token}>Redefinir</button>
        </form>
      )}
    </main></div>
  );
}
