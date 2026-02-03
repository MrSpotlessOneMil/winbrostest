'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

interface User {
  id: number
  username: string
  display_name: string | null
  email: string | null
}

interface StoredAccount {
  user: User
  sessionToken?: string
}

interface AuthState {
  authenticated: boolean
  loading: boolean
  isAdmin: boolean
  user: User | null
  accounts: StoredAccount[]
  logout: () => Promise<void>
  refresh: () => Promise<void>
  switchAccount: (userId: number) => Promise<void>
  addAccount: (username: string, password: string) => Promise<{ success: boolean; error?: string }>
  removeAccount: (userId: number) => void
}

const AuthContext = createContext<AuthState>({
  authenticated: false,
  loading: true,
  isAdmin: false,
  user: null,
  accounts: [],
  logout: async () => {},
  refresh: async () => {},
  switchAccount: async () => {},
  addAccount: async () => ({ success: false }),
  removeAccount: () => {},
})

const ACCOUNTS_STORAGE_KEY = 'winbros_accounts'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [accounts, setAccounts] = useState<StoredAccount[]>([])

  // Load accounts from localStorage on mount
  // Filter out any accounts without session tokens (stale data from before multi-account update)
  useEffect(() => {
    const stored = localStorage.getItem(ACCOUNTS_STORAGE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as StoredAccount[]
        // Only keep accounts that have valid session tokens
        const validAccounts = parsed.filter((a) => a.sessionToken)
        setAccounts(validAccounts)
        // Update localStorage if we filtered any out
        if (validAccounts.length !== parsed.length) {
          localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(validAccounts))
        }
      } catch {
        // Invalid JSON, clear it
        localStorage.removeItem(ACCOUNTS_STORAGE_KEY)
      }
    }
  }, [])

  // Save accounts to localStorage when changed
  useEffect(() => {
    if (accounts.length > 0) {
      localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts))
    }
  }, [accounts])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session')
      const data = await res.json()

      if (data.success && data.data?.user) {
        setAuthenticated(true)
        setUser(data.data.user)
        setIsAdmin(data.data.user.username === 'admin')

        const sessionToken = data.data.sessionToken

        // Add to accounts list if not already there, including session token
        setAccounts((prev) => {
          const exists = prev.some((a) => a.user.id === data.data.user.id)
          if (!exists) {
            return [...prev, { user: data.data.user, sessionToken }]
          }
          // Update user info and token if it changed
          return prev.map((a) =>
            a.user.id === data.data.user.id
              ? { ...a, user: data.data.user, sessionToken: sessionToken || a.sessionToken }
              : a
          )
        })
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
    // Remove current user from accounts
    if (user) {
      setAccounts((prev) => prev.filter((a) => a.user.id !== user.id))
      localStorage.setItem(
        ACCOUNTS_STORAGE_KEY,
        JSON.stringify(accounts.filter((a) => a.user.id !== user.id))
      )
    }
    setAuthenticated(false)
    setUser(null)
    setIsAdmin(false)
    window.location.href = '/login'
  }

  const switchAccount = async (userId: number) => {
    const account = accounts.find((a) => a.user.id === userId)
    if (!account) return

    // If we have a session token for this account, use it to switch seamlessly
    if (account.sessionToken) {
      try {
        const res = await fetch('/api/auth/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionToken: account.sessionToken }),
        })

        const data = await res.json()

        if (data.success && data.data?.user) {
          // Update current user state
          setUser(data.data.user)
          setIsAdmin(data.data.user.username === 'admin')
          setAuthenticated(true)
          return
        }
      } catch {
        // If switch fails, fall through to login redirect
      }
    }

    // Fallback: redirect to login if no token or switch failed
    window.location.href = `/login?switch=${account.user.username}`
  }

  const addAccount = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const data = await res.json()

      if (data.success && data.data?.user) {
        // Add to accounts list with session token
        const newUser = data.data.user
        const sessionToken = data.data.sessionToken
        setAccounts((prev) => {
          const exists = prev.some((a) => a.user.id === newUser.id)
          if (!exists) {
            return [...prev, { user: newUser, sessionToken }]
          }
          // Update existing account with new token
          return prev.map((a) =>
            a.user.id === newUser.id ? { ...a, user: newUser, sessionToken } : a
          )
        })

        // Refresh to set as current user
        await refresh()
        return { success: true }
      }

      return { success: false, error: data.error || 'Login failed' }
    } catch (e: any) {
      return { success: false, error: e.message || 'Login failed' }
    }
  }

  const removeAccount = (userId: number) => {
    setAccounts((prev) => prev.filter((a) => a.user.id !== userId))
  }

  return (
    <AuthContext.Provider
      value={{
        authenticated,
        loading,
        isAdmin,
        user,
        accounts,
        logout,
        refresh,
        switchAccount,
        addAccount,
        removeAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
