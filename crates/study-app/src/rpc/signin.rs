//! A browser attempt retains cancellation ownership throughout callback wait and account commit.
use super::*;
use study_ai::chat::{ChatGptAccount, ChatGptPreferences};
use tokio::sync::{oneshot, watch};
use tokio_util::sync::CancellationToken;

pub(super) struct Attempt {
    cancel: CancellationToken,
    closed: watch::Receiver<bool>,
    result: Option<oneshot::Receiver<Result<ChatGptAccount, Status>>>,
}
impl Attempt {
    fn cancel(&self) {
        self.cancel.cancel();
    }
    async fn closed(mut self) {
        while !*self.closed.borrow_and_update() {
            if self.closed.changed().await.is_err() {
                break;
            }
        }
    }
}
fn cancelled() -> Status {
    classified(ErrorKind::Cancelled, "sign-in cancelled")
}
impl Service {
    pub(super) async fn cancel_attempts(&self, id: Option<String>) -> Result<bool, Status> {
        let attempts = self
            .run(false, move |s| {
                let mut attempts = s
                    .sign_ins
                    .lock()
                    .map_err(|_| classified(ErrorKind::Internal, "sign-in lock failed"))?;
                let removed = if let Some(id) = id {
                    attempts.remove(&id).into_iter().collect::<Vec<_>>()
                } else {
                    attempts.drain().map(|(_, v)| v).collect()
                };
                for attempt in &removed {
                    attempt.cancel();
                }
                Ok(removed)
            })
            .await?
            .into_inner();
        let removed = !attempts.is_empty();
        // Response is a cancellation acknowledgement: the callback socket is already closed.
        for attempt in attempts {
            attempt.closed().await;
        }
        Ok(removed)
    }
    pub(super) async fn begin_sign_in(&self, reconsent: bool) -> Result<p::SignInAttempt, Status> {
        let _start = tokio::select! {biased;
            _=self.lifecycle.interrupted()=>return Err(cancelled()),
            lock=self.sign_in_start.lock()=>lock,
        };
        self.cancel_attempts(None).await?;
        let app = self.app.clone();
        let sign_in = self
            .async_work(async move { outcome(app.start_chatgpt_sign_in(reconsent).await) })
            .await?;
        let attempt_id = uuid::Uuid::new_v4().to_string();
        let url = sign_in.url().to_owned();
        let cancel = CancellationToken::new();
        let task_cancel = cancel.clone();
        let (closed, closed_rx) = watch::channel(false);
        let (sent, result) = oneshot::channel();
        let lifecycle = self.lifecycle.clone();
        let guard = lifecycle.admit()?;
        // This task owns the callback listener even before Finish, and cannot detach from
        // lifecycle drain. Cancel, replacement and service shutdown all close the same future.
        tokio::spawn(async move {
            let _guard = guard;
            let result = {
                let finish = sign_in.finish(std::time::Duration::from_secs(300));
                tokio::pin!(finish);
                tokio::select! {biased;
                    _=task_cancel.cancelled()=>Err(cancelled()),
                    _=lifecycle.interrupted()=>Err(cancelled()),
                    account=&mut finish=>account.map_err(|e|status(study_core::Error::classified(e))),
                }
            };
            // Finish future, its listener and open callback connections have dropped here.
            closed.send_replace(true);
            let _ = sent.send(result);
        });
        let entry = Attempt {
            cancel,
            closed: closed_rx,
            result: Some(result),
        };
        let previous = {
            let mut attempts = self
                .sign_ins
                .lock()
                .map_err(|_| classified(ErrorKind::Internal, "sign-in lock failed"))?;
            if let Err(error) = self.lifecycle.check() {
                entry.cancel();
                return Err(error);
            }
            // Concurrent Starts are serialized at publication; the last published wins.
            let previous = attempts.drain().map(|(_, v)| v).collect::<Vec<_>>();
            for previous in &previous {
                previous.cancel();
            }
            attempts.insert(attempt_id.clone(), entry);
            previous
        };
        for previous in previous {
            previous.closed().await;
        }
        Ok(p::SignInAttempt { attempt_id, url })
    }
    pub(super) async fn complete_sign_in(&self, id: String) -> Result<p::ChatGptAccount, Status> {
        let (result, cancel) = self
            .run(false, {
                let id = id.clone();
                move |s| {
                    let mut attempts = s
                        .sign_ins
                        .lock()
                        .map_err(|_| classified(ErrorKind::Internal, "sign-in lock failed"))?;
                    let attempt = attempts.get_mut(&id).ok_or_else(|| {
                        classified(ErrorKind::NotFound, "sign-in attempt not found")
                    })?;
                    let result = attempt.result.take().ok_or_else(|| {
                        classified(ErrorKind::Config, "sign-in finish already active")
                    })?;
                    Ok((result, attempt.cancel.clone()))
                }
            })
            .await?
            .into_inner();
        let account = tokio::select! {biased;
            _=self.lifecycle.interrupted()=>Err(cancelled()),
            _=cancel.cancelled()=>Err(cancelled()),
            account=result=>account.unwrap_or_else(|_|Err(cancelled())),
        };
        match account {
            Ok(account) => self.commit_sign_in(id, account).await,
            Err(error) => {
                let mut attempts = self
                    .sign_ins
                    .lock()
                    .map_err(|_| classified(ErrorKind::Internal, "sign-in lock failed"))?;
                if let Some(attempt) = attempts.remove(&id) {
                    attempt.cancel();
                }
                Err(error)
            }
        }
    }
    async fn commit_sign_in(
        &self,
        id: String,
        account: ChatGptAccount,
    ) -> Result<p::ChatGptAccount, Status> {
        self.run(true, move |s| {
            // Cancel/replacement and the account commit share this lock. Either the commit
            // finishes before Cancel acknowledges, or Cancel wins and no stale save begins.
            let mut attempts = s
                .sign_ins
                .lock()
                .map_err(|_| classified(ErrorKind::Internal, "sign-in lock failed"))?;
            let active = attempts
                .get(&id)
                .is_some_and(|entry| !entry.cancel.is_cancelled());
            if !active {
                return Err(cancelled());
            }
            s.lifecycle.check()?;
            let mut preferences: ChatGptPreferences = outcome(s.app.preferences())?;
            preferences.client_id = Some(account.client_id.clone());
            preferences.account = Some(account.clone());
            outcome(s.app.save_preferences(&preferences))?;
            if let Err(error) = s.app.retry_language_model_work() {
                tracing::warn!(%error,"cannot start work waiting for sign-in");
            }
            attempts.remove(&id);
            Ok(account.wire())
        })
        .await
        .map(tonic::Response::into_inner)
    }
    pub(super) async fn cancel_sign_in(&self, id: String) -> Result<bool, Status> {
        self.cancel_attempts(Some(id)).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn obsolete_account() -> ChatGptAccount {
        ChatGptAccount {
            subject: "obsolete".into(),
            client_id: "old-client".into(),
            email: None,
            sharing: false,
            refresh_token: None,
        }
    }
    #[tokio::test]
    async fn cancelled_or_replaced_callback_result_cannot_commit_an_account() {
        let dir = tempfile::tempdir().unwrap();
        let app = crate::App::open(dir.path().join("study.sqlite3")).unwrap();
        let service = Service::new(app.clone());
        let first = service.begin_sign_in(false).await.unwrap();
        assert!(
            service
                .cancel_sign_in(first.attempt_id.clone())
                .await
                .unwrap()
        );
        assert_eq!(
            service
                .commit_sign_in(first.attempt_id, obsolete_account())
                .await
                .unwrap_err()
                .code(),
            tonic::Code::Cancelled
        );
        let first = service.begin_sign_in(false).await.unwrap();
        let replacement = service.begin_sign_in(false).await.unwrap();
        assert_eq!(
            service
                .commit_sign_in(first.attempt_id, obsolete_account())
                .await
                .unwrap_err()
                .code(),
            tonic::Code::Cancelled
        );
        assert!(app.connections().unwrap().chatgpt.is_none());
        service
            .cancel_sign_in(replacement.attempt_id)
            .await
            .unwrap();
        service.lifecycle.drain().await;
    }
    #[tokio::test]
    async fn pause_closes_local_sign_in_wait_without_stopping_the_recoverable_service() {
        let dir = tempfile::tempdir().unwrap();
        let app = crate::App::open(dir.path().join("study.sqlite3")).unwrap();
        let service = Service::new(app.clone());
        let attempt = service.begin_sign_in(false).await.unwrap();
        let auth = url::Url::parse(&attempt.url).unwrap();
        let redirect = auth
            .query_pairs()
            .find(|(k, _)| k == "redirect_uri")
            .unwrap()
            .1
            .into_owned();
        let redirect = url::Url::parse(&redirect).unwrap();
        let port = redirect.port().unwrap();
        assert!(
            tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .is_ok()
        );
        let pause = service.lifecycle.pause().unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), pause.drain())
            .await
            .unwrap();
        assert!(
            tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .is_err()
        );
        assert!(app.connections().unwrap().chatgpt.is_none());
        drop(pause);
        assert_eq!(
            service
                .complete_sign_in(attempt.attempt_id)
                .await
                .unwrap_err()
                .code(),
            Code::Cancelled
        );
        let replacement = service.begin_sign_in(false).await.unwrap();
        service
            .cancel_sign_in(replacement.attempt_id)
            .await
            .unwrap();
        service.lifecycle.drain().await;
    }
}
