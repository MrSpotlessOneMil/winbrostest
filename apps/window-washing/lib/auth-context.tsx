'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

interface User {
  id: number
  username: string
  display_name: string | null
  email: string | null
  tenantSlug: string | null
}

interface StoredAccount {
  user: User
  sessionToken?: string
}

interface TenantStatus {
  active: boolean
  smsEnabled: boolean
}

type EmployeeType = 'technician' | 'salesman' | 'team_lead' | null
type RoleLabel = 'Owner' | 'Team Lead' | 'Salesman' | 'Technician' | null

export function deriveRoleLabel(args: {
  isAdmin: boolean
  isTeamLead: boolean
  employeeType: EmployeeType
}): RoleLabel {
  if (args.isAdmin) return 'Owner'
  if (args.isTeamLead) return 'Team Lead'
  if (args.employeeType === 'salesman') return 'Salesman'
  if (args.employeeType === 'technician') return 'Technician'
  return null
}

interface AuthState {
  authenticated: boolean
  loading: boolean
  isAdmin: boolean
  isSalesman: boolean
  isTeamLead: boolean
  employeeType: EmployeeType
  /**
   * Human-readable role for sidebar pills and other UI. Derived from isAdmin,
   * isTeamLead, and employeeType. Sidebar uses this so it stays in sync with
   * the rest of the app instead of recomputing the precedence in two places.
   */
  roleLabel: RoleLabel
  cleanerId: number | null
  portalToken: string | null
  user: User | null
  tenantStatus: TenantStatus | null
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
  isSalesman: false,
  isTeamLead: false,
  employeeType: null,
  roleLabel: null,
  cleanerId: null,
  portalToken: null,
  user: null,
  tenantStatus: null,
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
  const [isSalesman, setIsSalesman] = useState(false)
  const [isTeamLead, setIsTeamLead] = useState(false)
  const [employeeType, setEmployeeType] = useState<EmployeeType>(null)
  const [cleanerId, setCleanerId] = useState<number | null>(null)
  const [portalToken, setPortalToken] = useState<string | null>(null)
  const [tenantStatus, setTenantStatus] = useState<TenantStatus | null>(null)
  const [accounts, setAccounts] = useState<StoredAccount[]>([])

