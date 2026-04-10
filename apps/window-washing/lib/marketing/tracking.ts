"use client"

// Meta Pixel helpers
function fbq(...args: unknown[]) {
  if (typeof window !== "undefined" && (window as Record<string, unknown>).fbq) {
    ;(window as Record<string, (...args: unknown[]) => void>).fbq(...args)
  }
}

// GA4 helpers
function gtag(...args: unknown[]) {
  if (typeof window !== "undefined" && (window as Record<string, unknown>).gtag) {
    ;(window as Record<string, (...args: unknown[]) => void>).gtag(...args)
  }
}

export function trackLead(source: string) {
  fbq("track", "Lead", { content_name: source })
  gtag("event", "generate_lead", { event_category: "conversion", event_label: source })
}

export function trackFormSubmit(formName: string) {
  fbq("trackCustom", "FormSubmit", { form_name: formName })
  gtag("event", "form_submit", { event_category: "engagement", event_label: formName })
}

export function trackPhoneClick() {
  fbq("track", "Contact", { content_name: "phone_click" })
  gtag("event", "phone_click", { event_category: "conversion" })
}

export function trackPageView(pageName: string) {
  fbq("trackCustom", "CustomPageView", { page_name: pageName })
  gtag("event", "page_view", { page_title: pageName })
}

export function trackServiceView(serviceName: string) {
  fbq("track", "ViewContent", { content_name: serviceName, content_type: "service" })
  gtag("event", "view_item", { event_category: "service", event_label: serviceName })
}
