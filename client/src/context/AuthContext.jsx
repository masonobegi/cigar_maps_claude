import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('cigarbuddy_token');
    if (token) {
      api.me().then(({ user, store }) => {
        setUser(user);
        setStore(store);
      }).catch(() => {
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
    // Fetch store if store account
    if (user.account_type === 'store') {
      const { store } = await api.me();
      setStore(store);
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
  }

  function refreshStore(s) {
    setStore(s);
  }

  return (
    <AuthContext.Provider value={{ user, store, loading, login, register, logout, refreshStore }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
