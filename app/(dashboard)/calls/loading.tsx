import { Skeleton } from "@/components/ui/skeleton"

export default function CallsLoading() {
  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 flex-1 max-w-sm rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4 flex items-center gap-4">
            <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}