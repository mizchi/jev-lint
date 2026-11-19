export const allJobLatency = jobs => mean(jobs.map(j => j.age))
export const completedJobLatency = jobs => mean(jobs.filter(j => j.done).map(j => j.age))
// SPDX-License-Identifier: MIT
