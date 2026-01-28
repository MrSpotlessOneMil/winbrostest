"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Clock, Users, MapPin, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

// NOTE: We intentionally keep this dynamic (no hardcoded exceptions).
// When you want real exceptions, we can add a dedicated `/api/exceptions` backed by `system_events` + alert tables.
const exceptions: Array<{
  id: string
  type: "no-confirm" | "high-value" | "routing" | "scheduling"
  title: string
  description: string
  time: string
  priority: "high" | "medium" | "low"
  action: string
}> = []

const typeIcons = {
  "no-confirm": Users,
  "high-value": AlertTriangle,
  routing: MapPin,
  scheduling: Clock,
}

const priorityConfig = {
  high: { label: "High", className: "bg-destructive/10 text-destructive border-destructive/20" },
  medium: { label: "Medium", className: "bg-warning/10 text-warning border-warning/20" },
  low: { label: "Low", className: "bg-muted text-muted-foreground border-border" },
}

export function ExceptionsList() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Exceptions
          </CardTitle>
          <CardDescription>Issues requiring attention</CardDescription>
        </div>
        <Button variant="outline" size="sm">
          View All
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {exceptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
              <AlertTriangle className="h-6 w-6 text-success" />
            </div>
            <p className="mt-3 font-medium text-foreground">All clear!</p>
            <p className="text-sm text-muted-foreground">No exceptions to handle</p>
          </div>
        ) : (
          <div className="space-y-3">
            {exceptions.map((exception) => {
              const TypeIcon = typeIcons[exception.type as keyof typeof typeIcons]
              return (
                <div
                  key={exception.id}
                  className={cn(
                    "flex items-start gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/50",
                    exception.priority === "high" && "border-destructive/30 bg-destructive/5",
                    exception.priority === "medium" && "border-warning/30 bg-warning/5",
                    exception.priority === "low" && "border-border"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      exception.priority === "high" && "bg-destructive/10",
                      exception.priority === "medium" && "bg-warning/10",
                      exception.priority === "low" && "bg-muted"
                    )}
                  >
                    <TypeIcon
                      className={cn(
                        "h-5 w-5",
                        exception.priority === "high" && "text-destructive",
                        exception.priority === "medium" && "text-warning",
                        exception.priority === "low" && "text-muted-foreground"
                      )}
                    />
                  </div>

                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">{exception.title}</span>
                      <Badge
                        variant="outline"
                        className={priorityConfig[exception.priority as keyof typeof priorityConfig].className}
                      >
                        {priorityConfig[exception.priority as keyof typeof priorityConfig].label}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{exception.description}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{exception.time}</span>
                      <Button variant="ghost" size="sm" className="h-7 text-xs">
                        {exception.action}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
