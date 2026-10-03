//! What the seed data says: three courses as a student would have them, with lectures
//! transcribed minute by minute, slides read page by page, articles saved from the web
//! section by section, and the study material, answers and quiz made from them, each
//! citing the passages it rests on. The words are written for these samples.

use super::seed::{Attachment, Conversation, Made, MadeBody, Outcome, Web};
use crate::processing::ExtractorKind;
use crate::{ArtifactKind, ErrorKind, PracticeAnswer, PracticeBody, Verdict, WrittenQuestion};

/// The courses, oldest first, so the newest is listed first, with their exams in days
/// from today.
pub(super) const COURSES: [(&str, Option<i64>); 3] = [
    ("Linear algebra", Some(5)),
    ("Roman history", None),
    ("Cell biology", Some(12)),
];

/// The course the seeded quiz is over.
pub(super) const QUIZ_COURSE: &str = "Cell biology";

const MITOSIS_LECTURE: &[&str] = &[
    "Okay, let's get started. Today is cell division, and specifically mitosis, which is how one eukaryotic cell becomes two genetically identical daughter cells.",
    "Before a cell divides it spends most of its life in interphase: G1, S and G2. In S phase the DNA is replicated, so each chromosome now has two sister chromatids joined at the centromere.",
    "Mitosis itself has four phases: prophase, metaphase, anaphase and telophase. Some textbooks add prometaphase between prophase and metaphase; I'll mention it, but we'll work with four.",
    "In prophase the chromatin condenses into visible chromosomes, the nucleolus disappears, and the centrosomes move to opposite poles and start building the spindle.",
    "By the end of prophase, or prometaphase if you're counting it, the nuclear envelope breaks down and spindle microtubules attach to the kinetochores on each centromere.",
    "Metaphase is the easy one to recognise under the microscope: all the chromosomes line up along the middle of the cell, on what we call the metaphase plate.",
    "There's a checkpoint here, the spindle assembly checkpoint. The cell won't move on to anaphase until every kinetochore is attached. That's what stops a daughter cell ending up with the wrong number of chromosomes.",
    "In anaphase the cohesin holding the sister chromatids together is cut by an enzyme called separase, and the chromatids are pulled to opposite poles. From that moment each chromatid counts as a chromosome in its own right.",
    "Telophase is roughly prophase in reverse: nuclear envelopes re-form around each set of chromosomes, the chromosomes decondense, and the nucleoli come back.",
    "Cytokinesis usually overlaps with telophase. In animal cells a contractile ring of actin pinches the cell in two, the cleavage furrow; plant cells build a cell plate instead. For the exam, be able to put the phases in order and say what happens in each.",
];

const MITOSIS_SLIDES: &[&str] = &[
    "Cell division — BIO 120, week 6\nLearning goals: name the stages of the cell cycle; describe each phase of mitosis; compare cytokinesis in animal and plant cells.",
    "The cell cycle\nInterphase (G1 → S → G2) → Mitosis → Cytokinesis\nAbout 90% of a dividing cell's time is spent in interphase. DNA is replicated in S phase.",
    "Prophase and prometaphase\n• Chromatin condenses into chromosomes\n• Spindle forms from the centrosomes\n• Nuclear envelope fragments\n• Microtubules attach at the kinetochores",
    "Metaphase\n• Chromosomes aligned on the metaphase plate\n• Spindle assembly checkpoint: anaphase waits until every kinetochore is attached under tension",
    "Anaphase and telophase\n• Separase cleaves cohesin\n• Sister chromatids move to opposite poles\n• Nuclear envelopes re-form; chromosomes decondense",
    "Cytokinesis\nAnimal cells: an actin–myosin contractile ring forms a cleavage furrow.\nPlant cells: vesicles from the Golgi build a cell plate, which becomes the new cell wall.",
];

