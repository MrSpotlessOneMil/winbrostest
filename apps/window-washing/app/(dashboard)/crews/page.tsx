import { redirect } from "next/navigation"

/**
 * Legacy /crews route — superseded by /appointments (WinBros Round 2 task 4+5).
 * Preserved as a thin redirect so any bookmarked links or sidebar caches
 * still land users in the right place. Original implementation lives alongside
 * as `_legacy-page.tsx` for reference.
 */
export default function CrewsRedirectPage(): never {
  redirect("/appointments")
}
