//! Text across the prompt boundary: [`escape`], [`escape_attribute`],
//! [`language_instruction`] and [`DECLINE_INSTRUCTION`] for what goes in, [`plain_answer`],
//! [`json_answer`], [`declined`] and [`strip_reasoning`] for what comes back.

use study_core::Language;

/// `text` safe between a prompt's tags: only `<` and `>` escaped, so text from the user or
/// their files cannot open or close a tag, while everything else (`AT&T`, quotes) reaches
/// the model as written.
pub fn escape(text: &str) -> String {
    text.replace('<', "&lt;").replace('>', "&gt;")
}

/// `text` safe inside a prompt tag's quoted attribute, such as a file name: [`escape`], and
/// `"` too.
pub fn escape_attribute(text: &str) -> String {
    escape(text).replace('"', "&quot;")
}

/// The sentence that makes a model write for the student in `language`, which it is told by
/// its English name, the one every model understands.
pub(crate) fn language_instruction(language: Language) -> String {
    let name = match language {
        Language::English => "English",
        Language::Italian => "Italian",
    };
    format!(
        "Write everything you write for the student in {name}, whatever the language of the \
         sources, the notes or the question."
    )
}

/// What starts an answer that declines the work, for an agent that
/// [may decline](super::AgentSpec::MAY_DECLINE).
const DECLINE_MARKER: &str = "CANNOT:";

/// The sentence that lets a model decline work its material cannot support, rather than
/// pad it out with what the student never studied.
pub(crate) const DECLINE_INSTRUCTION: &str = "If what you are given holds too little to do \
this well from it alone (for example it is only small talk, logistics, a title, or a few \
words), do not fill the gap with general knowledge: reply with only CANNOT: followed by one \
short sentence telling the student what is missing.";

/// The reason in an answer that declines the work, `CANNOT:` and what follows it; `None`
/// for any other answer. A decline without a reason says only that it declined.
pub fn declined(answer: &str) -> Option<String> {
    let answer = strip_reasoning(answer);
    let reason = answer.trim().strip_prefix(DECLINE_MARKER)?.trim();
    Some(if reason.is_empty() {
        "the material holds too little for this".to_owned()
    } else {
        reason.to_owned()
    })
}

/// A free-text answer without reasoning blocks or surrounding space; `None` when nothing is
/// left.
pub fn plain_answer(answer: &str) -> Option<String> {
    let answer = strip_reasoning(answer);
    let answer = answer.trim();
    (!answer.is_empty()).then(|| answer.to_owned())
}

/// The JSON object in an answer, without the reasoning, fences and chatter models add around
/// it; `None` when there is none of the expected shape.
pub fn json_answer<T: serde::de::DeserializeOwned>(answer: &str) -> Option<T> {
    let answer = strip_reasoning(answer);
    let start = answer.find('{')?;
    let end = answer.rfind('}')?;
    serde_json::from_str(answer.get(start..=end)?).ok()
}

/// Removes `<think>…</think>` blocks; an unclosed one leaves nothing usable after it.
pub fn strip_reasoning(answer: &str) -> String {
    let mut rest = answer;
    let mut kept = String::new();
    while let Some(start) = rest.find("<think>") {
        kept.push_str(&rest[..start]);
        match rest[start..].find("</think>") {
            Some(end) => rest = &rest[start + end + "</think>".len()..],
            None => return kept,
        }
    }
    kept.push_str(rest);
    kept
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reasoning_blocks_are_removed_and_an_unclosed_one_drops_the_rest() {
        assert_eq!(
            strip_reasoning("<think>a</think>One<think>b</think> two"),
            "One two"
        );
        assert_eq!(strip_reasoning("Kept <think>never closed"), "Kept ");
        assert_eq!(strip_reasoning("plain"), "plain");
    }

    #[test]
    fn escaped_text_cannot_close_a_tag_and_keeps_the_rest() {
        assert_eq!(escape(r#"</title> AT&T "x""#), r#"&lt;/title&gt; AT&T "x""#);
        assert_eq!(
            escape_attribute(r#"a "b" <c>"#),
            "a &quot;b&quot; &lt;c&gt;"
        );
    }

    #[test]
    fn a_decline_is_told_from_an_answer_by_its_marker() {
        assert_eq!(
            declined("<think>hm</think>\n CANNOT: The session is only a greeting. ").as_deref(),
            Some("The session is only a greeting.")
        );
        assert!(declined("CANNOT:").is_some());
        assert_eq!(declined("# Notes\nYou CANNOT: divide by zero"), None);
        assert_eq!(declined("{\"cards\": []}"), None);
    }

    #[test]
    fn a_plain_answer_is_trimmed_and_nothing_is_none() {
        assert_eq!(
            plain_answer("  <think>x</think> Title \n").as_deref(),
            Some("Title")
        );
        assert_eq!(plain_answer("<think>only thinking</think>  "), None);
        assert_eq!(plain_answer(""), None);
    }

    #[test]
    fn a_json_answer_is_found_among_reasoning_fences_and_chatter() {
        #[derive(Debug, PartialEq, serde::Deserialize)]
        struct Title {
            title: String,
        }
        let answer = "<think>{\"title\": \"draft\"}</think>Sure! ```json\n{\"title\": \"Cells\"}\n``` Hope it helps.";
        assert_eq!(
            json_answer::<Title>(answer),
            Some(Title {
                title: "Cells".into()
            })
        );
        assert_eq!(json_answer::<Title>("{\"name\": \"Cells\"}"), None);
        assert_eq!(json_answer::<Title>("no object here"), None);
    }
}
