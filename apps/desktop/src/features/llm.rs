//! The setup action the Language models settings offer: testing each tier's online model.
//! What the settings mean lives in `study_app::chat`.

use study_app::chat::{Connections, LlmPreferences, Tier};

/// Sends a short prompt to every tier's model, all at once, and returns the tiers whose
/// model did not answer.
pub async fn check_connections(preferences: LlmPreferences, connections: Connections) -> Vec<Tier> {
    let checks: Vec<_> = Tier::ALL
        .into_iter()
        .map(|tier| {
            let config = preferences.provider_config(tier, &connections);
            (tier, tokio::spawn(config.check_connection()))
        })
        .collect();
    let mut failed = Vec::new();
    for (tier, check) in checks {
        if !matches!(check.await, Ok(Ok(()))) {
            failed.push(tier);
        }
    }
    failed
}
