//! Whether this computer can run the speech-to-text model, the one heavy model Study runs
//! itself, from its measurements. The thresholds are deliberately conservative, since a local
//! model that makes the app stutter is worse than none.

use crate::stt::ModelCopies;

const GIB: u64 = 1 << 30;
/// Memory kept free for the app itself, the OS, and the user's other programs.
pub const HEADROOM_BYTES: u64 = 2 * GIB;
/// One local Parakeet TDT 0.6B instance (`stt`'s local provider) on 30-second clips.
pub const TRANSCRIBER_INSTANCE_BYTES: u64 = 2 * GIB;
/// Most local transcriber instances the settings allow.
pub const TRANSCRIBER_MAX_INSTANCES: u8 = 4;
/// Below this, Parakeet falls behind real time on long recordings.
pub const TRANSCRIBER_MIN_GFLOPS: f64 = 40.0;

/// What the recommendation needs to know about a computer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Machine {
    pub available_memory_bytes: u64,
    /// Physical cores, or logical ones when the OS does not say.
    pub cores: usize,
    pub matmul_gflops: f64,
}

/// Whether a model suits this computer, and why not when it does not.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Placement {
    Local,
    /// It would still run here, but badly: the settings do not turn it on by themselves.
    NotHere(Reason),
}

/// Why a model does not suit this computer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    NotEnoughMemory,
    TooSlow,
}

/// Where each local capability should run on a computer.
#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    pub transcription: Placement,
    /// Local transcriber instances to load; `None` when transcription does not suit it.
    pub transcription_instances: Option<ModelCopies>,
}

/// Where each local capability should run on `machine`.
pub fn recommend(machine: &Machine) -> Plan {
    let spare = machine
        .available_memory_bytes
        .saturating_sub(HEADROOM_BYTES);
    let transcription = if TRANSCRIBER_INSTANCE_BYTES > spare {
        Placement::NotHere(Reason::NotEnoughMemory)
    } else if machine.matmul_gflops < TRANSCRIBER_MIN_GFLOPS {
        Placement::NotHere(Reason::TooSlow)
    } else {
        Placement::Local
    };
    let transcription_instances = match transcription {
        Placement::Local => {
            let by_memory = (spare / TRANSCRIBER_INSTANCE_BYTES) as usize;
            // Each instance runs best with about four cores of its own.
            let by_cores = (machine.cores.max(1) / 4).max(1);
            let copies = by_memory
                .min(by_cores)
                .min(usize::from(TRANSCRIBER_MAX_INSTANCES));
            u8::try_from(copies).ok().and_then(ModelCopies::new)
        }
        Placement::NotHere(_) => None,
    };
    Plan {
        transcription,
        transcription_instances,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1_000_000_000;

    fn machine(available: u64, cores: usize, gflops: f64) -> Machine {
        Machine {
            available_memory_bytes: available,
            cores,
            matmul_gflops: gflops,
        }
    }

    #[test]
    fn a_capable_machine_transcribes_locally() {
        let plan = recommend(&machine(24 * GB, 12, 500.0));
        assert_eq!(plan.transcription, Placement::Local);
        assert_eq!(plan.transcription_instances, ModelCopies::new(3));
    }

    #[test]
    fn small_memory_transcribes_nothing_locally() {
        let plan = recommend(&machine(2 * GB, 4, 500.0));
        assert_eq!(
            plan.transcription,
            Placement::NotHere(Reason::NotEnoughMemory)
        );
        assert_eq!(plan.transcription_instances, None);
    }

    #[test]
    fn a_slow_cpu_does_not_transcribe_locally() {
        let plan = recommend(&machine(16 * GB, 2, 10.0));
        assert_eq!(plan.transcription, Placement::NotHere(Reason::TooSlow));
    }

    #[test]
    fn transcriber_instances_stay_within_the_settings_limit() {
        let plan = recommend(&machine(256 * GB, 64, 2000.0));
        assert_eq!(
            plan.transcription_instances,
            ModelCopies::new(TRANSCRIBER_MAX_INSTANCES)
        );
    }
}
