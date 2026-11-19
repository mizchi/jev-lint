export const available = runs => { runs = runs.filter(r => !r.timedOut); return runs.filter(r => r.ok).length / runs.length >= .99 }
