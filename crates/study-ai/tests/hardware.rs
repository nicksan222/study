//! Real measurements of whatever machine runs the tests. Values differ between machines, so
//! only the shape is checked: every field present, finite, and plausible.

use std::time::Duration;

use study_ai::hardware::compute::{self, ComputeConfig};
use study_ai::hardware::{Report, run, system};

fn quick_compute() -> ComputeConfig {
    ComputeConfig {
        matmul_size: 128,
        memory_mib: 8,
        min_duration: Duration::from_millis(50),
    }
}

#[test]
fn probe_describes_the_machine() {
    let info = system::probe();
    assert!(!info.os.is_empty());
    assert!(!info.arch.is_empty());
    assert!(!info.cpu_brand.is_empty());
    assert!(info.logical_cores >= 1);
    if let Some(physical) = info.physical_cores {
        assert!((1..=info.logical_cores).contains(&physical));
    }
    assert!(info.total_memory_bytes > 0);
    assert!(info.available_memory_bytes <= info.total_memory_bytes);
}

#[test]
fn kernels_produce_finite_positive_scores() {
    let score = compute::measure(&quick_compute()).expect("kernels run");
    // Every field of the score, so a new kernel is checked without editing this test.
    let json = serde_json::to_value(&score).unwrap();
    let fields = json.as_object().expect("the score is an object");
    assert!(!fields.is_empty());
    for (name, value) in fields {
        let value = value.as_f64().unwrap_or(f64::NAN);
        assert!(value.is_finite() && value > 0.0, "{name} in {score:?}");
    }
}

#[test]
fn report_has_the_expected_json_shape() {
    let report = run(&quick_compute()).expect("benchmark runs");
    assert!(report.elapsed_secs > 0.0);

    let json = serde_json::to_value(&report).unwrap();
    for key in ["system", "compute", "elapsed_secs"] {
        assert!(json.get(key).is_some(), "missing {key} in {json}");
    }
    for key in [
        "logical_cores",
        "total_memory_bytes",
        "available_memory_bytes",
    ] {
        assert!(json["system"][key].is_u64(), "system.{key} in {json}");
    }
    for (key, value) in json["compute"].as_object().expect("compute is an object") {
        assert!(value.is_f64(), "compute.{key} in {json}");
    }
    // Round-trips, so the app can store and reload a report.
    let back: Report = serde_json::from_value(json).unwrap();
    assert_eq!(back, report);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_measured_machine_is_not_measured_again() {
    let (_dir, store) = study_core::db::Store::temporary().unwrap();
    assert_eq!(store.with(Report::saved).unwrap(), None);

    let report = run(&quick_compute()).unwrap();
    store.with(|database| report.save(database)).unwrap();
    // Floats may lose their last digit in storage, so compare two reads of what was stored.
    let stored = store.with(Report::saved).unwrap().unwrap();
    assert_eq!(stored.system, report.system);
    let found = study_ai::hardware::measure_once(store).await.unwrap();
    assert_eq!(found.report, stored);
    assert!(!found.first, "a saved report is not a first measurement");
}
