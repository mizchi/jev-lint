use clap::Args;
use serde::Serialize;

use crate::collect::{collect, Finding};

#[derive(Args)]
pub struct ReportArgs {
    /// Directory to report on.
    #[arg(default_value = ".")]
    pub root: String,
}

#[derive(Serialize)]
pub struct Report {
    pub project: String,
    pub findings: Vec<Finding>,
}

fn render_text(report: &Report) -> String {
    let mut lines = vec![format!("{}: {} finding(s)", report.project, report.findings.len())];
    for f in &report.findings {
        lines.push(format!("  {}:{}  {}  {}", f.file, f.line, f.rule, f.message));
    }
    lines.join("\n")
}

pub fn run(args: &ReportArgs) -> anyhow::Result<i32> {
    let report = collect(&args.root)?;
    println!("{}", render_text(&report));
    Ok(if report.findings.is_empty() { 0 } else { 1 })
}
