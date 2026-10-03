//! Sizes, memory, speeds, percentages and measured seconds. Decimals use the locale's
//! separator.

use crate::Locale;

/// A decimal with a fixed number of places, using the locale's decimal separator.
fn decimal(locale: Locale, value: f64, places: usize) -> String {
    let formatted = format!("{value:.places$}");
    match locale {
        Locale::English => formatted,
        Locale::Italian => formatted.replace('.', ","),
    }
}

fn gibibytes(bytes: u64) -> f64 {
    bytes as f64 / (1u64 << 30) as f64
}

/// A zoom level, such as `125%`; the same in every locale.
pub fn zoom_percentage(percent: u16) -> String {
    format!("{percent}%")
}

/// A file's size, compact, such as `512 B`, `1.5 KiB` or `12.0 MiB`. The unit is picked
/// after rounding, so a size just short of a mebibyte reads `1.0 MiB`, not `1024.0 KiB`.
pub fn media_size(locale: Locale, bytes: i64) -> String {
    const UNITS: [&str; 3] = ["KiB", "MiB", "GiB"];
    let bytes = bytes.max(0);
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let rounded = |power: usize| (bytes as f64 / 1024f64.powi(power as i32) * 10.).round() / 10.;
    let mut power = 1;
    while power < UNITS.len() && rounded(power) >= 1024. {
        power += 1;
    }
    format!(
        "{} {}",
        decimal(locale, rounded(power), 1),
        UNITS[power - 1]
    )
}

/// A computer's memory, rounded to whole gibibytes, such as `32 GiB`.
pub fn memory_size(bytes: u64) -> String {
    format!("{} GiB", gibibytes(bytes).round())
}

/// An amount of memory to one decimal place, such as `15.6 GiB`.
pub fn memory_gib(locale: Locale, bytes: u64) -> String {
    format!("{} GiB", decimal(locale, gibibytes(bytes), 1))
}

/// How much memory is free right now, such as `7.2 GiB free`.
pub fn memory_free(locale: Locale, bytes: u64) -> String {
    let amount = memory_gib(locale, bytes);
    match locale {
        Locale::English => format!("{amount} free"),
        Locale::Italian => format!("{amount} liberi"),
    }
}

/// Measured matrix-multiply throughput as a number and its unit, such as `412` and `GFLOPS`.
pub fn gflops(value: f64) -> (String, String) {
    (format!("{value:.0}"), "GFLOPS".to_owned())
}

/// Measured memory bandwidth as a number and its unit, such as `38.4` and `GB/s`.
pub fn bandwidth(locale: Locale, gigabytes_per_second: f64) -> (String, String) {
    (decimal(locale, gigabytes_per_second, 1), "GB/s".to_owned())
}

/// How long a measurement took, to a tenth of a second, such as `4.2 s`.
pub fn seconds_taken(locale: Locale, seconds: f64) -> String {
    format!("{} s", decimal(locale, seconds, 1))
}

/// A value with the space it takes, such as `19 (1.0 MiB)`.
pub fn with_size(value: impl std::fmt::Display, size: &str) -> String {
    format!("{value} ({size})")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_use_the_locale_decimal_separator() {
        assert_eq!(media_size(Locale::English, 512), "512 B");
        assert_eq!(media_size(Locale::English, 1536), "1.5 KiB");
        assert_eq!(media_size(Locale::Italian, 3 * 1024 * 1024 / 2), "1,5 MiB");
        assert_eq!(
            media_size(Locale::English, 2 * 1024 * 1024 * 1024),
            "2.0 GiB"
        );
        assert_eq!(seconds_taken(Locale::Italian, 4.2), "4,2 s");
    }

    #[test]
    fn a_size_takes_the_unit_its_rounded_value_reads_in() {
        const KIB: i64 = 1024;
        const MIB: i64 = 1024 * KIB;
        const GIB: i64 = 1024 * MIB;
        let size = |bytes| media_size(Locale::English, bytes);
        assert_eq!(size(-1), "0 B");
        assert_eq!(size(KIB - 1), "1023 B");
        assert_eq!(size(KIB), "1.0 KiB");
        // 1023.95 KiB and up round to 1024.0 KiB, which is 1.0 MiB.
        assert_eq!(size(1_048_524), "1023.9 KiB");
        assert_eq!(size(1_048_525), "1.0 MiB");
        assert_eq!(size(MIB - 1), "1.0 MiB");
        assert_eq!(size(MIB), "1.0 MiB");
        assert_eq!(size(1_073_689_395), "1023.9 MiB");
        assert_eq!(size(1_073_689_396), "1.0 GiB");
        assert_eq!(size(GIB - 1), "1.0 GiB");
        assert_eq!(size(2048 * GIB), "2048.0 GiB");
        assert_eq!(media_size(Locale::Italian, MIB - 1), "1,0 MiB");
    }
}
