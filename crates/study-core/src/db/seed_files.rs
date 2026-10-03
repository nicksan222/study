//! Small real files for the seed data, so previews have something to draw and pipelines have
//! something to work on: pictures, PDFs whose pages carry what was read from them, saved web
//! articles, text, and real recordings of speech (two seconds of John F. Kennedy's 1961
//! inaugural address, which is public domain).

use crate::{SourceKind, mime, sniff};

/// The bytes of a sample file called `name`, chosen by the kind its name sniffs as. A PDF
/// has a page for each of `pages`, and a web article (titled `title`) a section for each.
pub(super) fn sample(name: &str, title: &str, pages: &[&str]) -> Vec<u8> {
    let named = sniff(name, &[]);
    match (named.kind, named.mime) {
        _ if named.is_raster() => picture(name),
        (SourceKind::Pdf, _) => pdf(name, pages),
        (_, mime::HTML) => article(title, pages),
        (_, mime::MARKDOWN) => format!(
            "# {name}\n\n- Chapters 5 to 8\n- Past papers, timed\n- Office hours on Thursday\n\n\
             Remember to go over the proofs twice before drawing any diagrams.\n"
        )
        .into_bytes(),
        (_, "audio/mpeg") => RECORDINGS_MP3.to_vec(),
        (_, "audio/mp4") => RECORDINGS_M4A.to_vec(),
        (_, "audio/ogg") => RECORDINGS_OGG.to_vec(),
        (_, "text/csv") => {
            b"week,topic,score\n1,Vectors,82\n2,Matrices,74\n3,Determinants,91\n4,Eigenvalues,68\n"
                .to_vec()
        }
        _ => format!("placeholder for {name}").into_bytes(),
    }
}

// Copies of study-media's format fixtures, transcoded with FFmpeg.
const RECORDINGS_MP3: &[u8] = include_bytes!("../../tests/fixtures/speech.mp3");
const RECORDINGS_M4A: &[u8] = include_bytes!("../../tests/fixtures/speech.m4a");
const RECORDINGS_OGG: &[u8] = include_bytes!("../../tests/fixtures/voice-note.ogg");

/// A 480x300 PNG with soft diagonal bands, its colours picked from the name.
fn picture(name: &str) -> Vec<u8> {
    let seed = name
        .bytes()
        .fold(7u32, |hash, byte| hash.wrapping_mul(31) ^ u32::from(byte));
    let (r, g, b) = (
        (seed & 0xff) as f32,
        ((seed >> 8) & 0xff) as f32,
        ((seed >> 16) & 0xff) as f32,
    );
    let (width, height) = (480u32, 300u32);
    let mut raw = Vec::with_capacity(((width * 3 + 1) * height) as usize);
    for y in 0..height {
        raw.push(0);
        for x in 0..width {
            let band = (((x + y) as f32 / 46.0).sin() * 0.5 + 0.5) * 0.35;
            let fade = y as f32 / height as f32 * 0.4;
            let mix = |base: f32, light: f32| {
                let value = 70.0 + base * 0.45 + light * 120.0 - fade * 60.0;
                value.clamp(0.0, 255.0) as u8
            };
            raw.extend_from_slice(&[mix(r, band), mix(g, band * 0.8), mix(b, band * 1.1)]);
        }
    }
    let mut header = Vec::new();
    header.extend_from_slice(&width.to_be_bytes());
    header.extend_from_slice(&height.to_be_bytes());
    header.extend_from_slice(&[8, 2, 0, 0, 0]);
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    chunk(&mut png, b"IHDR", &header);
    chunk(&mut png, b"IDAT", &zlib_stored(&raw));
    chunk(&mut png, b"IEND", &[]);
    png
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut checked = kind.to_vec();
    checked.extend_from_slice(data);
    out.extend_from_slice(&crc32(&checked).to_be_bytes());
}

