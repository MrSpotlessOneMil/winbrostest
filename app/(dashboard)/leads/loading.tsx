import { Skeleton } from "@/components/ui/skeleton"

export default function LeadsLoading() {
  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4 rounded" />
            </div>
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4">
          <Skeleton className="h-5 w-32 mb-4" />
          <Skeleton className="h-[200px] w-full rounded-lg" />
        </div>
        <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4">
          <Skeleton className="h-5 w-32 mb-4" />
          <Skeleton className="h-[200px] w-full rounded-lg" />
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 flex-1 max-w-sm rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      {/* Lead list */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4 flex items-center gap-4">
            <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}