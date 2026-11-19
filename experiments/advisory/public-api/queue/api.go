package queue

func Enqueue(job string) error { panic("fixture") }
func EnqueueAlias(job string) error { return Enqueue(job) }
func EnqueueAliasV2(job string) error { return Enqueue(job) }
var MutableInternalPendingHeap []string
func ResetInternalHeapForTests() {}
