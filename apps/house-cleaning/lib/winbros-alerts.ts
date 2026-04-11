// Stub — WinBros alerts is window-washing only
export type AlertType = 'high_value' | 'underfill' | 'radius' | 'rain' | 'stacked'
export interface JobAlert { id: string; type: AlertType }
export interface CreateAlertInput { type: AlertType }
export async function createAlert(input: CreateAlertInput): Promise<{ success: boolean; alertId?: string; error?: string }> { return { success: true } }
export async function checkHighValueJob(...args: any[]): Promise<any> { return null }
export async function checkUnderfillDays(...args: any[]): Promise<any[]> { return [] }
export async function checkServiceRadius(...args: any[]): Promise<any> { return null }
export async function checkRainDayAlerts(...args: any[]): Promise<any[]> { return [] }
export async function checkStackedReschedules(...args: any[]): Promise<any[]> { return [] }
export async function getUnacknowledgedAlerts(): Promise<JobAlert[]> { return [] }
export async function acknowledgeAlert(...args: any[]): Promise<void> {}
export async function getAlertsSummary(): Promise<any> { return { total: 0 } }
export async function runDailyAlertChecks(): Promise<any> { return { alerts: [] } }
