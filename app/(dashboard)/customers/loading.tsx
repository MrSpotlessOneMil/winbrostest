import { Skeleton } from "@/components/ui/skeleton"

export default function CustomersLoading() {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-1 gap-4 min-h-0 overflow-hidden">
          {/* Sidebar list */}
          <div className="w-full md:w-72 flex-shrink-0 flex flex-col min-h-0">
            <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 flex flex-col h-full overflow-hidden">
              <div className="p-3 border-b border-zinc-800 space-y-2">
                <Skeleton className="h-9 w-full rounded-lg" />
                <Skeleton className="h-8 w-full rounded-lg" />
              </div>
              <div className="flex-1 p-2 space-y-1">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg">
                    <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-28" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Detail panel */}
          <div className="hidden md:flex flex-1 flex-col min-h-0">
            <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 flex flex-col h-full overflow-hidden">
              <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <div className="flex-1 p-4 space-y-4">
                <div className="flex gap-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-20 rounded-md" />
                  ))}
                </div>
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}