const MITOSIS_ARTICLE: &[&str] = &[
    "Mitosis is the part of the cell cycle in which replicated chromosomes are separated into two new nuclei. It produces genetically identical cells in which the number of chromosomes is kept the same.",
    "The process is usually divided into prophase, prometaphase, metaphase, anaphase and telophase, and is followed by cytokinesis, which divides the cytoplasm, organelles and cell membrane.",
    "Mistakes in mitosis can leave cells with too many or too few chromosomes, a condition called aneuploidy, which is common in cancer cells.",
    "Plant cells have no centrioles, so their spindle forms without centrosomes, and during cytokinesis a cell plate grows between the two daughter nuclei.",
    "In a typical human cell growing in culture, mitosis takes about an hour, while the whole cell cycle takes around 24 hours.",
];

const MEMBRANE_TUTORIAL: &[&str] = &[
    "Right, membranes. The plasma membrane is a phospholipid bilayer: hydrophilic heads facing out, hydrophobic tails in the middle, with proteins floating in it. That's the fluid mosaic model.",
    "Because the middle is hydrophobic, small nonpolar molecules like oxygen and carbon dioxide diffuse straight through. Ions and large polar molecules like glucose can't.",
    "Diffusion is movement down a concentration gradient, from high to low, and it's passive: no ATP. Facilitated diffusion is still passive but goes through a protein, either a channel or a carrier.",
    "Osmosis is the diffusion of water across a selectively permeable membrane, towards the side with more solute. Aquaporins are channel proteins that let water through much faster.",
    "Tonicity: in a hypotonic solution an animal cell swells and can burst; in a hypertonic one it shrivels. Plant cells in a hypotonic solution become turgid, which is what you want, because the cell wall stops them bursting.",
    "Active transport moves things against their gradient, so it costs energy. The classic example is the sodium–potassium pump: for each ATP it pumps three sodium ions out and two potassium ions in.",
    "Secondary active transport uses a gradient the pump already built. The sodium–glucose cotransporter in your gut lets sodium flow back in and drags glucose in with it.",
    "Large things go in bulk. Endocytosis brings material in by folding the membrane into a vesicle; exocytosis fuses vesicles with the membrane to release what's inside, which is how neurotransmitters get out.",
];

const MEMBRANE_ARTICLE: &[&str] = &[
    "Plasma membranes are selectively permeable: they let some substances through easily, others only with help, and some not at all.",
    "In passive transport, substances move from an area of higher concentration to one of lower concentration, and the cell spends no energy.",
    "Facilitated transport uses integral membrane proteins, channels or carriers, to move substances that cannot cross the hydrophobic interior of the bilayer.",
    "Osmosis moves water from a region of low solute concentration to one of high solute concentration, until the concentrations on both sides even out.",
];

const SEMINAR_NOTES: &[&str] = &[
    "Seminar 4 — the crisis of the Republic (133–27 BC). Tiberius Gracchus, tribune in 133 BC, proposes land reform and is killed by senators: the first political murder in Rome for centuries. Violence becomes a political tool.",
    "Marius (consul 107 BC) recruits landless volunteers, paid and equipped by the state. Soldiers are now loyal to their general, who has to find them land when they are discharged.",
    "Sulla marches on Rome in 88 BC; dictator 82–80 BC; proscriptions. The precedent: an army can be turned against the state. Caesar follows the example.",
];

const REPUBLIC_ARTICLE: &[&str] = &[
    "The crisis of the Roman Republic was a long period of political instability and social unrest, from about 134 BC to 44 BC, that ended with the Republic replaced by the Principate.",
    "Large estates worked by slaves pushed small farmers off the land, which shrank the pool of property owners eligible to serve in the legions.",
    "As armies became professional and depended on their commanders for pay and land, generals could turn them into personal political forces.",
    "In 60 BC Pompey, Crassus and Caesar formed an informal alliance, later called the First Triumvirate, to push their interests past the Senate.",
];

