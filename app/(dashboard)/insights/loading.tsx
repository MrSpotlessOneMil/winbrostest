import { Skeleton } from "@/components/ui/skeleton"

export default function InsightsLoading() {
  return (
    <div className="space-y-6 p-4">
      <Skeleton className="h-7 w-32" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4">
            <Skeleton className="h-5 w-36 mb-4" />
            <Skeleton className="h-[250px] w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}