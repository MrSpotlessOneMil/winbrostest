// Stub — route optimization is window-washing only
export interface TeamForRouting { id: string }
export interface JobForRouting { id: string }
export interface OptimizedStop { jobId: string }
export interface OptimizedRoute { stops: OptimizedStop[] }
export interface OptimizationResult { routes: OptimizedRoute[] }
export async function optimizeRoutesForDate(...args: any[]): Promise<OptimizationResult> { return { routes: [] } }
export async function optimizeRoutesIncremental(...args: any[]): Promise<OptimizationResult> { return { routes: [] } }
export async function loadTeamsWithLocations(...args: any[]): Promise<any> { return { teams: [] } }
export async function loadJobsForDate(...args: any[]): Promise<JobForRouting[]> { return [] }