  // Load accounts from localStorage on mount
  // Filter out stale data and deduplicate by username (not user.id, which can change across DB recreations)
  useEffect(() => {
    const stored = localStorage.getItem(ACCOUNTS_STORAGE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as StoredAccount[]
        // Only keep accounts that have valid session tokens
        const withTokens = parsed.filter((a) => a.sessionToken)
        // Deduplicate by display label (tenantSlug || username) — keeps the latest entry
        // This handles stale entries from DB recreations where username may have changed
        const seen = new Map<string, StoredAccount>()
        for (const account of withTokens) {
          const label = account.user.tenantSlug || account.user.username
          seen.set(label, account)
        }
        const validAccounts = Array.from(seen.values())
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
        // Wave C — every role lands on the dashboard. employee_type drives
        // sidebar (admin nav vs field nav) and per-page widgets. Techs +
        // team-leads no longer get bumped to /crew/<token>; instead, the
        // SMS deeplinks go through /api/auth/portal-exchange which mints a
        // session and lands them here.
        if (data.data.type === 'employee') {
          const empType = (data.data.employeeType || 'technician') as EmployeeType
          setEmployeeType(empType)
          setIsSalesman(empType === 'salesman')
          setIsTeamLead(!!data.data.isTeamLead)
          setCleanerId(data.data.cleanerId || null)
          setPortalToken(data.data.portalToken || null)
        } else {
          setEmployeeType(null)
          setIsSalesman(false)
          setIsTeamLead(false)
          setCleanerId(null)
          setPortalToken(null)
        }

        setAuthenticated(true)
        setUser(data.data.user)
        setIsAdmin(data.data.type === 'owner')
        setTenantStatus(data.data.tenantStatus || null)

        const sessionToken = data.data.sessionToken

        // Add to accounts list if not already there, including session token
        // Deduplicate by display label (tenantSlug || username) to catch stale entries from DB recreations
        const newLabel = data.data.user.tenantSlug || data.data.user.username
        setAccounts((prev) => {
          const exists = prev.some((a) => (a.user.tenantSlug || a.user.username) === newLabel)
          if (!exists) {
            return [...prev, { user: data.data.user, sessionToken }]
          }
          // Update user info (including id) and token if it changed
          return prev.map((a) =>
            (a.user.tenantSlug || a.user.username) === newLabel
              ? { ...a, user: data.data.user, sessionToken: sessionToken || a.sessionToken }
              : a
          )
        })
      } else {
        setAuthenticated(false)
        setUser(null)
        setIsAdmin(false)
        setIsSalesman(false)
        setIsTeamLead(false)
        setEmployeeType(null)
        setCleanerId(null)
        setPortalToken(null)
        setTenantStatus(null)
      }
    } catch {
      setAuthenticated(false)
      setUser(null)
      setIsAdmin(false)
      setIsSalesman(false)
      setIsTeamLead(false)
      setEmployeeType(null)
      setCleanerId(null)
      setPortalToken(null)
      setTenantStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    // Remove current user from accounts by username (stable across DB recreations)
    if (user) {
      const currentLabel = user.tenantSlug || user.username
      setAccounts((prev) => prev.filter((a) => (a.user.tenantSlug || a.user.username) !== currentLabel))
      localStorage.setItem(
        ACCOUNTS_STORAGE_KEY,
        JSON.stringify(accounts.filter((a) => (a.user.tenantSlug || a.user.username) !== currentLabel))
      )
    }
    setAuthenticated(false)
    setUser(null)
    setIsAdmin(false)
    setIsSalesman(false)
    setIsTeamLead(false)
    setEmployeeType(null)
    setCleanerId(null)
    setPortalToken(null)
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
          setIsAdmin(data.data.type === 'owner')
          if (data.data.type === 'employee') {
            const empType = (data.data.employeeType || 'technician') as EmployeeType
            setEmployeeType(empType)
            setIsSalesman(empType === 'salesman')
            setIsTeamLead(!!data.data.isTeamLead)
            setCleanerId(data.data.cleanerId || null)
            setPortalToken(data.data.portalToken || null)
          } else {
            setEmployeeType(null)
            setIsSalesman(false)
            setIsTeamLead(false)
            setCleanerId(null)
            setPortalToken(null)
          }
          setTenantStatus(data.data.tenantStatus || null)
          setAuthenticated(true)

          // Update the stored account with fresh user data, matching by username
          // (handles case where user.id changed across DB recreations)
          setAccounts((prev) =>
            prev.map((a) =>
              a.user.username === data.data.user.username
                ? { ...a, user: data.data.user }
                : a
            )
          )
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
        // Login response may not have tenantSlug, so match by username + label
        const newUser = data.data.user
        const sessionToken = data.data.sessionToken
        const newLabel = newUser.tenantSlug || newUser.username
        setAccounts((prev) => {
          const exists = prev.some((a) => (a.user.tenantSlug || a.user.username) === newLabel)
          if (!exists) {
            return [...prev, { user: newUser, sessionToken }]
          }
          // Update existing account with new token and fresh user data
          return prev.map((a) =>
            (a.user.tenantSlug || a.user.username) === newLabel ? { ...a, user: newUser, sessionToken } : a
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

  const roleLabel = deriveRoleLabel({ isAdmin, isTeamLead, employeeType })

  return (
    <AuthContext.Provider
      value={{
        authenticated,
        loading,
        isAdmin,
        isSalesman,
        isTeamLead,
        employeeType,
        roleLabel,
        cleanerId,
        portalToken,
        user,
        tenantStatus,
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
