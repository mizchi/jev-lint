///|
/// A unit of work waiting to run.
pub(all) struct Job {
  id : String
  queued_at : Int
  attempts : Int
}

///|
/// The in-memory queue the worker pulls from.
pub(all) struct Queue {
  jobs : Array[Job]
  mut completed : Int
}

///|
pub suberror QueueError {
  NoSuchJob(String)
}

///|
pub fn try_claim(q : Queue, id : String) -> Job raise QueueError {
  for job in q.jobs {
    if job.id == id {
      return job
    }
  }
  raise NoSuchJob(id)
}

///|
pub fn try_dequeue(q : Queue) -> Job? {
  if q.jobs.length() == 0 {
    return None
  }
  let job = q.jobs[0]
  q.jobs.remove(0) |> ignore
  Some(job)
}

///|
pub fn next_or_default(jobs : Array[Job], fallback : Job) -> Job {
  if jobs.length() == 0 {
    fallback
  } else {
    jobs[0]
  }
}

///|
pub fn oldest_or_default(jobs : Array[Job], now : Int, fallback : Job) -> Job {
  let mut best = 0
  for i in 1..<jobs.length() {
    if jobs[i].queued_at < jobs[best].queued_at {
      best = i
    }
  }
  let oldest = jobs[best]
  if oldest.queued_at > now {
    fallback
  } else {
    oldest
  }
}

///|
pub fn try_drain(q : Queue, max_attempts : Int) -> Int {
  let mut drained = 0
  while q.jobs.length() > 0 {
    let job = q.jobs[0]
    if job.attempts <= max_attempts {
      q.jobs.remove(0) |> ignore
      q.completed = q.completed + 1
      drained = drained + 1
    }
  }
  drained
}

///|
pub fn try_cancel(q : Queue, id : String) -> Bool {
  for i in 0..<q.jobs.length() {
    if q.jobs[i].id == id {
      q.jobs.remove(i) |> ignore
      return true
    }
  }
  false
}

///|
pub fn safe_rate(q : Queue) -> Int {
  let attempted = q.jobs.length() + q.completed
  q.completed * 100 / attempted
}

///|
pub fn rate_or_default(q : Queue, fallback : Int) -> Int {
  let attempted = q.jobs.length() + q.completed
  if attempted == 0 {
    fallback
  } else {
    q.completed * 100 / attempted
  }
}
