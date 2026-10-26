//! [`PerChoice`]: a value for each variant of a choice.

use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::preferences::{Choice, Invalid, Preference};

/// One value for each variant of a [`Choice`], such as a setting per provider, so
/// switching back and forth keeps what was set for each.
///
/// Every variant has a value; ones never set read as `V::default()`, and only values that
/// differ from the default are stored or compared.
#[derive(Clone, Debug)]
pub struct PerChoice<C, V> {
    set: BTreeMap<C, V>,
}

impl<C: Choice, V: Clone + Default + PartialEq> PerChoice<C, V> {
    /// The value for `choice`, the default when never set.
    pub fn get(&self, choice: C) -> V {
        self.set.get(&choice).cloned().unwrap_or_default()
    }

    /// The value for `choice` to change in place.
    pub fn get_mut(&mut self, choice: C) -> &mut V {
        self.set.entry(choice).or_default()
    }

    /// Values that differ from the default.
    fn changed(&self) -> impl Iterator<Item = (&C, &V)> {
        let default = V::default();
        self.set.iter().filter(move |(_, value)| **value != default)
    }
}

impl<C, V> Default for PerChoice<C, V> {
    fn default() -> Self {
        Self {
            set: BTreeMap::new(),
        }
    }
}

impl<C: Choice, V: Clone + Default + PartialEq> PartialEq for PerChoice<C, V> {
    fn eq(&self, other: &Self) -> bool {
        self.changed().eq(other.changed())
    }
}

impl<C: Choice, V: Clone + Default + Eq> Eq for PerChoice<C, V> {}

impl<C: Choice + Serialize, V: Clone + Default + PartialEq + Serialize> Serialize
    for PerChoice<C, V>
{
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_map(self.changed())
    }
}

impl<'de, C: Choice + DeserializeOwned, V: DeserializeOwned> Deserialize<'de> for PerChoice<C, V> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Self {
            set: BTreeMap::deserialize(deserializer)?,
        })
    }
}

/// Every variant's value is checked, not only the selected one's.
impl<C, V> Preference for PerChoice<C, V>
where
    C: Choice + Serialize + DeserializeOwned,
    V: Preference + Default,
{
    type Form = PerChoice<C, V::Form>;

    fn to_form(&self) -> Self::Form {
        PerChoice {
            set: self.set.iter().map(|(c, v)| (*c, v.to_form())).collect(),
        }
    }

    fn from_form(form: &Self::Form) -> Result<Self, Invalid> {
        let set = form
            .set
            .iter()
            .map(|(c, v)| Ok((*c, V::from_form(v)?)))
            .collect::<Result<_, Invalid>>()?;
        Ok(Self { set })
    }
}