const CAESAR_LECTURE: &[&str] = &[
    "Last week we left off with the First Triumvirate. Today: how it falls apart, and how Caesar ends up crossing the Rubicon in January 49 BC.",
    "Crassus dies at Carrhae in 53 BC, fighting the Parthians. Julia, Caesar's daughter and Pompey's wife, died the year before. So the two personal links holding Pompey and Caesar together are gone.",
    "Meanwhile Caesar has been in Gaul since 58 BC. The Gallic Wars give him wealth, fame and, crucially, a battle-hardened army that is loyal to him personally.",
    "His command is due to end, and as a private citizen he could be prosecuted for what he did as consul in 59. So he wants to stand for a second consulship in absentia, without coming back to Rome first.",
    "The Senate, now backing Pompey, orders him to give up his army. On 10 January 49 BC he crosses the Rubicon, the river marking the edge of his province, with one legion. Bringing an army into Italy is treason. Hence 'alea iacta est', the die is cast.",
    "Pompey and much of the Senate leave Italy. Civil war follows; Caesar wins at Pharsalus in 48 BC, and Pompey is murdered in Egypt.",
    "Caesar becomes dictator, dictator for life in 44 BC, and is assassinated on the Ides of March that year. Keep in mind: the Republic doesn't end then, but the precedent of one man with an army above the law is complete.",
];

const RUBICON_ARTICLE: &[&str] = &[
    "In January 49 BC Julius Caesar led a single legion across the Rubicon, a river in northern Italy that marked the boundary between the province of Cisalpine Gaul and Italy proper.",
    "Roman law forbade a provincial governor to bring his army into Italy, so the crossing was an act of insurrection that made civil war unavoidable.",
    "The phrase 'crossing the Rubicon' has come to mean passing a point of no return.",
];

const EIGEN_LECTURE: &[&str] = &[
    "Lecture seven, eigenvalues and eigenvectors. Most vectors change direction when you multiply them by a matrix. The special ones that don't are the eigenvectors.",
    "Definition: a nonzero vector v is an eigenvector of a square matrix A if Av equals lambda v for some scalar lambda, and that lambda is the eigenvalue.",
    "To find them, rewrite Av = λv as (A − λI)v = 0. For a nonzero solution, A − λI has to be singular, so its determinant is zero. det(A − λI) = 0 is the characteristic equation.",
    "Example: A = [[2, 1], [1, 2]]. Then det(A − λI) = (2 − λ)² − 1 = λ² − 4λ + 3, so λ = 1 and λ = 3.",
    "For λ = 3, A − 3I = [[−1, 1], [1, −1]], so v = (1, 1). For λ = 1, v = (1, −1). Check: A times (1, 1) is (3, 3). Good.",
    "Two facts worth memorising: the sum of the eigenvalues equals the trace, and their product equals the determinant. Here 1 + 3 = 4, the trace, and 1 × 3 = 3, the determinant.",
    "If an n by n matrix has n linearly independent eigenvectors, it's diagonalizable: A = PDP⁻¹, with the eigenvectors as the columns of P and the eigenvalues on the diagonal of D.",
    "Why we care: powers become easy. A^k = P D^k P⁻¹, and D^k just raises each eigenvalue to the k. That's how we'll handle Markov chains next week.",
];

const EIGEN_CHAPTER: &[&str] = &[
    "Chapter 6 — Eigenvalues and Eigenvectors\n6.1 Introduction. Ax = λx: the eigenvectors keep their direction, and λ says how much they are stretched.",
    "The characteristic polynomial\ndet(A − λI) is a polynomial of degree n in λ. Its n roots, counted with multiplicity and possibly complex, are the eigenvalues.",
    "Trace and determinant\nλ₁ + … + λₙ = trace(A) = a₁₁ + … + aₙₙ\nλ₁ · … · λₙ = det(A)\nA triangular matrix has its eigenvalues on its diagonal.",
    "6.2 Diagonalizing a matrix\nIf A has n independent eigenvectors, then S⁻¹AS = Λ. Not every matrix can be diagonalized: [[0, 1], [0, 0]] has only one line of eigenvectors.",
];

