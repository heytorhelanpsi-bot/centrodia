import 'express';

declare global {
  namespace Express {
    interface Request {
      usuario?: {
        id: string;
        nome: string;
        email: string;
        perfil: 'admin' | 'profissional' | 'consulta';
        permissoes: Set<string>;
        deveTrocarSenha: boolean;
        sessaoId: string;
      };
    }
  }
}
export {};
