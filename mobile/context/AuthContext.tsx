import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  isLoggedIn as checkLoggedIn,
  login as loginRequest,
  logout as logoutRequest,
  getCurrentUser,
  type CurrentUser,
} from '@/lib/auth';

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: CurrentUser | null;
  /** Devolve se a senha é temporária e precisa ser trocada. */
  login: (username: string, password: string) => Promise<{ mustChangePassword: boolean }>;
  logout: () => Promise<void>;
  /** Lê o usuário de novo na API (ex.: depois de trocar a foto de perfil). */
  refreshUser: () => Promise<void>;
}

/** Contexto da sessão do usuário. */
const AuthContext = createContext<AuthContextValue | null>(null);

/** Provedor da sessão: confere o token ao abrir o aplicativo e guarda o usuário logado. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    checkLoggedIn().then(async (logged) => {
      setIsAuthenticated(logged);
      if (logged) {
        const me = await getCurrentUser();
        setUser(me);
      }
      setIsLoading(false);
    });
  }, []);

  const login = async (username: string, password: string) => {
    const result = await loginRequest(username, password);
    setIsAuthenticated(true);
    const me = await getCurrentUser();
    setUser(me);
    return result;
  };

  const logout = async () => {
    await logoutRequest();
    setIsAuthenticated(false);
    setUser(null);
  };

  const refreshUser = async () => {
    const me = await getCurrentUser();
    if (me) setUser(me);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, user, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Acessa a sessão do usuário. Só funciona dentro de `AuthProvider`. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
