"use client"

/**
 * QuoteBuilderSheet — slide-over wrapper around QuoteBuilder so the salesman
 * "+ New Quote" flow on /jobs Calendar opens as a popup, not a navigation.
 *
 * Locks two of Dominic's hard requirements:
 *  1. URL stays on /jobs (no router.push)
 *  2. Same UI Max already approved for the page (no parallel implementations
 *     that drift out of sync)
 */

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import { QuoteBuilder } from "@/components/winbros/quote-builder"

interface QuoteBuilderSheetProps {
  quoteId: string | null
  open: boolean
  onClose: () => void
  onSaved?: () => void
}

export function QuoteBuilderSheet({
  quoteId,
  open,
  onClose,
  onSaved,
}: QuoteBuilderSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <SheetContent
        side="right"
        data-testid="quote-builder-sheet"
        className="w-full sm:max-w-3xl lg:max-w-4xl overflow-y-auto bg-zinc-950 p-0 border-l border-zinc-800"
      >
        <VisuallyHidden>
          <SheetTitle>Quote Builder</SheetTitle>
        </VisuallyHidden>
        {quoteId && (
          <QuoteBuilder
            quoteId={quoteId}
            variant="embedded"
            backLabel="Close"
            onClose={onClose}
            onSaved={() => onSaved?.()}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
