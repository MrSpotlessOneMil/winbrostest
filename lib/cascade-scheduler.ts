// Local Job type for cascade scheduling
// This represents the minimal job interface needed for cascade calculations
export interface CascadeJob {
  id: string;
  date: string;
  scheduledAt?: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  client: string;
  cleaningTeam: string[];
  hours?: number;
}

export type CascadeChange = {
  job: CascadeJob;
  originalStart: Date;
  originalDuration: number;
  newStart: Date;
  newDuration: number;
  deltaMinutes: number;
  reason: string;
};

export type CascadeConflict = {
  job: CascadeJob;
  conflictingJob: CascadeJob;
  reason: string;
  severity: "warning" | "error";
};

export type CascadeResult = {
  changes: CascadeChange[];
  conflicts: CascadeConflict[];
  affectedClients: string[];
  summary: string;
};

function parseJobDate(job: CascadeJob): Date {
  const value = job.scheduledAt || job.date;
  if (!value) return new Date();

  const raw = String(value);
  if (raw.includes("T")) {
    const datePart = raw.split("T")[0];
    if (raw.endsWith("Z") && raw.includes("00:00")) {
      return new Date(`${datePart}T09:00:00`);
    }
    return new Date(raw);
  }
  if (raw.includes(" ")) {
    return new Date(raw.replace(" ", "T"));
  }
  return new Date(`${raw}T09:00:00`);
}

