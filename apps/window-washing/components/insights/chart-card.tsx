"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ToggleOption {
  label: string
  value: string
}

interface ChartCardProps {
  title: string
  subtitle?: string
  children: React.ReactNode
  toggleOptions?: ToggleOption[]
  onToggle?: (value: string) => void
  activeToggle?: string
}

export function ChartCard({
  title,
  subtitle,
  children,
  toggleOptions,
  onToggle,
  activeToggle,
}: ChartCardProps) {
  const [internalToggle, setInternalToggle] = useState(toggleOptions?.[0]?.value ?? "")
  const currentToggle = activeToggle ?? internalToggle

  function handleToggle(value: string) {
    setInternalToggle(value)
    onToggle?.(value)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            {subtitle && <CardDescription>{subtitle}</CardDescription>}
          </div>
          {toggleOptions && toggleOptions.length > 1 && (
            <div className="flex items-center gap-1 rounded-full border border-border p-0.5">
              {toggleOptions.map((opt) => (
                <Button
                  key={opt.value}
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggle(opt.value)}
                  className={cn(
                    "h-6 px-2.5 text-xs font-medium rounded-full",
                    currentToggle === opt.value
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