/// The mitosis lecture as a diagram of cards, citing the recording `[1]` and the slides
/// `[2]` (which the quiz cites too), then each phase.
const MITOSIS_DIAGRAM: &str = r#"flowchart TD
    cycle(["Cell cycle<br>- Interphase: G1, S, G2 [2]<br>- DNA replicated in S phase [2]"])
    mitosis["Mitosis<br>- Four phases [1]<br>- Two identical daughter cells [1]"]
    prophase["Prophase<br>- Chromatin condenses into chromosomes [3]<br>- Spindle forms from the centrosomes [3]"]
    metaphase["Metaphase<br>- Chromosomes line up on the metaphase plate [4]<br>- Spindle checkpoint waits for every kinetochore [5]"]
    anaphase["Anaphase<br>- Separase cuts cohesin [6]<br>- Chromatids pulled to opposite poles [6]"]
    telophase["Telophase<br>- Nuclear envelopes re-form [7]<br>- Chromosomes decondense [7]"]
    cytokinesis(("Cytokinesis<br>- Animal cells: cleavage furrow [8]<br>- Plant cells: cell plate [8]"))
    cycle -->|then| mitosis
    mitosis --> prophase --> metaphase --> anaphase --> telophase
    telophase -->|overlaps| cytokinesis
"#;

const MEMBRANE_NOTES: &str = "## The membrane
- **Fluid mosaic model**: a phospholipid bilayer with proteins floating in it [1]
- Small nonpolar molecules (O₂, CO₂) cross directly; ions and glucose cannot [2]

## Passive transport
- **Diffusion**: down the concentration gradient, no ATP [3]
- **Facilitated diffusion**: still passive, through a **channel** or **carrier** protein [3][9]
- **Osmosis**: water moves towards the side with more solute [4]; **aquaporins** speed it up [4]

## Tonicity
- **Hypotonic**: animal cells swell and may burst; plant cells become **turgid** [5]
- **Hypertonic**: cells shrivel [5]

## Active transport
- Against the gradient, so it costs energy [6]
- **Na⁺/K⁺ pump**: 3 Na⁺ out, 2 K⁺ in, per ATP [6]
- **Secondary active transport**: the Na⁺–glucose cotransporter rides the sodium gradient [7]

## Bulk transport
- **Endocytosis** brings material in by vesicle; **exocytosis** releases it, as with neurotransmitters [8]";

const REPUBLIC_NOTES: &str = "## Why the Republic was in crisis
- A long period of instability, about **134–44 BC**, ending in the Principate [3]
- Slave-worked estates pushed small farmers off the land, shrinking the pool of soldiers [4]

## Violence enters politics
- **Tiberius Gracchus** (tribune, 133 BC): land reform; killed by senators [1]

## Armies loyal to generals
- **Marius** (consul 107 BC) recruits landless volunteers paid by the state [2]
- Soldiers depend on their commander for pay and land [2][5]

## Sulla's precedent
- Marches on Rome in **88 BC**; dictator **82–80 BC**; proscriptions [6]
- Shows an army can be used against the state [6]

## The First Triumvirate
- **60 BC**: Pompey, Crassus and Caesar ally against the Senate [7]";

const EIGEN_NOTES: &str = "## Definition
- A nonzero **eigenvector** v of a square matrix A satisfies **Av = λv**; λ is its **eigenvalue** [1][5]
- Eigenvectors keep their direction; λ says how much they stretch [5]

## Finding them
- Solve the **characteristic equation** det(A − λI) = 0 [2]
- It is a polynomial of degree n; its roots are the eigenvalues [6]
- Example: A = [[2, 1], [1, 2]] gives λ² − 4λ + 3 = 0, so **λ = 1, 3** [3]

## Checks
- **Sum of eigenvalues = trace**; **product = determinant** [4][7]
- Triangular matrices: eigenvalues on the diagonal [7]

## Diagonalization
- n independent eigenvectors ⇒ **A = PDP⁻¹** [8]
- Powers become easy: A^k = P D^k P⁻¹ [9]
- Not always possible: [[0, 1], [0, 0]] [10]";

