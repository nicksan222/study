//! Preferences declared with `study_core::preferences!`: forms, validation, storage, a value
//! per choice, and secrets.

use serde::{Deserialize, Serialize};
use study_core::Result;
use study_core::db::Database;
use study_core::preferences::{Count, Invalid, PerChoice, Secret, encode};

study_core::choice! {
    enum Provider {
        #[default]
        Local = "local",
        Cloud = "cloud",
    }
}

/// A sign-in, stored as a value of its own, with a secret `refresh_token`.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
struct Account {
    name: String,
    refresh_token: Option<Secret>,
}

study_core::preferences! {
    #[preferences(scope = "sample", form = SampleForm)]
    struct Sample {
        provider: Provider = Provider::Local,
        copies: Count<4> = Count::ONE,
        /// Requests at once, per provider; `None` keeps the provider's default.
        parallel: PerChoice<Provider, Option<Count<16>>> = PerChoice::default(),
    }
}

study_core::preferences! {
    #[preferences(scope = "account")]
    struct Accounts {
        account: Option<Account> = None,
    }
}

fn database() -> Result<(tempfile::TempDir, Database)> {
    let dir = tempfile::tempdir()?;
    let db = Database::open(dir.path().join("study.sqlite3"))?;
    Ok((dir, db))
}

fn filled_form() -> SampleForm {
    let mut form = SampleForm {
        provider: Provider::Cloud,
        copies: "3".into(),
        ..SampleForm::default()
    };
    *form.parallel.get_mut(Provider::Cloud) = " 6 ".into();
    form
}

#[test]
fn choices_round_trip_through_their_codes() {
    for &provider in Provider::ALL {
        assert_eq!(Provider::from_code(provider.code()), Some(provider));
    }
    assert_eq!(Provider::from_code("nope"), None);
    assert_eq!(encode(&Provider::Cloud).unwrap(), r#""cloud""#);
}

#[test]
fn a_fresh_database_reads_the_declared_defaults() -> Result<()> {
    let (_dir, db) = database()?;
    assert_eq!(Sample::load(&db)?, Sample::default());
    Ok(())
}

#[test]
fn a_fallback_fills_only_what_was_never_saved() -> Result<()> {
    let (_dir, db) = database()?;
    let recommended = Sample {
        copies: Count::new(3).unwrap(),
        ..Sample::default()
    };
    assert_eq!(Sample::load_or(&db, recommended.clone())?, recommended);

    db.set_preference(Sample::SCOPE, "copies", Some("2"))?;
    let loaded = Sample::load_or(&db, recommended)?;
    assert_eq!(loaded.copies.get(), 2);
    assert_eq!(loaded.provider, Provider::Local);
    Ok(())
}

#[test]
fn a_form_parses_trimmed_checked_values_and_back() -> Result<()> {
    let sample = filled_form().parse()?;
    assert_eq!(sample.copies.get(), 3);
    assert_eq!(
        sample.parallel.get(Provider::Cloud).map(Count::get),
        Some(6)
    );
    assert_eq!(sample.parallel.get(Provider::Local), None);
    assert_eq!(SampleForm::from(&sample).parse()?, sample);
    Ok(())
}

#[test]
fn invalid_text_is_refused_for_every_choice_not_just_the_selected_one() {
    let mut form = SampleForm::default();
    for bad in ["0", "5", "-1", "two", "1.5"] {
        form.copies = bad.into();
        assert_eq!(form.parse(), Err(Invalid::Count { max: 4 }), "{bad:?}");
    }
    form.copies = String::new();
    assert_eq!(form.parse().unwrap().copies, Count::ONE);

    *form.parallel.get_mut(Provider::Cloud) = "17".into();
    assert_eq!(form.parse(), Err(Invalid::Count { max: 16 }));
}

#[test]
fn secrets_are_never_blank_and_never_shown_in_debug_output() {
    assert_eq!(Secret::parse("  \n"), None);
    let account = Account {
        name: "ada".into(),
        refresh_token: Secret::parse(" rt-secret "),
    };
    assert_eq!(
        account.refresh_token.as_ref().unwrap().expose(),
        "rt-secret"
    );
    assert!(!format!("{account:?}").contains("rt-secret"));
}

#[test]
fn unset_choices_compare_equal_to_defaults() {
    let mut touched = PerChoice::<Provider, Option<Count<16>>>::default();
    touched.get_mut(Provider::Cloud);
    assert_eq!(touched, PerChoice::default());
    assert_eq!(encode(&touched).unwrap(), "{}");
}

#[test]
fn saved_preferences_survive_reopening_and_scopes_stay_apart() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("study.sqlite3");
    let sample = filled_form().parse()?;
    sample.save(&Database::open(&path)?)?;
    let db = Database::open(&path)?;
    assert_eq!(Sample::load(&db)?, sample);
    assert_eq!(Accounts::load(&db)?, Accounts::default());
    Ok(())
}

#[test]
fn a_stored_value_that_no_longer_parses_is_an_error() -> Result<()> {
    let (_dir, db) = database()?;
    db.save_preferences("sample", &[("copies", "9".into())])?;
    assert!(Sample::load(&db).is_err());
    Ok(())
}
