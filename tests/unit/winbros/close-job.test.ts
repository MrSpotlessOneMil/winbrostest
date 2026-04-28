/**
 * Close Job Automation — Unit Tests
 */

import { describe, it, expect } from 'vitest'
import {
  buildReceiptMessage,
  buildReviewMessage,
  buildThankYouMessage,
} from '@/apps/window-washing/lib/close-job'

describe('buildReceiptMessage', () => {
  it('includes all services with prices', () => {
    const msg = buildReceiptMessage({
      id: 1,
      job_id: 1,
      tenant_id: 'test',
      visit_date: '2026-04-12',
      payment_type: 'card',
      payment_amount: 450,
      tip_amount: 0,
      line_items: [
        { service_name: 'Interior Windows', price: 200, revenue_type: 'original_quote' },
        { service_name: 'Exterior Windows', price: 250, revenue_type: 'original_quote' },
      ],
      customer: { first_name: 'John', last_name: 'Smith', phone_number: '+1234567890' },
    })

    expect(msg).toContain('John Smith')
    expect(msg).toContain('Interior Windows: $200.00')
    expect(msg).toContain('Exterior Windows: $250.00')
    expect(msg).toContain('Total: $450.00')
    expect(msg).toContain('Credit Card')
  })

  it('shows cash payment method', () => {
    const msg = buildReceiptMessage({
      id: 1, job_id: 1, tenant_id: 'test', visit_date: '2026-04-12',
      payment_type: 'cash', payment_amount: 300, tip_amount: 50,
      line_items: [{ service_name: 'Windows', price: 300, revenue_type: 'original_quote' }],
      customer: { first_name: 'Jane', last_name: null, phone_number: '+1234567890' },
    })

    expect(msg).toContain('Cash')
    expect(msg).toContain('Tip: $50.00')
  })

  it('handles no-name customer', () => {
    const msg = buildReceiptMessage({
      id: 1, job_id: 1, tenant_id: 'test', visit_date: '2026-04-12',
      payment_type: 'check', payment_amount: 200, tip_amount: 0,
      line_items: [{ service_name: 'Windows', price: 200, revenue_type: 'original_quote' }],
      customer: { first_name: null, last_name: null, phone_number: '+1234567890' },
    })

    expect(msg).toContain('Valued Customer')
  })

  it('includes upsell line items in receipt', () => {
    const msg = buildReceiptMessage({
      id: 1, job_id: 1, tenant_id: 'test', visit_date: '2026-04-12',
      payment_type: 'card', payment_amount: 500, tip_amount: 0,
      line_items: [
        { service_name: 'Windows', price: 350, revenue_type: 'original_quote' },
        { service_name: 'Screen Cleaning', price: 50, revenue_type: 'technician_upsell' },
        { service_name: 'Gutter Clean', price: 100, revenue_type: 'technician_upsell' },
      ],
      customer: { first_name: 'Bob', last_name: null, phone_number: '+1234567890' },
    })

    expect(msg).toContain('Screen Cleaning: $50.00')
    expect(msg).toContain('Gutter Clean: $100.00')
    expect(msg).toContain('Total: $500.00')
  })
})

describe('buildReviewMessage', () => {
  it('includes customer name and review link', () => {
    const msg = buildReviewMessage('John', 'https://g.page/winbros/review')

    expect(msg).toContain('John')
    expect(msg).toContain('https://g.page/winbros/review')
    expect(msg).toContain('Google review')
  })
})

describe('buildThankYouMessage', () => {
  it('includes customer name and tip mention', () => {
    const msg = buildThankYouMessage('Sarah')

    expect(msg).toContain('Sarah')
    expect(msg).toContain('tips')
    expect(msg).toContain('appreciated')
  })

  it('Phase G: admin-edited body is rendered with substitutions', () => {
    const customBody = 'Heyo {{customer_name}} — drop us a tip if you liked the work!'
    const msg = buildThankYouMessage('Lucy', customBody)
    expect(msg).toBe('Heyo Lucy — drop us a tip if you liked the work!')
  })
})

describe('buildReviewMessage Phase G template override', () => {
  it('admin-edited body controls the wording, link substitutes in', () => {
    const customBody = 'Quick favor {{customer_name}}? Drop a 5-star: {{review_link}}'
    const msg = buildReviewMessage('Mark', 'https://g.page/wb', customBody)
    expect(msg).toBe('Quick favor Mark? Drop a 5-star: https://g.page/wb')
  })
})

describe('buildReceiptMessage Phase G template override', () => {
  it('admin-edited receipt body keeps services + total via placeholders', () => {
    const customBody = '{{customer_name}} — paid {{total}} ({{payment_method}}). Bye!'
    const msg = buildReceiptMessage(
      {
        id: 1, job_id: 1, tenant_id: 'test', visit_date: '2026-04-12',
        payment_type: 'cash', payment_amount: 250, tip_amount: 0,
        line_items: [{ service_name: 'Windows', price: 250, revenue_type: 'original_quote' }],
        customer: { first_name: 'Joel', last_name: null, phone_number: '+1' },
      },
      customBody,
    )
    expect(msg).toBe('Joel — paid $250.00 (Cash). Bye!')
  })
})