/// The sessions of the courses, in no particular order: each dates itself.
pub(super) fn conversations() -> Vec<Conversation> {
    vec![
        Conversation {
            project: "Cell biology",
            title: "Mitosis lecture",
            text: "Here is today's recording, the slides and the article the professor recommended. @study what are the phases of mitosis?",
            hours_ago: 30,
            attachments: vec![
                Attachment::read(
                    "lecture-mitosis.mp3",
                    ExtractorKind::Transcription,
                    MITOSIS_LECTURE,
                    612,
                ),
                Attachment::read(
                    "slides-mitosis.pdf",
                    ExtractorKind::Vision,
                    MITOSIS_SLIDES,
                    41,
                ),
                Attachment::article(
                    Web {
                        title: "Mitosis – Wikipedia",
                        url: "https://en.wikipedia.org/wiki/Mitosis",
                        sections: &["overview", "phases", "errors", "plants", "duration"],
                    },
                    MITOSIS_ARTICLE,
                ),
            ],
            answer: Some((
                "Mitosis has four phases: prophase, metaphase, anaphase and telophase, though some textbooks add prometaphase between the first two [1]. In prophase the chromatin condenses into chromosomes and the spindle forms [2], and on the slides mitosis sits between interphase and cytokinesis [3].",
                &[(0, 2), (0, 3), (1, 1)],
            )),
            thread: &[
                "Prophase starts around minute 3 of the recording.",
                "Compare with the slides: they fold prometaphase into prophase.",
            ],
            made: vec![
                Made {
                    kind: ArtifactKind::Diagram,
                    body: MadeBody::Diagram(MITOSIS_DIAGRAM),
                    cites: &[
                        (0, 2),
                        (1, 1),
                        (0, 3),
                        (0, 5),
                        (0, 6),
                        (0, 7),
                        (0, 8),
                        (1, 5),
                    ],
                },
                Made {
                    kind: ArtifactKind::Flashcards,
                    body: MadeBody::Cards(&[
                        (
                            "What does mitosis produce?",
                            "Two genetically identical daughter cells.",
                            &[1],
                        ),
                        (
                            "In which phase of interphase is the DNA replicated?",
                            "S phase.",
                            &[2],
                        ),
                        (
                            "What are the four phases of mitosis, in order?",
                            "Prophase, metaphase, anaphase, telophase.",
                            &[3],
                        ),
                        (
                            "Which extra phase do some textbooks add, and where?",
                            "Prometaphase, between prophase and metaphase.",
                            &[3],
                        ),
                        (
                            "What happens to the chromatin in prophase?",
                            "It condenses into visible chromosomes.",
                            &[4],
                        ),
                        (
                            "When does the nuclear envelope break down?",
                            "At the end of prophase (prometaphase), as microtubules attach to the kinetochores.",
                            &[5],
                        ),
                        (
                            "Where do the chromosomes line up in metaphase?",
                            "On the metaphase plate, across the middle of the cell.",
                            &[6],
                        ),
                        (
                            "What does the spindle assembly checkpoint wait for?",
                            "Every kinetochore to be attached to the spindle.",
                            &[7],
                        ),
                        (
                            "Which enzyme cuts cohesin at the start of anaphase?",
                            "Separase.",
                            &[8],
                        ),
                        (
                            "Why is telophase called prophase in reverse?",
                            "Nuclear envelopes re-form, chromosomes decondense and nucleoli return.",
                            &[9],
                        ),
                        (
                            "How do animal cells divide the cytoplasm?",
                            "A contractile ring of actin forms a cleavage furrow.",
                            &[10],
                        ),
                        (
                            "How do plant cells divide the cytoplasm?",
                            "Golgi vesicles build a cell plate, which becomes the new wall.",
                            &[11],
                        ),
                    ]),
                    cites: &[
                        (0, 0),
                        (0, 1),
                        (0, 2),
                        (0, 3),
                        (0, 4),
                        (0, 5),
                        (0, 6),
                        (0, 7),
                        (0, 8),
                        (0, 9),
                        (1, 5),
                    ],
                },
            ],
            declined: None,
        },
        Conversation {
            project: "Cell biology",
            title: "Membrane transport",
            text: "Recording of Thursday's tutorial, a voice note from Giulia, and the OpenStax section on passive transport.",
            hours_ago: 5,
            attachments: vec![
                Attachment::read(
                    "tutorial-membranes.m4a",
                    ExtractorKind::Transcription,
                    MEMBRANE_TUTORIAL,
                    488,
                ),
                Attachment::read(
                    "voice-note.ogg",
                    ExtractorKind::Transcription,
                    &[
                        "Hey, it's Giulia. Library at four tomorrow? Bring your notes, I'll bring snacks.",
                    ],
                    6,
                ),
                Attachment::article(
                    Web {
                        title: "Passive transport – Biology 2e",
                        url: "https://openstax.org/books/biology-2e/pages/5-2-passive-transport",
                        sections: &[
                            "selective-permeability",
                            "passive",
                            "facilitated",
                            "osmosis",
                        ],
                    },
                    MEMBRANE_ARTICLE,
                ),
            ],
            answer: None,
            thread: &[],
            made: vec![Made {
                kind: ArtifactKind::Notes,
                body: MadeBody::Text(MEMBRANE_NOTES),
                cites: &[
                    (0, 0),
                    (0, 1),
                    (0, 2),
                    (0, 3),
                    (0, 4),
                    (0, 5),
                    (0, 6),
                    (0, 7),
                    (2, 2),
                ],
            }],
            // Giulia's voice note alone holds nothing to draw: the writer said so.
            declined: Some((
                ArtifactKind::Diagram,
                1,
                "The voice note only arranges a time to meet; there is nothing about membranes in it to draw.",
            )),
        },
        Conversation {
            project: "Roman history",
            title: "Fall of the Republic",
            text: "My notes from the seminar and the overview article. @study why did Sulla matter?",
            hours_ago: 52,
            attachments: vec![
                Attachment::read(
                    "seminar-notes-scan.png",
                    ExtractorKind::Vision,
                    SEMINAR_NOTES,
                    14,
                ),
                Attachment {
                    file: "podcast-episode-12.mp3",
                    extractor: Some(ExtractorKind::Transcription),
                    outcome: Some(Outcome::Cancelled),
                    took: 260,
                    web: None,
                },
                Attachment::article(
                    Web {
                        title: "Crisis of the Roman Republic – Wikipedia",
                        url: "https://en.wikipedia.org/wiki/Crisis_of_the_Roman_Republic",
                        sections: &["overview", "land", "armies", "first-triumvirate"],
                    },
                    REPUBLIC_ARTICLE,
                ),
            ],
            answer: Some((
                "Your notes put it plainly: Sulla marched on Rome in 88 BC and ruled as dictator from 82 to 80 BC, showing that an army could be turned against the state [1]. That mattered because armies had become loyal to their generals, who paid them and found them land [2], so later commanders, Caesar above all, could follow his example.",
                &[(0, 2), (2, 2)],
            )),
            thread: &[],
            made: vec![Made {
                kind: ArtifactKind::Notes,
                body: MadeBody::Text(REPUBLIC_NOTES),
                cites: &[(0, 0), (0, 1), (2, 0), (2, 1), (2, 2), (0, 2), (2, 3)],
            }],
            declined: None,
        },
        Conversation {
            project: "Roman history",
            title: "Caesar crosses the Rubicon",
            text: "Lecture 9, plus a short article on the Rubicon.",
            hours_ago: 20,
            attachments: vec![
                Attachment::read(
                    "lecture-09-caesar.mp3",
                    ExtractorKind::Transcription,
                    CAESAR_LECTURE,
                    431,
                ),
                Attachment::article(
                    Web {
                        title: "Crossing the Rubicon – Wikipedia",
                        url: "https://en.wikipedia.org/wiki/Crossing_the_Rubicon",
                        sections: &["crossing", "law", "idiom"],
                    },
                    RUBICON_ARTICLE,
                ),
            ],
            answer: None,
            thread: &[],
            made: vec![Made {
                kind: ArtifactKind::Flashcards,
                body: MadeBody::Cards(&[
                    (
                        "Where and when did Crassus die?",
                        "At Carrhae in 53 BC, fighting the Parthians.",
                        &[1],
                    ),
                    (
                        "Who was Julia, and why did her death matter?",
                        "Caesar's daughter and Pompey's wife; a personal link between them was lost.",
                        &[1],
                    ),
                    (
                        "What did the Gallic Wars give Caesar?",
                        "Wealth, fame and an army loyal to him personally.",
                        &[2],
                    ),
                    (
                        "Why did Caesar want a consulship in absentia?",
                        "As a private citizen he could be prosecuted for his acts as consul in 59 BC.",
                        &[3],
                    ),
                    (
                        "When did Caesar cross the Rubicon?",
                        "10 January 49 BC, with one legion.",
                        &[4],
                    ),
                    (
                        "Why was crossing the Rubicon treason?",
                        "A governor could not bring his army into Italy.",
                        &[4, 7],
                    ),
                    (
                        "Where was Pompey defeated?",
                        "At Pharsalus, in 48 BC.",
                        &[5],
                    ),
                    (
                        "When was Caesar assassinated?",
                        "On the Ides of March, 44 BC.",
                        &[6],
                    ),
                ]),
                cites: &[(0, 1), (0, 2), (0, 3), (0, 4), (0, 5), (0, 6), (1, 1)],
            }],
            declined: None,
        },
        Conversation {
            project: "Linear algebra",
            title: "Eigenvalues",
            text: "Lecture 7, chapter 6 of the textbook and a photo of the whiteboard. @study what is an eigenvector?",
            hours_ago: 2,
            attachments: vec![
                Attachment::read(
                    "lecture-07.mp3",
                    ExtractorKind::Transcription,
                    EIGEN_LECTURE,
                    545,
                ),
                Attachment::read(
                    "textbook-chapter-6.pdf",
                    ExtractorKind::Vision,
                    EIGEN_CHAPTER,
                    37,
                ),
                Attachment {
                    file: "whiteboard-photo.jpg",
                    extractor: Some(ExtractorKind::Vision),
                    outcome: Some(Outcome::Failed {
                        kind: ErrorKind::InvalidInput,
                        error: "the language model could not read this image",
                    }),
                    took: 9,
                    web: None,
                },
            ],
            answer: Some((
                "An eigenvector of a square matrix A is a nonzero vector v with Av = λv for some scalar λ, its eigenvalue [1]: multiplying by A only stretches it, without changing its direction [2]. The whiteboard photo could not be read, so it is not used here.",
                &[(0, 1), (1, 0)],
            )),
            thread: &[],
            made: vec![
                Made {
                    kind: ArtifactKind::Notes,
                    body: MadeBody::Text(EIGEN_NOTES),
                    cites: &[
                        (0, 1),
                        (0, 2),
                        (0, 3),
                        (0, 5),
                        (1, 0),
                        (1, 1),
                        (1, 2),
                        (0, 6),
                        (0, 7),
                        (1, 3),
                    ],
                },
                Made {
                    kind: ArtifactKind::Flashcards,
                    body: MadeBody::Cards(&[
                        (
                            "What is an eigenvector of A?",
                            "A nonzero vector v with Av = λv for some scalar λ.",
                            &[1],
                        ),
                        (
                            "What equation gives the eigenvalues?",
                            "The characteristic equation, det(A − λI) = 0.",
                            &[2],
                        ),
                        (
                            "Why must A − λI be singular?",
                            "(A − λI)v = 0 needs a nonzero solution v.",
                            &[2],
                        ),
                        (
                            "What are the eigenvalues of [[2, 1], [1, 2]]?",
                            "1 and 3.",
                            &[3],
                        ),
                        (
                            "What is an eigenvector of [[2, 1], [1, 2]] for λ = 3?",
                            "(1, 1).",
                            &[4],
                        ),
                        (
                            "What do the eigenvalues add up to?",
                            "The trace of A.",
                            &[5],
                        ),
                        (
                            "What do the eigenvalues multiply to?",
                            "The determinant of A.",
                            &[5],
                        ),
                        (
                            "When is an n×n matrix diagonalizable?",
                            "When it has n linearly independent eigenvectors.",
                            &[6],
                        ),
                        (
                            "How does diagonalization make A^k easy?",
                            "A^k = P D^k P⁻¹, and D^k raises each eigenvalue to the k.",
                            &[7],
                        ),
                        (
                            "Give a matrix that cannot be diagonalized.",
                            "[[0, 1], [0, 0]].",
                            &[8],
                        ),
                    ]),
                    cites: &[
                        (0, 1),
                        (0, 2),
                        (0, 3),
                        (0, 4),
                        (0, 5),
                        (0, 6),
                        (0, 7),
                        (1, 3),
                    ],
                },
            ],
            declined: None,
        },
        // What was queued or running when the app last closed. Nothing runs until the app is
        // open, so these show as stopped and can be started from the Pipelines page.
        Conversation {
            project: "Linear algebra",
            title: "Exam revision",
            text: "Everything for the revision week.",
            hours_ago: 3,
            attachments: ["lecture-08.mp3", "office-hours.m4a"]
                .into_iter()
                .map(|file| Attachment::stopped(file, ExtractorKind::Transcription))
                .chain([Attachment::stopped(
                    "formula-sheet.pdf",
                    ExtractorKind::Vision,
                )])
                .collect(),
            answer: None,
            thread: &[],
            made: Vec::new(),
            declined: None,
        },
        Conversation {
            project: "Linear algebra",
            title: "Study plan",
            text: "Plan for the exam: chapters 5 to 8, then past papers.",
            hours_ago: 1,
            attachments: ["study-plan.md", "grades.csv"]
                .into_iter()
                .map(Attachment::unread)
                .collect(),
            answer: None,
            thread: &[],
            made: Vec::new(),
            declined: None,
        },
    ]
}

