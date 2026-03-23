"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Loader2, AlertCircle } from "lucide-react"
import type { PortalData } from "./crew-types"
import Design1 from "./designs/design1"
import Design2 from "./designs/design2"
import Design3 from "./designs/design3"
import Design4 from "./designs/design4"
import Design5 from "./designs/design5"

const DESIGNS = [
  { id: 1, name: "Midnight Luxe", component: Design1, desc: "Dark glassmorphism" },
  { id: 2, name: "Aurora", component: Design2, desc: "Light gradient premium" },
  { id: 3, name: "Mono", component: Design3, desc: "Ultra-minimal editorial" },
  { id: 4, name: "Neon", component: Design4, desc: "Dark + electric accents" },
  { id: 5, name: "Warm", component: Design5, desc: "Earth-toned luxury" },
]

export default function CrewPortalPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = params.token as string

  const designParam = searchParams.get("design")
  const designNum = designParam ? parseInt(designParam, 10) : 0
  const showPicker = designParam !== null

  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/crew/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error("Invalid portal link")
        return res.json()
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    fetch(`/api/crew/${token}/auto-session`, { method: "POST" }).catch(() => {})
  }, [token])

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
    router.push("/login")
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="size-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center">
          <AlertCircle className="size-12 text-red-400 mx-auto mb-3" />
          <h1 className="text-xl font-semibold text-slate-800">Invalid Link</h1>
          <p className="text-slate-500 mt-1">This portal link is not valid or has expired.</p>
        </div>
      </div>
    )
  }

  // Find the active design (default to Design 2 Aurora if no param or invalid)
  const activeDesign = DESIGNS.find((d) => d.id === designNum) || DESIGNS[1]
  const DesignComponent = activeDesign.component

  return (
    <>
      <DesignComponent data={data} token={token} onLogout={handleLogout} />

      {/* Design Picker — only shows when ?design= param is present */}
      {showPicker && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-lg border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.1)]">
          <div className="max-w-lg mx-auto px-3 py-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-2 text-center">
              Pick Your Design
            </p>
            <div className="flex gap-1.5 justify-center">
              {DESIGNS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => router.replace(`/crew/${token}?design=${d.id}`)}
                  className={`flex-1 py-2 px-1 rounded-lg text-center transition-all ${
                    activeDesign.id === d.id
                      ? "bg-slate-900 text-white shadow-md"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <span className="text-xs font-semibold block">{d.id}</span>
                  <span className="text-[9px] block mt-0.5 opacity-70">{d.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
