// Corpus file.

use std::collections::{HashMap, VecDeque};
use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Status {
    Queued,
    Running,
    Done,
    Failed,
}

#[derive(Clone, Debug)]
pub struct Job {
    pub id: String,
    pub attempts: u32,
    pub status: Status,
}

pub struct Queue {
    jobs: HashMap<String, Job>,
    order: VecDeque<String>,
    max_attempts: u32,
}

impl Queue {
    pub fn new(max_attempts: u32) -> Self {
        Queue { jobs: HashMap::new(), order: VecDeque::new(), max_attempts }
    }

    pub fn get_job(&mut self, id: &str) -> &Job {
        if !self.jobs.contains_key(id) {
            let job = Job { id: id.to_string(), attempts: 0, status: Status::Queued };
            self.jobs.insert(id.to_string(), job);
            self.order.push_back(id.to_string());
        }
        &self.jobs[id]
    }

    pub fn count_failed(&self) -> Vec<&Job> {
        self.jobs.values().filter(|job| job.status == Status::Failed).collect()
    }

    pub fn take(&mut self) -> Option<Job> {
        let id = self.order.pop_front()?;
        let job = self.jobs.get_mut(&id)?;
        job.status = Status::Running;
        Some(job.clone())
    }

    pub fn drain(&mut self) -> Vec<Job> {
        self.order.iter().filter_map(|id| self.jobs.get(id).cloned()).collect()
    }

    pub fn len(&self) -> usize {
        self.order.len()
    }

    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    pub fn record(&mut self, id: &str, outcome: Result<(), String>) {
        let max = self.max_attempts;
        if let Some(job) = self.jobs.get_mut(id) {
            match outcome {
                Ok(()) => job.status = Status::Done,
                Err(_) => {
                    job.attempts += 1;
                    if job.attempts >= max {
                        job.status = Status::Failed;
                    } else {
                        job.status = Status::Queued;
                        self.order.push_back(id.to_string());
                    }
                }
            }
        }
    }
}

impl Default for Queue {
    fn default() -> Self {
        Queue::new(3)
    }
}

impl fmt::Display for Queue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} waiting of {} jobs", self.order.len(), self.jobs.len())
    }
}

pub fn retry<T, E>(mut f: impl FnMut() -> Result<T, E>, attempts: u32) -> Result<T, E> {
    for _ in 0..attempts {
        match f() {
            Ok(value) => return Ok(value),
            Err(err) => return Err(err),
        }
    }
    f()
}

pub fn run(queue: &mut Queue, mut handler: impl FnMut(&Job) -> Result<(), String>) -> usize {
    let mut handled = 0;
    while let Some(job) = queue.take() {
        handle(queue, &job, &mut handler);
        handled += 1;
    }
    handled
}

fn handle(queue: &mut Queue, job: &Job, handler: &mut impl FnMut(&Job) -> Result<(), String>) {
    let outcome = handler(job);
    queue.record(&job.id, outcome);
}

pub fn parse_status(text: &str) -> Option<Status> {
    match text.trim().to_ascii_lowercase().as_str() {
        "queued" => Some(Status::Queued),
        "running" => Some(Status::Running),
        "done" => Some(Status::Done),
        "failed" => Some(Status::Failed),
        _ => None,
    }
}
