//! Typed application settings shared by native and browser RPC consumers.
use super::{FromDomain, FromWire, IntoDomain, IntoWire};
use super::{Service, enumeration, invalid, required};
use study_ai::{
    chat::{LlmModel, LlmPreferences, LlmProvider, TierSetup},
    stt::TranscriptionPreferences,
};
use study_core::{Language, LanguagePreferences, ReviewPreferences};
use study_rpc::v1 as p;

study_core::choice! {
    /// Persisted application appearance.
    pub enum Appearance { Light = "light", #[default] Dark = "dark", }
}
study_core::preferences! {
    /// Window preferences shared by native and development consumers.
    #[preferences(scope = "app")]
    pub struct WindowPreferences {
        pub appearance: Appearance = Appearance::Dark,
        pub zoom_percent: u16 = 100,
        pub onboarded: bool = false,
    }
}
impl Service {
    pub(super) fn load_app_settings(&self) -> study_core::Result<p::AppSettings> {
        let v: WindowPreferences = self.app.preferences()?;
        let l: LanguagePreferences = self.app.preferences()?;
        Ok(p::AppSettings {
            language: p::Language::from_domain(l.language) as i32,
            appearance: match v.appearance {
                Appearance::Light => p::Appearance::Light,
                Appearance::Dark => p::Appearance::Dark,
            } as i32,
            zoom_percent: u32::from(v.zoom_percent),
            onboarded: v.onboarded,
        })
    }
    pub(super) fn store_app_settings(&self, v: p::AppSettings) -> Result<(), tonic::Status> {
        let language = enumeration::<p::Language, Language>(v.language)?;
        let appearance = match p::Appearance::try_from(v.appearance) {
            Ok(p::Appearance::Light) => Appearance::Light,
            Ok(p::Appearance::Dark) => Appearance::Dark,
            _ => return Err(invalid("appearance is required")),
        };
        let zoom_percent =
            u16::try_from(v.zoom_percent).map_err(|_| invalid("zoom out of range"))?;
        if !(50..=200).contains(&zoom_percent) {
            return Err(invalid("zoom out of range"));
        }
        self.app
            .with(|db| {
                LanguagePreferences { language }.save(db)?;
                WindowPreferences {
                    appearance,
                    zoom_percent,
                    onboarded: v.onboarded,
                }
                .save(db)
            })
            .map_err(super::status)
    }
}
impl FromDomain<LlmProvider> for p::LlmProvider {
    fn from_domain(_: LlmProvider) -> Self {
        Self::ChatGpt
    }
}
impl FromWire<p::LlmProvider> for LlmProvider {
    type Error = tonic::Status;
    fn from_wire(v: p::LlmProvider) -> Result<Self, Self::Error> {
        match v {
            p::LlmProvider::ChatGpt => Ok(Self::ChatGpt),
            _ => Err(invalid("provider is required")),
        }
    }
}
impl FromDomain<LlmModel> for p::LlmModel {
    fn from_domain(v: LlmModel) -> Self {
        match v {
            LlmModel::Gpt6Luna => Self::Gpt6Luna,
            LlmModel::Gpt61Sol => Self::Gpt61Sol,
            LlmModel::Gpt6Astra => Self::Gpt6Astra,
        }
    }
}
impl FromWire<p::LlmModel> for LlmModel {
    type Error = tonic::Status;
    fn from_wire(v: p::LlmModel) -> Result<Self, Self::Error> {
        match v {
            p::LlmModel::Gpt6Luna => Ok(Self::Gpt6Luna),
            p::LlmModel::Gpt61Sol => Ok(Self::Gpt61Sol),
            p::LlmModel::Gpt6Astra => Ok(Self::Gpt6Astra),
            _ => Err(invalid("model is required")),
        }
    }
}
impl FromDomain<TierSetup> for p::TierSetup {
    fn from_domain(v: TierSetup) -> Self {
        Self {
            provider: p::LlmProvider::from_domain(v.provider) as i32,
            model: v.model.map(|v| p::LlmModel::from_domain(v) as i32),
        }
    }
}
impl FromWire<p::TierSetup> for TierSetup {
    type Error = tonic::Status;
    fn from_wire(v: p::TierSetup) -> Result<Self, Self::Error> {
        Ok(Self {
            provider: enumeration::<p::LlmProvider, LlmProvider>(v.provider)?,
            model: v
                .model
                .map(enumeration::<p::LlmModel, LlmModel>)
                .transpose()?,
        })
    }
}
impl FromDomain<LlmPreferences> for p::LlmSettings {
    fn from_domain(v: LlmPreferences) -> Self {
        Self {
            tiny: Some(v.tiny.wire()),
            medium: Some(v.medium.wire()),
            smart: Some(v.smart.wire()),
        }
    }
}
impl FromWire<p::LlmSettings> for LlmPreferences {
    type Error = tonic::Status;
    fn from_wire(v: p::LlmSettings) -> Result<Self, Self::Error> {
        Ok(Self {
            tiny: required(v.tiny, "tiny")?.domain()?,
            medium: required(v.medium, "medium")?.domain()?,
            smart: required(v.smart, "smart")?.domain()?,
        })
    }
}
impl FromDomain<TranscriptionPreferences> for p::TranscriptionSettings {
    fn from_domain(v: TranscriptionPreferences) -> Self {
        Self {
            local_instances: v.local_instances.as_usize() as u32,
        }
    }
}
impl FromWire<p::TranscriptionSettings> for TranscriptionPreferences {
    type Error = tonic::Status;
    fn from_wire(v: p::TranscriptionSettings) -> Result<Self, Self::Error> {
        Ok(Self {
            local_instances: super::copies(v.local_instances)?,
        })
    }
}
impl FromDomain<ReviewPreferences> for p::ReviewSettings {
    fn from_domain(v: ReviewPreferences) -> Self {
        Self {
            new_cards_per_day: v.new_cards_per_day,
        }
    }
}
impl FromWire<p::ReviewSettings> for ReviewPreferences {
    type Error = tonic::Status;
    fn from_wire(v: p::ReviewSettings) -> Result<Self, Self::Error> {
        Ok(Self {
            new_cards_per_day: v.new_cards_per_day,
        })
    }
}
