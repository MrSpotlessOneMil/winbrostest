"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { BarChart3, Filter, Users, Repeat, DollarSign } from "lucide-react"

const TABS = [
  { label: "Revenue", href: "/insights/revenue", icon: DollarSign },
  { label: "Lead Sources", href: "/insights/leads", icon: BarChart3 },
  { label: "Funnel", href: "/insights/funnel", icon: Filter },
  { label: "Crews", href: "/insights/crews", icon: Users },
  { label: "Retention", href: "/insights/retention", icon: Repeat },
  { label: "Pricing", href: "/insights/pricing", icon: DollarSign },
] as const

export function InsightsNav() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-1.5 flex-wrap">
      {TABS.map((tab) => {
        const isActive = pathname === tab.href
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-150",
              isActive
                ? "bg-primary/20 text-primary shadow-[inset_0_0_12px_rgba(124,58,237,0.15)]"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
