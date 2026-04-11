// Stub — rain-day is window-washing only
export interface RainDayCheckResult { affected: boolean }
export interface RescheduleResult { success: boolean }
export async function checkAndHandleRainDay(...args: any[]): Promise<RainDayCheckResult> { return { affected: false } }
export async function rescheduleAllJobs(...args: any[]): Promise<RescheduleResult> { return { success: true } }
export async function getAffectedJobs(...args: any[]): Promise<any[]> { return [] }
export function getCandidateDates(...args: any[]): string[] { return [] }
export async function getJobCountsByDate(...args: any[]): Promise<any> { return {} }
