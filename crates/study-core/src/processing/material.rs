//! [`MaterialPreferences`]: how material is written, whatever its sources. Unlike the
//! switches of [`ROUTES`](super::ROUTES), which say what runs on each kind of source, these
//! apply to a piece of material as a whole, after its sources are read.

crate::preferences! {
    /// How study material is written.
    #[preferences(scope = "material")]
    #[derive(Copy)]
    pub struct MaterialPreferences {
        /// Whether a fast model drops the passages not worth studying (small talk,
        /// logistics, noise) before the writer reads the rest.
        pub sift: bool = true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sifting_is_on_until_switched_off() -> crate::Result<()> {
        let (_dir, database) = crate::db::Database::temporary()?;
        assert!(MaterialPreferences::load(&database)?.sift);
        MaterialPreferences { sift: false }.save(&database)?;
        assert!(!MaterialPreferences::load(&database)?.sift);
        Ok(())
    }
}
