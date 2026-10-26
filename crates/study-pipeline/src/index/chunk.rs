//! Splitting text into passages small enough to embed and to show as a result.

/// Longest chunk, in characters: about 200 tokens, well inside what the model reads, and
/// short enough that one chunk is about one idea.
pub(super) const MAX_CHARS: usize = 800;

/// Characters each chunk repeats from the end of the one before, so a sentence cut at a
/// boundary is still found whole in one of them.
const OVERLAP_CHARS: usize = 120;

/// Splits `text` into chunks of at most [`MAX_CHARS`], breaking at paragraphs, then
/// sentences, then words. Short text is one chunk; blank text is none.
pub(super) fn chunk(text: &str) -> Vec<String> {
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }
    if chars(text) <= MAX_CHARS {
        return vec![text.to_owned()];
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    for piece in pieces(text) {
        if current.is_empty() {
            current = piece.to_owned();
        } else if chars(&current) + 1 + chars(piece) <= MAX_CHARS {
            current.push(' ');
            current.push_str(piece);
        } else {
            let overlap = tail(&current, OVERLAP_CHARS).to_owned();
            chunks.push(std::mem::take(&mut current));
            current = if !overlap.is_empty() && chars(&overlap) + 1 + chars(piece) <= MAX_CHARS {
                format!("{overlap} {piece}")
            } else {
                piece.to_owned()
            };
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// The text in pieces of at most [`MAX_CHARS`], each a paragraph, sentence, or run of words.
fn pieces(text: &str) -> Vec<&str> {
    let mut pieces = Vec::new();
    for paragraph in text.split("\n\n").map(str::trim).filter(|p| !p.is_empty()) {
        if chars(paragraph) <= MAX_CHARS {
            pieces.push(paragraph);
            continue;
        }
        for sentence in sentences(paragraph) {
            if chars(sentence) <= MAX_CHARS {
                pieces.push(sentence);
            } else {
                pieces.extend(words(sentence));
            }
        }
    }
    pieces
}

/// Splits after `.`, `!`, or `?` followed by whitespace.
fn sentences(text: &str) -> Vec<&str> {
    let mut sentences = Vec::new();
    let mut start = 0;
    let mut previous = ' ';
    for (index, character) in text.char_indices() {
        if character.is_whitespace() && matches!(previous, '.' | '!' | '?') {
            let sentence = text[start..index].trim();
            if !sentence.is_empty() {
                sentences.push(sentence);
            }
            start = index;
        }
        previous = character;
    }
    let rest = text[start..].trim();
    if !rest.is_empty() {
        sentences.push(rest);
    }
    sentences
}

/// Runs of whole words of at most [`MAX_CHARS`]; a longer word is cut.
fn words(text: &str) -> Vec<&str> {
    let mut runs = Vec::new();
    let mut rest = text.trim();
    while !rest.is_empty() {
        if chars(rest) <= MAX_CHARS {
            runs.push(rest);
            break;
        }
        let limit = rest
            .char_indices()
            .nth(MAX_CHARS)
            .map_or(rest.len(), |(index, _)| index);
        let end = rest[..limit]
            .rfind(char::is_whitespace)
            .filter(|&end| end > 0)
            .unwrap_or(limit);
        runs.push(rest[..end].trim_end());
        rest = rest[end..].trim_start();
    }
    runs
}

/// About the last `count` characters of `text`, starting at a word.
fn tail(text: &str, count: usize) -> &str {
    let total = chars(text);
    if total <= count {
        return text;
    }
    let start = text
        .char_indices()
        .nth(total - count)
        .map_or(text.len(), |(index, _)| index);
    match text[start..].find(char::is_whitespace) {
        Some(space) => text[start + space..].trim_start(),
        None => "",
    }
}

fn chars(text: &str) -> usize {
    text.chars().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_and_blank_text() {
        assert!(chunk("  \n ").is_empty());
        assert_eq!(chunk("  Mitochondria \n"), ["Mitochondria"]);
    }

    #[test]
    fn long_text_breaks_at_paragraphs_and_overlaps() {
        let first = "Alpha beta gamma. ".repeat(30);
        let second = "Delta epsilon zeta. ".repeat(30);
        let chunks = chunk(&format!("{first}\n\n{second}"));
        assert_eq!(chunks.len(), 2);
        assert!(chunks[0].starts_with("Alpha") && !chunks[0].contains("Delta"));
        // The second repeats the end of the first.
        let (repeated, _) = chunks[1].split_once("Delta").expect("the second paragraph");
        assert!(repeated.ends_with("gamma. ") && chunks[0].ends_with(repeated.trim_end()));
        for chunk in &chunks {
            assert!(chars(chunk) <= MAX_CHARS);
        }
    }

    #[test]
    fn one_long_paragraph_breaks_at_sentences_then_words() {
        let sentences = "The Krebs cycle makes ATP in the mitochondria. ".repeat(60);
        let chunks = chunk(&sentences);
        assert!(chunks.len() > 2);
        for chunk in &chunks {
            assert!(chars(chunk) <= MAX_CHARS);
            assert!(chunk.ends_with('.'), "cut mid-sentence: {chunk:?}");
        }

        let words = "parola ".repeat(400);
        for chunk in chunk(&words) {
            assert!(chars(&chunk) <= MAX_CHARS);
            assert!(chunk.split(' ').all(|word| word == "parola"));
        }
        // No spaces at all still ends up bounded, and multibyte text is never split mid-char.
        for chunk in chunk(&"è".repeat(2000)) {
            assert!(chars(&chunk) <= MAX_CHARS);
        }
    }
}