/// A seeded practice question, with the student's answer and, for an open one, its grade.
pub(super) type SeededQuestion = (
    WrittenQuestion,
    Option<(PracticeAnswer, Option<(Verdict, &'static str)>)>,
);

/// The questions of the seeded quiz about mitosis, in the order the quiz asks their kinds:
/// two answered choices, an open answer graded as partly right, and two waiting. They cite
/// the mitosis diagram's passages: `[1]` the recording, `[2]` the slides.
pub(super) fn practice_questions() -> Vec<SeededQuestion> {
    let written = |gist: &str, body: PracticeBody| WrittenQuestion {
        gist: gist.to_owned(),
        body,
    };
    let choice = |gist: &str,
                  question: &str,
                  choices: [&str; 4],
                  answer: u32,
                  explanation: &str,
                  cite: u32| {
        written(
            gist,
            PracticeBody::Choice {
                question: question.to_owned(),
                choices: choices.map(str::to_owned).to_vec(),
                answer,
                explanation: explanation.to_owned(),
                cites: vec![cite],
            },
        )
    };
    vec![
        (
            choice(
                "Number of mitosis phases in the lecture",
                "How many phases of mitosis does the lecture work with?",
                ["Two", "Three", "Four", "Six"],
                2,
                "Prophase, metaphase, anaphase and telophase; prometaphase is mentioned but not counted.",
                1,
            ),
            Some((PracticeAnswer::Choice(2), None)),
        ),
        (
            choice(
                "Share of the cycle spent in interphase",
                "According to the slides, roughly how much of a dividing cell's time is spent in interphase?",
                ["About 10%", "About 50%", "About 75%", "About 90%"],
                3,
                "The cell cycle slide says about 90% of the time is spent in interphase.",
                2,
            ),
            Some((PracticeAnswer::Choice(1), None)),
        ),
        (
            written(
                "Why the lecture works with four phases",
                PracticeBody::Open {
                    question: "The lecture mentions prometaphase but works with four phases of mitosis. Which four, and where would prometaphase fit?"
                        .to_owned(),
                    reference: "Prophase, metaphase, anaphase and telophase; prometaphase falls between prophase and metaphase, when the nuclear envelope breaks down."
                        .to_owned(),
                    cites: vec![1],
                },
            ),
            Some((
                PracticeAnswer::Open("Prophase, metaphase, anaphase, telophase.".to_owned()),
                Some((
                    Verdict::Partly,
                    "Right: those are the four phases, in order. Missing is where prometaphase fits: between prophase and metaphase.",
                )),
            )),
        ),
        (
            choice(
                "What the slides list after mitosis",
                "On the cell cycle slide, what follows mitosis?",
                ["Interphase", "S phase", "Cytokinesis", "G2"],
                2,
                "The slide reads: interphase, then mitosis, then cytokinesis.",
                2,
            ),
            None,
        ),
        (
            choice(
                "The lecture's last phase of mitosis",
                "Which phase ends mitosis in the lecture?",
                ["Prophase", "Metaphase", "Anaphase", "Telophase"],
                3,
                "Telophase is the last of the four phases the lecture names.",
                1,
            ),
            None,
        ),
    ]
}
