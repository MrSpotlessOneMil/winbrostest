import { Skeleton } from "@/components/ui/skeleton"

export default function EarningsLoading() {
  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4">
        <Skeleton className="h-5 w-32 mb-4" />
        <Skeleton className="h-[250px] w-full rounded-lg" />
      </div>
    </div>
  )
}