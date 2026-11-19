export const allJobLatency = jobs => mean(jobs.map(j => j.age))
