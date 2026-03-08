import { describe, it, expect, vi } from "vitest"

// Mock nodemailer before importing the function
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(),
  },
}))

import { testGmailConnection } from "@/lib/admin-onboard"
import nodemailer from "nodemailer"

describe("testGmailConnection", () => {
  it("returns ok when SMTP verify succeeds", async () => {
    const mockVerify = vi.fn().mockResolvedValue(true)
    vi.mocked(nodemailer.createTransport).mockReturnValue({ verify: mockVerify } as any)

    const result = await testGmailConnection("test@gmail.com", "app-password-123")

    expect(result.ok).toBe(true)
    expect(result.message).toContain("test@gmail.com")
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      service: "gmail",
      auth: { user: "test@gmail.com", pass: "app-password-123" },
    })
    expect(mockVerify).toHaveBeenCalled()
  })

  it("throws when SMTP verify fails (bad credentials)", async () => {
    const mockVerify = vi.fn().mockRejectedValue(new Error("Invalid login: 535-5.7.8"))
    vi.mocked(nodemailer.createTransport).mockReturnValue({ verify: mockVerify } as any)

    await expect(testGmailConnection("bad@gmail.com", "wrong-pass")).rejects.toThrow("Invalid login")
  })
})
