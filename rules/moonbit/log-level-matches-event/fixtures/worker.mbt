///|
pub(all) struct Logger {
  name : String
}

///|
pub(all) suberror JobError String

///|
pub fn run_job(id : String, attempt : Int) -> Unit raise {
  @log.debug("starting job \{id}")
  if attempt > 3 {
    @log.info("giving up on \{id} after \{attempt} attempts")
    raise JobError("too many attempts")
  }
  @log.info("job \{id} finished")
}

///|
pub fn connect(host : String, retries : Int) -> Unit raise {
  if retries == 0 {
    @log.error("could not reach \{host}, giving up")
    raise JobError("unreachable")
  }
  if retries < 3 {
    @log.warn("\{host} took \{retries} tries")
  }
  @log.debug("connected to \{host}")
}

///|
pub fn load_cache(path : String) -> Int {
  @log.error("reading cache from \{path}")
  0
}

///|
pub fn drop_record(id : String) -> Unit {
  @log.debug("dropped every record for tenant \{id}; the data is gone")
}

///|
pub fn shutdown(pending : Int) -> Unit {
  if pending > 0 {
    @log.warn("shutting down with \{pending} jobs still queued")
  }
  @log.info("shutdown complete")
}

///|
pub fn parse_line(line : String) -> Int {
  if line.is_empty() {
    @log.debug("skipping an empty line")
    return 0
  }
  line.length()
}

///|
pub fn flush(logger : Logger, count : Int) -> Unit {
  logger.info("flushed \{count} records")
}

///|
pub fn corrupt(logger : Logger, path : String) -> Unit {
  logger.debug("the file at \{path} is corrupt and was discarded")
}
