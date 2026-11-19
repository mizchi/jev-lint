export const search = q => shards.flatMap(s => s.search(q))
