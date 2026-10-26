//! What the machine is, as reported by the OS. [`probe`] reads it; nothing is timed here.
//!
//! To add a fact, add a documented field to [`SystemInfo`] (unit in its name) and fill it in
//! [`probe`]. Then bump `KEY` in `report.rs`; its `saved_shape_matches_the_key` test fails
//! until you do.

use serde::{Deserialize, Serialize};
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

/// The CPU brand when the OS reports none.
const UNKNOWN_CPU: &str = "unknown";

/// The hardware and OS, as the OS describes them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SystemInfo {
    /// Operating system name, such as `Arch Linux` or `Windows`.
    pub os: String,
    /// Operating system version; `None` when the OS does not say.
    pub os_version: Option<String>,
    /// CPU architecture, such as `x86_64` or `aarch64`.
    pub arch: String,
    /// CPU model name, such as `AMD Ryzen 7 7840U`, or `unknown`.
    pub cpu_brand: String,
    /// Physical cores; `None` when the OS does not expose it (some containers and VMs).
    pub physical_cores: Option<usize>,
    /// Hardware threads; at least 1.
    pub logical_cores: usize,
    /// Installed RAM.
    pub total_memory_bytes: u64,
    /// Memory the OS can hand out now without swapping.
    pub available_memory_bytes: u64,
    /// SIMD instruction sets the inference kernels were compiled to use, such as `avx` or `neon`.
    pub simd: Vec<String>,
}

impl SystemInfo {
    /// The cores work can spread over: physical cores when the OS says, else hardware threads.
    pub fn cores(&self) -> usize {
        self.physical_cores.unwrap_or(self.logical_cores)
    }
}

/// Reads the hardware description. Cheap: no benchmark runs.
pub fn probe() -> SystemInfo {
    let system = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::nothing())
            .with_memory(MemoryRefreshKind::nothing().with_ram()),
    );
    let logical_cores = std::thread::available_parallelism()
        .map_or(1, usize::from)
        .max(system.cpus().len());
    let cpu_brand = system
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_owned())
        .filter(|brand| !brand.is_empty())
        .unwrap_or_else(|| UNKNOWN_CPU.to_owned());
    let simd = instruction_sets();

    SystemInfo {
        os: System::name().unwrap_or_else(|| std::env::consts::OS.to_owned()),
        os_version: System::os_version(),
        arch: std::env::consts::ARCH.to_owned(),
        cpu_brand,
        physical_cores: System::physical_core_count(),
        logical_cores,
        total_memory_bytes: system.total_memory(),
        available_memory_bytes: system.available_memory(),
        simd,
    }
}

/// Names remain stable in saved reports; detection uses the machine's runtime capabilities.
fn instruction_sets() -> Vec<String> {
    let mut sets = Vec::new();
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    {
        if std::arch::is_x86_feature_detected!("avx") {
            sets.push("avx".to_owned());
        }
        if std::arch::is_x86_feature_detected!("f16c") {
            sets.push("f16c".to_owned());
        }
    }
    #[cfg(target_arch = "aarch64")]
    if std::arch::is_aarch64_feature_detected!("neon") {
        sets.push("neon".to_owned());
    }
    #[cfg(all(target_arch = "arm", target_feature = "neon"))]
    sets.push("neon".to_owned());
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    sets.push("simd128".to_owned());
    sets
}
