import { Phone, Instagram, Globe, MessageSquare } from "lucide-react"

export const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  phone: { label: "Phone Calls", color: "#5b8def" },
  vapi: { label: "Phone (Vapi)", color: "#7ca3f0" },
  meta: { label: "Meta Ads", color: "#4ade80" },
  website: { label: "Website", color: "#facc15" },
  sms: { label: "SMS", color: "#f472b6" },
  housecall_pro: { label: "HousecallPro", color: "#a78bfa" },
  ghl: { label: "GoHighLevel", color: "#fb923c" },
  manual: { label: "Manual", color: "#94a3b8" },
}

export const DEFAULT_COLOR = "#6b7280"

export function getSourceConfig(source: string) {
  return SOURCE_CONFIG[source] || { label: source, color: DEFAULT_COLOR }
}

export const SOURCE_ICONS: Record<string, typeof Phone | null> = {
  phone: Phone,
  vapi: Phone,
  meta: Instagram,
  website: Globe,
  sms: MessageSquare,
}
