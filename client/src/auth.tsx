import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, definirAoExpirar } from './api';

export interface Usuario {
  id: string; nome: string; email: string; perfil: 'admin' | 'profissional' | 'consulta';
  deveTrocarSenha: boolean; permissoes: string[];
}

interface Ctx {
  usuario: Usuario | null;
  carregando: boolean;
  pode: (p: string) => boolean;
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
  expirou: boolean;
}

const AuthCtx = createContext<Ctx>(null as unknown as Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [expirou, setExpirou] = useState(false);

  const recarregar = useCallback(async () => {
    try {
      setUsuario(await api.get<Usuario>('/auth/me'));
      setExpirou(false);
    } catch {
      setUsuario(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    definirAoExpirar(() => { setUsuario((u) => { if (u) setExpirou(true); return null; }); });
    recarregar();
  }, [recarregar]);

  const sair = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setUsuario(null);
  }, []);

  const pode = useCallback((p: string) => !!usuario?.permissoes.includes(p), [usuario]);

  return <AuthCtx.Provider value={{ usuario, carregando, pode, recarregar, sair, expirou }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
