use std::collections::HashMap;
use std::fs;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
    pub name: String,
    pub port: u16,
    pub workers: Option<usize>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("config file {0} not found")]
    Missing(String),
    #[error("config key {0} is not set")]
    Unset(String),
    #[error("invalid config: {0}")]
    Parse(#[from] toml::de::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// Reads and parses the config file at `path`.
///
/// # Errors
///
/// Returns an error if the file cannot be read or is not valid TOML.
pub fn load(path: &Path) -> Result<Config> {
    let text = fs::read_to_string(path)
        .with_context(|| format!("reading {}", path.display()))?;
    let config: Config = toml::from_str(&text)
        .with_context(|| format!("parsing {}", path.display()))?;
    Ok(config)
}

/// Reads and parses the config file at `path`.
///
/// # Errors
///
/// Returns [`ConfigError::Missing`] if the file does not exist and
/// [`ConfigError::Parse`] if it is not valid TOML.
pub fn load_strict(path: &Path) -> Result<Config, ConfigError> {
    let text = fs::read_to_string(path)
        .unwrap_or_else(|_| panic!("config file {} not found", path.display()));
    Ok(toml::from_str(&text)?)
}

/// Loads the config, falling back to defaults when the file is absent.
///
/// # Errors
///
/// Returns an error if the file exists but cannot be read or parsed.
pub fn load_or_default(path: &Path) -> Result<Config> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(toml::from_str(&text)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config {
            name: "app".to_string(),
            port: 8080,
            workers: None,
            env: HashMap::new(),
        }),
        Err(e) => Err(e.into()),
    }
}

/// Returns the value of an environment override.
///
/// # Errors
///
/// Returns [`ConfigError::Unset`] if `key` is not present in `env`.
pub fn env_value(config: &Config, key: &str) -> Result<&str, ConfigError> {
    config
        .env
        .get(key)
        .map(String::as_str)
        .ok_or_else(|| ConfigError::Missing(key.to_string()))
}

/// Parses the workers setting.
///
/// # Errors
///
/// Returns an error if `text` is not a positive integer.
pub fn parse_workers(text: &str) -> Result<usize> {
    let n: usize = text.trim().parse().context("workers must be an integer")?;
    if n == 0 {
        bail!("workers must be positive");
    }
    Ok(n)
}

/// Validates a loaded config.
///
/// # Errors
///
/// Returns an error if `port` is zero.
pub fn validate(config: &Config) -> Result<()> {
    if config.port == 0 {
        bail!("port must be non-zero");
    }
    if config.name.is_empty() {
        bail!("name must not be empty");
    }
    Ok(())
}

/// Writes the config back as TOML.
///
/// # Errors
///
/// Returns an error if the file cannot be written.
pub fn save(config: &Config, path: &Path) -> Result<()> {
    let text = toml::to_string_pretty(&SavedConfig::from(config))
        .expect("config is always serialisable");
    fs::write(path, text).with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

#[derive(serde::Serialize)]
struct SavedConfig<'a> {
    name: &'a str,
    port: u16,
    workers: Option<usize>,
}

impl<'a> From<&'a Config> for SavedConfig<'a> {
    fn from(c: &'a Config) -> Self {
        SavedConfig { name: &c.name, port: c.port, workers: c.workers }
    }
}
