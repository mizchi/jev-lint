///|
pub(all) struct Job {
  id : String
}

///|
pub fn push_job(jobs : Array[Job], job : Job) -> Array[Job] {
  let out = jobs.copy()
  out.push(job)
  out
}

///|
pub fn pop_job(jobs : Array[Job]) -> Job? {
  if jobs.length() == 0 {
    None
  } else {
    Some(jobs[0])
  }
}

///|
pub fn peek_job(jobs : Array[Job]) -> Job? {
  pop_job(jobs)
}

///|
pub fn count_jobs(jobs : Array[Job]) -> Int {
  jobs.length()
}
