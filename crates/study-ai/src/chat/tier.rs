//! [`Tier`]: how capable a model an agent needs, and [`PerTier`], one value for each.

/// How capable (and costly) a model an agent needs. Each agent picks the smallest tier that
/// does its job well; the user decides which provider and model serve each tier.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum Tier {
    /// Short, simple, frequent work, such as naming a session. Fast and nearly free.
    Tiny,
    /// Everyday reasoning over a page or two, such as summaries and explanations.
    Medium,
    /// Hard, long, or multi-step work where quality matters more than cost.
    Smart,
}

impl Tier {
    /// Every tier, least capable first.
    pub const ALL: [Self; 3] = [Self::Tiny, Self::Medium, Self::Smart];

    /// This tier's one of three per-tier values, for types that keep a named field per
    /// tier.
    pub fn pick<T>(self, tiny: T, medium: T, smart: T) -> T {
        match self {
            Self::Tiny => tiny,
            Self::Medium => medium,
            Self::Smart => smart,
        }
    }
}

/// One value for each [`Tier`].
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct PerTier<T> {
    pub tiny: T,
    pub medium: T,
    pub smart: T,
}

impl<T> PerTier<T> {
    /// Each tier's value from `value`.
    pub fn from_fn(mut value: impl FnMut(Tier) -> T) -> Self {
        Self {
            tiny: value(Tier::Tiny),
            medium: value(Tier::Medium),
            smart: value(Tier::Smart),
        }
    }

    /// The value for `tier`.
    pub fn get(&self, tier: Tier) -> &T {
        tier.pick(&self.tiny, &self.medium, &self.smart)
    }

    /// Each value turned into another, stopping at the first failure.
    pub fn try_map<U, E>(self, mut f: impl FnMut(T) -> Result<U, E>) -> Result<PerTier<U>, E> {
        Ok(PerTier {
            tiny: f(self.tiny)?,
            medium: f(self.medium)?,
            smart: f(self.smart)?,
        })
    }
}
