"use client"

import { Card, CardContent } from "@/components/ui/card"
import { TrendingUp, TrendingDown } from "lucide-react"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface MetricCardProps {
  label: string
  value: number
  previousValue?: number
  prefix?: string
  suffix?: string
  format?: "number" | "currency" | "percent"
  sparklineData?: number[]
  sparklineColor?: string
  icon: LucideIcon
}

function formatValue(value: number, format: MetricCardProps["format"], prefix?: string, suffix?: string): string {
  let formatted: string
  switch (format) {
    case "currency":
      formatted = value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      break
    case "percent":
      formatted = value.toFixed(1)
      break
    default:
      formatted = value.toLocaleString("en-US")
  }
  return `${prefix || ""}${formatted}${suffix || ""}`
}

function computeDelta(value: number, previousValue?: number): { percent: number; direction: "up" | "down" | "neutral" } {
  if (previousValue === undefined || previousValue === 0) {
    return { percent: 0, direction: "neutral" }
  }
  const change = ((value - previousValue) / Math.abs(previousValue)) * 100
  if (Math.abs(change) < 0.1) return { percent: 0, direction: "neutral" }
  return {
    percent: Math.abs(Math.round(change)),
    direction: change > 0 ? "up" : "down",
  }
}

function Sparkline({ data, color = "#a78bfa", height = 32 }: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return null

  const width = 96
  const padding = 2
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2)
    const y = height - padding - ((v - min) / range) * (height - padding * 2)
    return { x, y }
  })

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`
  const gradientId = `sparkline-${color.replace("#", "")}`

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function MetricCard({
  label,
  value,
  previousValue,
  prefix,
  suffix,
  format = "number",
  sparklineData,
  sparklineColor = "#a78bfa",
  icon: Icon,
}: MetricCardProps) {
  const delta = computeDelta(value, previousValue)

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
            <p className="text-2xl font-bold text-primary truncate">
              {formatValue(value, format, prefix, suffix)}
            </p>
            {delta.direction !== "neutral" && (
              <div className="flex items-center gap-1">
                {delta.direction === "up" ? (
                  <TrendingUp className="h-3.5 w-3.5 text-success" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                )}
                <span
                  className={cn(
                    "text-xs font-medium",
                    delta.direction === "up" ? "text-success" : "text-destructive"
                  )}
                >
                  {delta.percent}%
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-4.5 w-4.5" />
            </div>
            {sparklineData && sparklineData.length >= 2 && (
              <Sparkline data={sparklineData} color={sparklineColor} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
