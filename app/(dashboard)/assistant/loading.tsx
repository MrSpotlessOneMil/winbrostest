import { Skeleton } from "@/components/ui/skeleton"

export default function AssistantLoading() {
  return (
    <div className="flex flex-col h-full p-4">
      <Skeleton className="h-7 w-32 mb-4" />
      <div className="flex-1 space-y-4 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
            <Skeleton className={`h-16 rounded-xl ${i % 2 === 0 ? "w-2/3" : "w-1/2"}`} />
          </div>
        ))}
      </div>
      <div className="mt-4">
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    </div>
  )
}
