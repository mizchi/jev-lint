export const available = runs => runs.filter(r => r.ok).length / runs.length >= .99