function getDurationHours(job: CascadeJob): number {
  return job.hours ? Number(job.hours) : 3;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Calculate new duration when team size changes
 * Formula: new_duration = original_duration × (original_team_size / new_team_size)
 */
export function calculateDurationForTeamChange(
  originalDuration: number,
  originalTeamSize: number,
  newTeamSize: number
): number {
  if (newTeamSize === 0) return originalDuration;
  return Math.round((originalDuration * originalTeamSize / newTeamSize) * 2) / 2; // Round to nearest 0.5
}

/**
 * Calculate cascading schedule changes for all jobs on the same day
 *
 * Rules:
 * 1. Only affects jobs AFTER the modified job (by start time)
 * 2. Only affects jobs on the SAME calendar day
 * 3. Does NOT modify completed jobs
 * 4. Shifts all subsequent jobs by the same delta
 */
export function calculateCascade(
  modifiedJob: CascadeJob,
  newStartTime: Date,
  newDuration: number,
  allJobs: CascadeJob[]
): CascadeResult {
  const changes: CascadeChange[] = [];
  const conflicts: CascadeConflict[] = [];
  const affectedClients = new Set<string>();

  const modifiedStart = parseJobDate(modifiedJob);
  const modifiedDateKey = toDateKey(modifiedStart);
  const modifiedEnd = new Date(modifiedStart.getTime() + getDurationHours(modifiedJob) * 60 * 60 * 1000);

  const newEnd = new Date(newStartTime.getTime() + newDuration * 60 * 60 * 1000);
  const deltaMinutes = Math.round((newEnd.getTime() - modifiedEnd.getTime()) / 60000);

  // Add the primary change
  changes.push({
    job: modifiedJob,
    originalStart: modifiedStart,
    originalDuration: getDurationHours(modifiedJob),
    newStart: newStartTime,
    newDuration,
    deltaMinutes: Math.round((newStartTime.getTime() - modifiedStart.getTime()) / 60000),
    reason: "Primary change"
  });

  if (modifiedJob.client) {
    affectedClients.add(modifiedJob.client);
  }

  // Find all jobs on the same day that start after the modified job
  const sameDayJobs = allJobs
    .filter(j => {
      if (j.id === modifiedJob.id) return false;
      if (j.status === "completed") return false; // Don't cascade completed jobs

      const jobStart = parseJobDate(j);
      const jobDateKey = toDateKey(jobStart);

      return jobDateKey === modifiedDateKey && jobStart >= modifiedEnd;
    })
    .sort((a, b) => parseJobDate(a).getTime() - parseJobDate(b).getTime());

  // Cascade the time shift
  let cumulativeDelta = deltaMinutes;

  for (const job of sameDayJobs) {
    const jobStart = parseJobDate(job);
    const jobDuration = getDurationHours(job);
    const newJobStart = new Date(jobStart.getTime() + cumulativeDelta * 60000);

    changes.push({
      job,
      originalStart: jobStart,
      originalDuration: jobDuration,
      newStart: newJobStart,
      newDuration: jobDuration, // Duration doesn't change for cascaded jobs
      deltaMinutes: cumulativeDelta,
      reason: `Cascaded from ${modifiedJob.client || 'previous job'}`
    });

    if (job.client) {
      affectedClients.add(job.client);
    }

    // Check for conflicts
    const newJobEnd = new Date(newJobStart.getTime() + jobDuration * 60 * 60 * 1000);

    // Check if pushed past business hours (7 AM - 7 PM)
    const endHour = newJobEnd.getHours() + newJobEnd.getMinutes() / 60;
    if (endHour > 19) {
      conflicts.push({
        job,
        conflictingJob: modifiedJob,
        reason: `Job pushed past business hours (ends at ${newJobEnd.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })})`,
        severity: "error"
      });
    }

    // Check for team member conflicts with the modified job
    const hasTeamOverlap = job.cleaningTeam.some(member =>
      modifiedJob.cleaningTeam.includes(member)
    );

    if (hasTeamOverlap) {
      const modifiedJobEnd = newEnd;
      const overlap = newJobStart < modifiedJobEnd;

      if (overlap) {
        const conflictingMembers = job.cleaningTeam.filter(m =>
          modifiedJob.cleaningTeam.includes(m)
        );

        conflicts.push({
          job,
          conflictingJob: modifiedJob,
          reason: `Team member(s) ${conflictingMembers.join(", ")} cannot be in two places at once`,
          severity: "error"
        });
      }
    }
  }

  // Generate summary
  const summary = generateCascadeSummary(changes, conflicts);

  return {
    changes,
    conflicts,
    affectedClients: Array.from(affectedClients),
    summary
  };
}

function generateCascadeSummary(changes: CascadeChange[], conflicts: CascadeConflict[]): string {
  if (changes.length === 0) {
    return "No changes required.";
  }

  const primary = changes[0];
  const cascaded = changes.slice(1);

  let summary = `${primary.job.client || 'Job'}: `;

  const timeDelta = primary.deltaMinutes;
  const durationDelta = primary.newDuration - primary.originalDuration;

  if (timeDelta !== 0 && durationDelta !== 0) {
    summary += `moved ${timeDelta > 0 ? 'forward' : 'backward'} by ${Math.abs(timeDelta)} min and duration changed from ${primary.originalDuration}h to ${primary.newDuration}h`;
  } else if (timeDelta !== 0) {
    summary += `moved ${timeDelta > 0 ? 'forward' : 'backward'} by ${Math.abs(timeDelta)} min`;
  } else if (durationDelta !== 0) {
    summary += `duration changed from ${primary.originalDuration}h to ${primary.newDuration}h`;
  }

  if (cascaded.length > 0) {
    summary += `\n\nAffected ${cascaded.length} subsequent job${cascaded.length > 1 ? 's' : ''}:`;
    cascaded.forEach(change => {
      summary += `\n• ${change.job.client || 'Job'}: ${Math.abs(change.deltaMinutes)} min ${change.deltaMinutes > 0 ? 'later' : 'earlier'}`;
    });
  }

  if (conflicts.length > 0) {
    summary += `\n\n⚠️ ${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''} detected:`;
    conflicts.forEach(conflict => {
      summary += `\n• ${conflict.reason}`;
    });
  }

  return summary;
}

/**
 * Generate client notification message
 */
export function generateClientNotification(
  client: string,
  change: CascadeChange,
  reason: string
): string {
  const newTime = change.newStart.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });

  if (reason.includes("team size") || reason.includes("cleaner")) {
    return `Hi ${client}, we need to adjust your appointment time. Due to a staffing change, your cleaning will now arrive at ${newTime}. The same great service is guaranteed. Please reply if you need a different time.`;
  }

  if (change.deltaMinutes > 0) {
    return `Hi ${client}, your appointment has been moved slightly later to ${newTime} due to a schedule adjustment. Please reply if you need a different time.`;
  } else {
    return `Hi ${client}, good news! We're able to arrive earlier at ${newTime}. Please reply if the original time works better for you.`;
  }
}
