import { redirect } from "next/navigation"

/**
 * Legacy /crews route — Round-2-Wave-2 retired this in favor of
 * /appointments, then Phase K (Blake call 2026-04-28) restored the daily
 * crew-roster UI under /crew-assignment. Both old bookmarks and old sidebar
 * caches land here, so we forward straight to the new route.
 */
export default function CrewsRedirectPage(): never {
  redirect("/crew-assignment")
}