/// A zlib stream of uncompressed blocks: bigger than needed, but trivially correct.
fn zlib_stored(data: &[u8]) -> Vec<u8> {
    let mut out = vec![0x78, 0x01];
    let mut blocks = data.chunks(65_535).peekable();
    while let Some(block) = blocks.next() {
        out.push(u8::from(blocks.peek().is_none()));
        out.extend_from_slice(&(block.len() as u16).to_le_bytes());
        out.extend_from_slice(&(!(block.len() as u16)).to_le_bytes());
        out.extend_from_slice(block);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for &byte in data {
        a = (a + u32::from(byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    out.extend_from_slice(&((b << 16) | a).to_be_bytes());
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in data {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

/// A saved web article: its title, then a paragraph per section.
fn article(title: &str, sections: &[&str]) -> Vec<u8> {
    let escape = |text: &str| {
        text.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    };
    let body: String = sections
        .iter()
        .map(|section| format!("<p>{}</p>\n", escape(section)))
        .collect();
    format!(
        "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>{0}</title></head>\n\
         <body><article><h1>{0}</h1>\n{body}</article></body></html>\n",
        escape(title)
    )
    .into_bytes()
}

/// Most characters on one line of a sample PDF page.
const PDF_LINE: usize = 72;

/// A PDF with a page for each of `pages` (one titled page when there are none): its first
/// line large as the page's heading, the rest wrapped below it.
fn pdf(name: &str, pages: &[&str]) -> Vec<u8> {
    let fallback = [name.trim_end_matches(".pdf")];
    let pages = if pages.is_empty() {
        &fallback[..]
    } else {
        pages
    };
    // Only what the standard Helvetica encoding can show, with PDF's string escapes.
    let plain = |text: &str| -> String {
        text.chars()
            .map(|c| match c {
                '→' => '>',
                '•' => '-',
                '–' | '—' | '−' => '-',
                '·' => '.',
                c if c.is_ascii() => c,
                _ => '?',
            })
            .collect::<String>()
            .replace('\\', "\\\\")
            .replace('(', "\\(")
            .replace(')', "\\)")
    };
    let page_count = pages.len();
    // Objects: 1 catalog, 2 pages, 3 font, then a page and its contents for each page.
    let mut objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        format!(
            "<< /Type /Pages /Kids [{}] /Count {page_count} >>",
            (0..page_count)
                .map(|index| format!("{} 0 R", 4 + index * 2))
                .collect::<Vec<_>>()
                .join(" ")
        ),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
    ];
    for (index, page) in pages.iter().enumerate() {
        let mut lines = page.lines();
        let heading = plain(lines.next().unwrap_or_default());
        let mut content = format!(
            "0.93 0.95 1 rg 0 712 612 80 re f\n0.2 0.3 0.6 rg BT /F1 24 Tf 56 740 Td ({heading}) Tj ET\n\
             0.15 0.15 0.15 rg BT /F1 14 Tf 56 670 Td 20 TL\n"
        );
        for line in lines {
            let mut current = String::new();
            for word in line.split_whitespace() {
                if !current.is_empty() && current.len() + word.len() + 1 > PDF_LINE {
                    content.push_str(&format!("({}) Tj T*\n", plain(&current)));
                    current.clear();
                }
                if !current.is_empty() {
                    current.push(' ');
                }
                current.push_str(word);
            }
            content.push_str(&format!("({}) Tj T*\n", plain(&current)));
        }
        content.push_str(&format!(
            "ET\n0.5 0.5 0.5 rg BT /F1 10 Tf 540 40 Td ({} / {page_count}) Tj ET\n",
            index + 1
        ));
        objects.push(format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {} 0 R \
             /Resources << /Font << /F1 3 0 R >> >> >>",
            5 + index * 2
        ));
        objects.push(format!(
            "<< /Length {} >>\nstream\n{content}endstream",
            content.len()
        ));
    }
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{object}\nendobj\n", index + 1).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(
        format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
    );
    for offset in offsets {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    out
}
