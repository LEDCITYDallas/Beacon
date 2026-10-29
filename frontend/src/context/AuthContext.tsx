import React, { createContext, useContext, useEffect, useState } from "react";
import client from "../api/client";

type Role = "SUPER_ADMIN" | "MANAGER" | "EMPLOYEE";

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: string;
  consentAccepted: boolean;
  consentVersion?: string;
  requiredConsentVersion?: string;
  consentCurrent?: boolean;
  timezone: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  acceptConsent: () => Promise<void>;
  withdrawConsent: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    client
      .get("/auth/me")
      .then((res) => setUser(res.data.user))
      .catch((err) => {
        if (err.response?.data?.code !== "CONSENT_REQUIRED") {
          localStorage.removeItem("token");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await client.post("/auth/login", { email, password });
    localStorage.setItem("token", res.data.token);
    setUser(res.data.user);
  }

  function logout() {
    localStorage.removeItem("token");
    setUser(null);
  }

  async function acceptConsent() {
    const res = await client.post("/auth/consent", {});
    setUser(res.data.user);
  }

  async function withdrawConsent() {
    await client.post("/auth/consent/withdraw", {});
    logout();
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, acceptConsent, withdrawConsent }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
