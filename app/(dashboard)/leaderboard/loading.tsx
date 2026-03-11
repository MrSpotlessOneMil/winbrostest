import { Skeleton } from "@/components/ui/skeleton"

export default function LeaderboardLoading() {
  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4 flex items-center gap-4">
            <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
            <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}