use std::fmt;

/// A bounded ring of recent samples.
pub struct Ring {
    samples: Vec<u64>,
    capacity: usize,
}

#[derive(Debug)]
pub struct CapacityError(pub usize);

impl fmt::Display for CapacityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ring is full ({} samples)", self.0)
    }
}

impl std::error::Error for CapacityError {}

impl Ring {
    /// Creates an empty ring.
    ///
    /// # Panics
    ///
    /// Panics if `capacity` is zero.
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "ring capacity must be non-zero");
        Ring { samples: Vec::with_capacity(capacity), capacity }
    }

    /// Returns the most recent sample.
    ///
    /// # Panics
    ///
    /// Panics if the ring is empty.
    pub fn last(&self) -> u64 {
        self.samples.last().copied().unwrap_or(0)
    }

    /// Returns the oldest sample.
    ///
    /// # Panics
    ///
    /// Panics if the ring is empty.
    pub fn first(&self) -> u64 {
        *self.samples.first().expect("ring is empty")
    }

    /// Returns the sample at `index`, oldest first, or `None` past the end.
    /// This function never panics.
    pub fn get(&self, index: usize) -> Option<u64> {
        self.samples.get(index).copied()
    }

    /// Pushes a sample.
    ///
    /// # Errors
    ///
    /// Returns [`CapacityError`] if the ring is full.
    pub fn push(&mut self, sample: u64) -> Result<(), CapacityError> {
        if self.samples.len() == self.capacity {
            self.samples.remove(0);
        }
        self.samples.push(sample);
        Ok(())
    }

    /// Pushes a sample, refusing when the ring is full.
    ///
    /// # Errors
    ///
    /// Returns [`CapacityError`] if the ring is full.
    pub fn try_push(&mut self, sample: u64) -> Result<(), CapacityError> {
        if self.samples.len() == self.capacity {
            return Err(CapacityError(self.capacity));
        }
        self.samples.push(sample);
        Ok(())
    }

    /// Returns the mean of the samples.
    ///
    /// # Panics
    ///
    /// Panics if the ring is empty.
    pub fn mean(&self) -> f64 {
        let n = self.samples.len();
        assert!(n > 0, "mean of an empty ring");
        self.samples.iter().sum::<u64>() as f64 / n as f64
    }

    /// Returns the mean of the samples, or `None` when the ring is empty.
    /// Never panics.
    pub fn mean_opt(&self) -> Option<f64> {
        if self.samples.is_empty() {
            return None;
        }
        Some(self.samples.iter().sum::<u64>() as f64 / self.samples.len() as f64)
    }

    /// Parses a `key=value` line into the ring's label and a sample.
    ///
    /// # Errors
    ///
    /// Returns an error if the value is not an integer. Never panics.
    pub fn parse_line(line: &str) -> Result<(&str, u64), std::num::ParseIntError> {
        let parts: Vec<&str> = line.splitn(2, '=').collect();
        let value = parts[1].trim().parse::<u64>()?;
        Ok((parts[0].trim(), value))
    }

    /// Splits the ring into two halves at `mid`.
    ///
    /// # Panics
    ///
    /// Panics if `mid` is greater than the number of samples.
    pub fn split_at(&self, mid: usize) -> (&[u64], &[u64]) {
        self.samples.split_at(mid)
    }

    /// Drops every sample and returns how many were dropped. Never fails.
    pub fn clear(&mut self) -> usize {
        let n = self.samples.len();
        self.samples.clear();
        n
    }
}
