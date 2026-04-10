"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { DateRange } from "react-day-picker"

const PRESETS = [
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "90d", value: "90d" },
  { label: "YTD", value: "ytd" },
] as const

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function DateRangePicker() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [popoverOpen, setPopoverOpen] = useState(false)

  const currentRange = searchParams.get("range") || "30d"
  const customFrom = searchParams.get("from")
  const customTo = searchParams.get("to")

  const updateParams = useCallback(
    (params: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, val] of Object.entries(params)) {
        if (val === null) {
          next.delete(key)
        } else {
          next.set(key, val)
        }
      }
      router.push(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams]
  )

  function handlePreset(value: string) {
    updateParams({ range: value, from: null, to: null })
  }

  function handleCustomRange(range: DateRange | undefined) {
    if (!range?.from) return
    const from = formatDate(range.from)
    const to = range.to ? formatDate(range.to) : from
    updateParams({ range: "custom", from, to })
    if (range.to) {
      setPopoverOpen(false)
    }
  }

  const calendarSelected = useMemo((): DateRange | undefined => {
    if (currentRange !== "custom" || !customFrom) return undefined
    return {
      from: new Date(customFrom + "T00:00:00"),
      to: customTo ? new Date(customTo + "T00:00:00") : undefined,
    }
  }, [currentRange, customFrom, customTo])

  const customLabel = useMemo(() => {
    if (currentRange !== "custom" || !customFrom) return "Custom"
    const from = new Date(customFrom + "T00:00:00")
    const to = customTo ? new Date(customTo + "T00:00:00") : from
    return `${formatDisplayDate(from)} - ${formatDisplayDate(to)}`
  }, [currentRange, customFrom, customTo])

  return (
    <div className="flex items-center gap-1.5">
      {PRESETS.map((preset) => (
        <Button
          key={preset.value}
          variant="ghost"
          size="sm"
          onClick={() => handlePreset(preset.value)}
          className={cn(
            "h-7 px-2.5 text-xs font-medium rounded-full",
            currentRange === preset.value
              ? "bg-primary/20 text-primary shadow-[inset_0_0_12px_rgba(124,58,237,0.15)]"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {preset.label}
        </Button>
      ))}

      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-2.5 text-xs font-medium rounded-full gap-1",
              currentRange === "custom"
                ? "bg-primary/20 text-primary shadow-[inset_0_0_12px_rgba(124,58,237,0.15)]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <CalendarIcon className="h-3 w-3" />
            {customLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            selected={calendarSelected}
            onSelect={handleCustomRange}
            numberOfMonths={2}
            disabled={{ after: new Date() }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
