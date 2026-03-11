import { Skeleton } from "@/components/ui/skeleton"

export default function JobsLoading() {
  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </div>

      {/* Calendar toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
        </div>
        <Skeleton className="h-6 w-40" />
        <div className="flex gap-1">
          <Skeleton className="h-9 w-16 rounded-md" />
          <Skeleton className="h-9 w-16 rounded-md" />
          <Skeleton className="h-9 w-16 rounded-md" />
        </div>
      </div>

      {/* Calendar grid */}
      <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-zinc-800">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="p-2 text-center">
              <Skeleton className="h-4 w-8 mx-auto" />
            </div>
          ))}
        </div>
        {/* Calendar rows */}
        {Array.from({ length: 5 }).map((_, row) => (
          <div key={row} className="grid grid-cols-7 border-b border-zinc-800 last:border-b-0">
            {Array.from({ length: 7 }).map((_, col) => (
              <div key={col} className="min-h-[100px] p-2 border-r border-zinc-800 last:border-r-0">
                <Skeleton className="h-4 w-6 mb-2" />
                {row < 3 && col < 5 && (
                  <div className="space-y-1">
                    <Skeleton className="h-5 w-full rounded" />
                    {col % 2 === 0 && <Skeleton className="h-5 w-3/4 rounded" />}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}