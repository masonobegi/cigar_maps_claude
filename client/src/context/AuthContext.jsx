import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [store, setStore] = useState(null);
  const [pendingClaim, setPendingClaim] = useState(null);
  const [loading, setLoading] = useState(true);

  function applyMe({ user, store, pending_claim }) {
    setUser(user);
    setStore(store || null);
    setPendingClaim(pending_claim || null);
  }

  useEffect(() => {
    const token = localStorage.getItem('cigarbuddy_token');
    if (token) {
      api.me().then(applyMe).catch(() => {
        localStorage.removeItem('cigarbuddy_token');
      }).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  async function login(email, password) {
    const { token, user } = await api.login({ email, password });
    localStorage.setItem('cigarbuddy_token', token);
    setUser(user);
    // Fetch store (or pending claim) if store account
    if (user.account_type === 'store') {
      const me = await api.me();
      setStore(me.store || null);
      setPendingClaim(me.pending_claim || null);
    }
    return user;
  }

  async function register(email, password, name, account_type) {
    const { token, user } = await api.register({ email, password, name, account_type });
    localStorage.setItem('cigarbuddy_token', token);
    setUser(user);
    return user;
  }

  function logout() {
    localStorage.removeItem('cigarbuddy_token');
    setUser(null);
    setStore(null);
    setPendingClaim(null);
  }

  function refreshStore(s) {
    setStore(s);
    if (s) setPendingClaim(null);
  }

  async function refreshMe() {
    const me = await api.me();
    applyMe(me);
    return me;
  }

  return (
    <AuthContext.Provider value={{ user, store, pendingClaim, loading, login, register, logout, refreshStore, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
