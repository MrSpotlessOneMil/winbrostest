'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

interface User {
  id: number
  username: string
  display_name: string | null
  email: string | null
}

interface AuthState {
  authenticated: boolean
  loading: boolean
  isAdmin: boolean
  user: User | null
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  authenticated: false,
  loading: true,
  isAdmin: false,
  user: null,
  logout: async () => {},
  refresh: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session')
      const data = await res.json()

      if (data.success && data.data?.user) {
        setAuthenticated(true)
        setUser(data.data.user)
        setIsAdmin(data.data.user.username === 'admin')
      } else {
        setAuthenticated(false)
        setUser(null)
        setIsAdmin(false)
      }
    } catch {
      setAuthenticated(false)
      setUser(null)
      setIsAdmin(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setAuthenticated(false)
    setUser(null)
    setIsAdmin(false)
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider
      value={{
        authenticated,
        loading,
        isAdmin,
        user,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
