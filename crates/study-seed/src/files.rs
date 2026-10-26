//! Small real files for the seed data, so previews have something to draw and pipelines have
//! something to work on: pictures, PDFs whose pages carry what was read from them, saved web
//! articles, text, and real recordings of speech (two seconds of John F. Kennedy's 1961
//! inaugural address, which is public domain).

use study_core::{SourceKind, mime, sniff};

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
const RECORDINGS_MP3: &[u8] = include_bytes!("../tests/fixtures/speech.mp3");
const RECORDINGS_M4A: &[u8] = include_bytes!("../tests/fixtures/speech.m4a");
const RECORDINGS_OGG: &[u8] = include_bytes!("../tests/fixtures/voice-note.ogg");

/// A 480x300 PNG of a whiteboard: marker strokes (two boxes joined by an arrow, a curve over
/// axes, a circled dot) on a pale board tinted by the name.
fn picture(name: &str) -> Vec<u8> {
    let seed = name
        .bytes()
        .fold(7u32, |hash, byte| hash.wrapping_mul(31) ^ u32::from(byte));
    let tint = (seed % 12) as u8;
    let (width, height) = (480usize, 300usize);
    let mut pixels = vec![[236 - tint, 240 - tint / 2, 238]; width * height];
    // A soft shadow along the bottom edge, as a photo of a board has.
    for y in 0..height {
        let shade = (y * 18 / height) as u8;
        for x in 0..width {
            let pixel = &mut pixels[y * width + x];
            *pixel = pixel.map(|c| c - shade);
        }
    }
    let blue = [30, 70, 170];
    let red = [200, 50, 45];
    let green = [30, 130, 70];
    let mut marker = |points: &[(f32, f32)], colour: [u8; 3]| {
        for pair in points.windows(2) {
            let ((x0, y0), (x1, y1)) = (pair[0], pair[1]);
            let steps = (x1 - x0).abs().max((y1 - y0).abs()).max(1.0) as usize * 2;
            for step in 0..=steps {
                let t = step as f32 / steps as f32;
                let (cx, cy) = (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
                for dy in -2i32..=2 {
                    for dx in -2i32..=2 {
                        if dx * dx + dy * dy > 5 {
                            continue;
                        }
                        let (x, y) = (cx as i32 + dx, cy as i32 + dy);
                        if (0..width as i32).contains(&x) && (0..height as i32).contains(&y) {
                            pixels[y as usize * width + x as usize] = colour;
                        }
                    }
                }
            }
        }
    };
    let rectangle =
        |x: f32, y: f32, w: f32, h: f32| [(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)];
    // Two boxes and an arrow between them.
    marker(&rectangle(30.0, 40.0, 130.0, 70.0), blue);
    marker(&rectangle(250.0, 40.0, 130.0, 70.0), blue);
    marker(&[(160.0, 75.0), (248.0, 75.0)], red);
    marker(&[(232.0, 62.0), (248.0, 75.0), (232.0, 88.0)], red);
    // Short lines of writing inside the boxes.
    for row in 0..2 {
        let y = 62.0 + row as f32 * 24.0;
        marker(&[(46.0, y), (90.0, y + 3.0), (140.0, y - 2.0)], blue);
        marker(&[(266.0, y), (310.0, y + 3.0), (360.0, y - 2.0)], blue);
    }
    // Axes with a curve over them, and a circled point on it.
    marker(&[(40.0, 150.0), (40.0, 270.0), (250.0, 270.0)], blue);
    let curve: Vec<(f32, f32)> = (0..=40)
        .map(|i| {
            let t = i as f32 / 40.0;
            (
                50.0 + t * 190.0,
                255.0 - 110.0 * (t * std::f32::consts::PI).sin(),
            )
        })
        .collect();
    marker(&curve, green);
    let circle: Vec<(f32, f32)> = (0..=24)
        .map(|i| {
            let angle = i as f32 / 24.0 * std::f32::consts::TAU;
            (145.0 + 12.0 * angle.cos(), 145.0 + 12.0 * angle.sin())
        })
        .collect();
    marker(&circle, red);
    // A list on the right.
    for row in 0..4 {
        let y = 160.0 + row as f32 * 28.0;
        marker(&[(290.0, y), (298.0, y)], red);
        marker(&[(312.0, y), (360.0, y + 4.0), (420.0, y - 2.0)], blue);
    }
    let mut raw = Vec::with_capacity((width * 3 + 1) * height);
    for row in pixels.chunks(width) {
        raw.push(0);
        raw.extend(row.iter().flatten());
    }
    let mut header = Vec::new();
    header.extend_from_slice(&(width as u32).to_be_bytes());
    header.extend_from_slice(&(height as u32).to_be_bytes());
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
const PDF_LINE: usize = 52;

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
            "0.13 0.25 0.55 rg 0 672 612 120 re f\n0.96 0.78 0.2 rg 0 664 612 8 re f\n\
             1 1 1 rg BT /F1 26 Tf 40 722 Td ({heading}) Tj ET\n\
             0.1 0.1 0.1 rg BT /F1 17 Tf 40 620 Td 26 TL\n"
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
