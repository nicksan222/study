//! The [`Report`] of one run, and where it is saved: the `benchmark` preferences scope.

use std::time::Instant;

use serde::{Deserialize, Serialize};
use study_core::db::{Database, Store};
use study_core::preferences::encode;
use study_core::{Context as _, Result};

use super::compute::{self, ComputeConfig, ComputeScore};
use super::system::{self, SystemInfo};
use crate::catalog::{self, Machine, Plan};

/// The preferences scope the report is saved under.
const SCOPE: &str = "benchmark";
/// The key of the saved report. Bump its version whenever [`Report`]'s shape changes (a field
/// added, removed or renamed in [`Report`], [`SystemInfo`] or [`ComputeScore`]), or a kernel
/// changes enough that old reports should be measured again. A new key makes every machine
/// measure itself again on its next start. `saved_shape_matches_the_key` below pins the
/// shape to this key, so a shape change without a bump fails the tests.
const KEY: &str = "report.v1";

/// Everything one run measured about this machine.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Report {
    /// What the OS says the machine is.
    pub system: SystemInfo,
    /// What the kernels measured it can do.
    pub compute: ComputeScore,
    /// How long the whole run took, in seconds.
    pub elapsed_secs: f64,
}

impl Report {
    /// The saved report, if this machine has been measured.
    pub fn saved(database: &Database) -> Result<Option<Self>> {
        database.load_preferences(SCOPE)?.get(KEY)
    }

    /// Saves this report, replacing any earlier one.
    pub fn save(&self, database: &Database) -> Result<()> {
        database.save_preferences(SCOPE, &[(KEY, encode(self)?)])
    }

    /// Measures this machine again and replaces the saved report. Blocks for a few seconds.
    pub fn measure_and_save(database: &Database) -> Result<Self> {
        let report = run(&ComputeConfig::default())?;
        report.save(database).context("cannot save the report")?;
        Ok(report)
    }

    /// Where each model should run on the measured machine, by [`catalog::recommend`].
    pub fn plan(&self) -> Plan {
        catalog::recommend(&Machine {
            available_memory_bytes: self.system.available_memory_bytes,
            cores: self.system.cores(),
            matmul_gflops: self.compute.matmul_gflops,
        })
    }
}

/// Probes the system and runs the kernels. Blocks for a few seconds; call it off the UI thread.
pub fn run(config: &ComputeConfig) -> Result<Report> {
    let started = Instant::now();
    let system = system::probe();
    let compute = compute::measure(config).context("the compute kernels failed")?;
    Ok(Report {
        system,
        compute,
        elapsed_secs: started.elapsed().as_secs_f64(),
    })
}

/// What [`measure_once`] found: the report, and whether it was measured just now.
#[derive(Clone, Debug, PartialEq)]
pub struct Measurement {
    pub report: Report,
    /// `true` when there was no saved report, so this is the first measurement.
    pub first: bool,
}

/// The saved report, or a fresh run that is then saved, in one read of the store.
pub async fn measure_once(store: Store) -> Result<Measurement> {
    store
        .run(|database| {
            if let Some(report) = Report::saved(database).context("cannot read the saved report")? {
                return Ok(Measurement {
                    report,
                    first: false,
                });
            }
            Ok(Measurement {
                report: Report::measure_and_save(database)?,
                first: true,
            })
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every field path of `value`, such as `system.os`, in serialization order.
    fn field_paths(value: &serde_json::Value, prefix: &str, paths: &mut Vec<String>) {
        if let serde_json::Value::Object(fields) = value {
            for (name, field) in fields {
                let path = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}.{name}")
                };
                if field.is_object() {
                    field_paths(field, &path, paths);
                } else {
                    paths.push(path);
                }
            }
        }
    }

    /// Fails when the saved shape changes without a new [`KEY`]. When it does: bump `KEY`,
    /// then update both the key and the field list here.
    #[test]
    fn saved_shape_matches_the_key() {
        // Adding a field breaks this literal first: fill it in, then fix the list below.
        let report = Report {
            system: SystemInfo {
                os: String::new(),
                os_version: None,
                arch: String::new(),
                cpu_brand: String::new(),
                physical_cores: None,
                logical_cores: 1,
                total_memory_bytes: 0,
                available_memory_bytes: 0,
                simd: Vec::new(),
            },
            compute: ComputeScore {
                matmul_gflops: 0.0,
                memory_bandwidth_gbps: 0.0,
            },
            elapsed_secs: 0.0,
        };
        let mut paths = Vec::new();
        field_paths(&serde_json::to_value(&report).unwrap(), "", &mut paths);
        paths.sort();
        assert_eq!(
            (KEY, paths.as_slice()),
            (
                "report.v1",
                [
                    "compute.matmul_gflops",
                    "compute.memory_bandwidth_gbps",
                    "elapsed_secs",
                    "system.arch",
                    "system.available_memory_bytes",
                    "system.cpu_brand",
                    "system.logical_cores",
                    "system.os",
                    "system.os_version",
                    "system.physical_cores",
                    "system.simd",
                    "system.total_memory_bytes",
                ]
                .map(String::from)
                .as_slice(),
            ),
            "the saved report's shape changed: bump KEY, then update this test",
        );
    }
}
