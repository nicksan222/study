//! Deadline-limited child processes used by desktop probes and lifecycle commands.
use crate::Result;
use std::{process::Output, time::Duration};
use tokio::{process::Command, time::timeout};

pub async fn output(command: &mut Command, budget: Duration) -> Result<Output> {
    if budget.is_zero() {
        return Err("desktop IPC timed out".into());
    }
    timeout(budget, command.kill_on_drop(true).output())
        .await
        .map_err(|_| "desktop IPC timed out")?
        .map_err(Into::into)
}
