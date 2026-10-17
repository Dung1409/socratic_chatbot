import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authApi, clearAuthState, type AuthUser } from "@/lib/api";

type AuthContextValue = {
  user: AuthUser | null;
  pending: boolean;
  error: string | null;
  retry: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const forget = useCallback(() => {
    if (user) {
      for (let index = sessionStorage.length - 1; index >= 0; index--) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(`socratic:${user.id}:`)) sessionStorage.removeItem(key);
      }
    }
    clearAuthState();
    client.clear();
    setUser(null);
  }, [client, user]);

  useEffect(() => {
    let active = true;
    setPending(true);
    setError(null);
    void authApi
      .session()
      .then((session) => {
        if (active) setUser(session?.user ?? null);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Không kết nối được hệ thống.");
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    window.addEventListener("socratic:logged-out", forget);
    return () => window.removeEventListener("socratic:logged-out", forget);
  }, [forget]);

  return (
    <AuthContext.Provider
      value={{
        user,
        pending,
        error,
        retry: () => setAttempt((value) => value + 1),
        login: async (email, password) => {
          const session = await authApi.login(email, password);
          client.clear();
          setUser(session.user);
        },
        register: async (name, email, password) => {
          const session = await authApi.register(name, email, password);
          client.clear();
          setUser(session.user);
        },
        logout: async () => {
          await authApi.logout();
          forget();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is required");
  return context;
}
