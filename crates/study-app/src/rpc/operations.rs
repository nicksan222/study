//! Async waits separated from admitted, drained database effects.
use super::*;
impl Service {
    pub(super) async fn install(&self, model: crate::LocalModel) -> Result<(), Status> {
        let install = match model {
            crate::LocalModel::Transcription => {
                study_ai::stt::provider::LocalConfig::default().model()
            }
            crate::LocalModel::Search => study_ai::embed::LocalConfig::default().model(),
        };
        let lifecycle = self.lifecycle.clone();
        self.async_work(async move {
            tokio::select! {biased;
                _=lifecycle.interrupted()=>Err(classified(ErrorKind::Cancelled,"model install cancelled")),
                result=install.install()=>result.map_err(|error|status(study_core::Error::classified(error))),
            }
        }).await?;
        // Same post-install actions as App::install_model, but queued work crosses the
        // lifecycle admission gate only after the cancellable network wait completed.
        self.run(true, move |s| {
            outcome(match model {
                crate::LocalModel::Search => {
                    s.app.embedder().installed();
                    s.app.queue_missing_embeddings()
                }
                crate::LocalModel::Transcription => s
                    .app
                    .release_waiting(study_core::Requirement::Transcription)
                    .and_then(|_| {
                        s.app.retry_failed(
                            &[study_core::JobKind::Extract],
                            &[ErrorKind::ModelUnavailable],
                        )
                    }),
            })
        })
        .await?;
        Ok(())
    }
    pub(super) async fn sign_out(&self) -> Result<(), Status> {
        let _start = tokio::select! {biased;
            _=self.lifecycle.interrupted()=>return Err(classified(ErrorKind::Cancelled,"sign-out stopped")),
            lock=self.sign_in_start.lock()=>lock,
        };
        self.cancel_attempts(None).await?;
        let account = self
            .run(true, move |s| {
                let mut preferences: study_ai::chat::ChatGptPreferences =
                    outcome(s.app.preferences())?;
                let account = preferences.account.take();
                outcome(s.app.save_preferences(&preferences))?;
                Ok(account)
            })
            .await?
            .into_inner();
        if let Some(account) = account {
            let lifecycle = self.lifecycle.clone();
            self.async_work(async move {
                tokio::select! {biased;
                    _=lifecycle.interrupted()=>return Err(classified(ErrorKind::Cancelled,"sign-out stopped")),
                    result=study_ai::chat::provider::chatgpt::revoke(study_ai::chat::provider::chatgpt::ISSUER,&account)=>{
                        if let Err(error)=result {tracing::warn!(%error,"cannot end ChatGPT sign-in at OpenAI");}
                    }
                }
                Ok(())
            }).await?;
        }
        Ok(())
    }
}
