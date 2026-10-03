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
    // The instruction sets candle can use, by the name saved in the report.
    let simd = [
        ("avx", candle_core::utils::with_avx()),
        ("f16c", candle_core::utils::with_f16c()),
        ("neon", candle_core::utils::with_neon()),
        ("simd128", candle_core::utils::with_simd128()),
    ]
    .into_iter()
    .filter(|(_, enabled)| *enabled)
    .map(|(name, _)| name.to_owned())
    .collect();

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
