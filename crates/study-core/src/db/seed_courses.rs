//! What the seed data says: five courses as a student would have them, with lectures
//! transcribed minute by minute, slides read page by page, articles saved from the web
//! section by section, and the study material, answers and quiz made from them, each
//! citing the passages it rests on. The words are written for these samples.

use super::seed::{Attachment, Conversation, Made, MadeBody, Outcome, Sample, Web};
use crate::processing::ExtractorKind;
use crate::{ArtifactKind, ErrorKind, PracticeAnswer, PracticeBody, Verdict, WrittenQuestion};

/// The courses, oldest first, so the newest is listed first, with their exams in days
/// from today.
pub(super) const COURSES: [(&str, Option<i64>); 5] = [
    ("Microeconomics", None),
    ("Organic chemistry", Some(8)),
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

const CELL_CYCLE_LECTURE: &[&str] = &[
    "Welcome back. Before we look at mitosis in detail, the big picture: every cell that divides goes through the cell cycle, a repeating sequence of growth, DNA replication and division.",
    "The cycle has two big parts. Interphase is when the cell grows and copies its DNA; the M phase is when it divides. Interphase is subdivided into G1, S and G2.",
    "G1 is the first gap, a period of growth and normal function. S is the synthesis phase, when the DNA is copied. G2 is the second gap, when the cell checks the copy and prepares to divide.",
    "Cells that stop dividing leave the cycle and enter G0. Most of your neurons are in G0 permanently, while skin cells keep cycling.",
    "Progress is controlled by checkpoints, at the end of G1, at the end of G2 and during mitosis, driven by proteins called cyclins and the kinases they activate, the CDKs.",
];

const EARLY_REPUBLIC_LECTURE: &[&str] = &[
    "Today: how Rome became a republic, and how it was governed once it was. Tradition says the last king, Tarquin the Proud, was expelled in 509 BC.",
    "Power was split. Two consuls, elected each year, held the highest office, and each could veto the other. The annual term and the colleague were both deliberate limits on power.",
    "The Senate, made up of former magistrates, advised the consuls and in practice controlled finances and foreign policy. It had no formal power to make law, but its authority was great.",
    "For the first two centuries the plebeians, the ordinary citizens, struggled with the patricians for political rights. The plebeians' weapon was the secession: they simply walked out.",
    "This conflict of the orders produced the tribunes of the plebs, with the power to veto magistrates' acts, and in 287 BC the plebiscites passed by the plebeian assembly became binding on everyone.",
];

const GRACCHI_PODCAST: &[&str] = &[
    "Welcome to the show. This week: the Gracchi brothers, and why two reforming tribunes ended up dead in the street.",
    "Tiberius Gracchus wanted public land, which the rich had been occupying, redistributed to poor citizens, who would then be eligible for the army.",
    "The Senate saw a threat. In 133 BC a mob of senators beat him to death, and the taboo against political violence was broken.",
    "His brother Gaius tried again a decade later, and he too died, in 121 BC. After that, violence in Roman politics was no longer unthinkable.",
];

const DETERMINANT_LECTURE: &[&str] = &[
    "Lecture five. Determinants. A determinant is a single number you can compute from a square matrix, and it tells you a surprising amount about the matrix.",
    "For a two by two matrix with rows a, b and c, d, the determinant is ad minus bc. For three by three we expand along a row, with alternating signs.",
    "Geometrically, the absolute value of the determinant is the factor by which the matrix scales areas, or volumes in higher dimensions. A negative sign means orientation is flipped.",
    "The key fact: a square matrix is invertible exactly when its determinant is not zero. A zero determinant means the columns are linearly dependent and the matrix squashes space into a lower dimension.",
    "Two rules to remember: the determinant of AB is the determinant of A times the determinant of B, and swapping two rows flips the sign of the determinant.",
];

const WHITEBOARD: &[&str] = &[
    "A = [[2, 1], [1, 2]]. det(A − λI) = λ² − 4λ + 3 = (λ − 1)(λ − 3). λ = 1: v = (1, −1). λ = 3: v = (1, 1). Trace 4 = 1 + 3; determinant 3 = 1 × 3.",
];

const ALKANE_LECTURE: &[&str] = &[
    "Welcome to organic chemistry. Today: alkanes, the simplest hydrocarbons, and how we name organic compounds so that everyone draws the same molecule from the same name.",
    "Alkanes contain only carbon and hydrogen, joined by single bonds. They are saturated, with the general formula CnH2n+2: methane CH4, ethane C2H6, propane C3H8, butane C4H10.",
    "To name a branched alkane, first find the longest continuous carbon chain; that gives the parent name. Number the chain from the end that gives the substituents the lowest numbers.",
    "Substituents are named as prefixes in alphabetical order, with a number for each position. So a methyl group on carbon 2 of a butane chain makes 2-methylbutane, which is an isomer of pentane.",
    "Each carbon in an alkane is sp3 hybridized, with bond angles of about 109.5 degrees. Rotation around a carbon–carbon single bond is free, which gives different conformations, such as staggered and eclipsed.",
    "Staggered conformations are lower in energy than eclipsed ones because the hydrogens on neighboring carbons are as far apart as possible. In butane, the anti conformation, with the two methyl groups opposite each other, is the most stable.",
];

const ALKANE_SLIDES: &[&str] = &[
    "Alkanes and nomenclature — CHEM 210, week 2\nGoals: name branched alkanes; draw conformations; relate structure to stability.",
    "Naming alkanes (IUPAC)\n1. Find the longest carbon chain\n2. Number from the end nearest the first branch\n3. Name substituents alphabetically, with locants\nExample: 2-methylbutane",
    "Conformations of ethane\nStaggered: lowest energy\nEclipsed: about 12 kJ/mol higher\nRotation about the C–C bond is fast at room temperature.",
    "Conformations of butane\nAnti: most stable\nGauche: about 3.8 kJ/mol higher\nEclipsed forms are the energy maxima.",
];

const SUBSTITUTION_LECTURE: &[&str] = &[
    "Today: nucleophilic substitution. A nucleophile, an electron-rich species, replaces a leaving group on a carbon. There are two mechanisms, SN2 and SN1, and the skill is knowing which one you are looking at.",
    "SN2 is a single concerted step: the nucleophile attacks from the back side as the leaving group departs. The rate depends on both the substrate and the nucleophile, so it is second order overall.",
    "Because of the back-side attack, SN2 inverts the stereochemistry at the carbon, like an umbrella turning inside out. It works best on methyl and primary substrates, and is blocked on tertiary ones by steric hindrance.",
    "SN1 has two steps. First the leaving group leaves, giving a carbocation; then the nucleophile attacks. The first step is slow, so the rate depends only on the substrate: first order.",
    "The carbocation is planar, so the nucleophile can attack from either face and you get a mixture of both stereoisomers, a racemic product. SN1 favours tertiary substrates because tertiary carbocations are the most stable.",
    "Solvent matters. Polar protic solvents such as water and ethanol stabilize the carbocation and the leaving group, so they favour SN1. Polar aprotic solvents such as acetone or DMSO leave the nucleophile unsolvated and strong, so they favour SN2.",
    "A good leaving group is a weak base: iodide, bromide and tosylate are good; hydroxide is terrible. Strong nucleophile plus primary substrate: think SN2. Weak nucleophile plus tertiary substrate in a protic solvent: SN1.",
];

const SUBSTITUTION_CHAPTER: &[&str] = &[
    "Chapter 7 — Nucleophilic Substitution\n7.1 Substitution at saturated carbon: a nucleophile replaces a leaving group.",
    "Comparing the mechanisms\nSN2: rate = k[RX][Nu]; inversion; methyl > primary > secondary\nSN1: rate = k[RX]; racemization; tertiary > secondary",
    "Leaving groups\nGood: I−, Br−, Cl−, TsO−\nPoor: HO−, RO−, H2N−\nThe stronger a base a species is, the worse it leaves.",
];

const SN2_ARTICLE: &[&str] = &[
    "The SN2 reaction is a type of nucleophilic substitution in which a lone pair of electrons on a nucleophile attacks an electron-deficient center and bonds to it, expelling a leaving group.",
    "Because the nucleophile attacks from the side opposite the leaving group, the reaction proceeds with inversion of configuration, known as the Walden inversion.",
    "Steric hindrance slows the reaction: methyl and primary halides react fastest, while tertiary halides do not undergo SN2 in practice.",
];

const ORGANIC_NOTES: &str = "## Alkanes
- Only C and H, single bonds only: **saturated**, formula **CnH2n+2** [1]
- Methane, ethane, propane, butane: CH₄, C₂H₆, C₃H₈, C₄H₁₀ [1]

## Naming (IUPAC)
- Find the **longest chain**: it is the parent [2]
- Number from the end that gives the **lowest numbers** to substituents [2][6]
- Prefixes go in **alphabetical order**, each with a position number [3]
- 2-methylbutane is an isomer of pentane [3]

## Shape and conformations
- Each carbon is **sp³**, bond angles about **109.5°** [4]
- Free rotation about C–C gives **staggered** and **eclipsed** conformations [4]
- Staggered is lower in energy; eclipsed ethane is about **12 kJ/mol** higher [5][7]
- Butane: **anti** is the most stable [5]; gauche is about 3.8 kJ/mol higher [8]";

const SUPPLY_LECTURE: &[&str] = &[
    "Welcome to microeconomics. We start with the model that everything else builds on: supply and demand. A market is a place where buyers and sellers meet, and the model asks what price clears it.",
    "The law of demand says that, other things equal, a higher price lowers the quantity demanded, so the demand curve slopes down. The law of supply says the opposite for sellers: a higher price raises the quantity supplied.",
    "The market is in equilibrium where the two curves cross. At that price the quantity demanded equals the quantity supplied, and nobody who wants to trade at that price is left out.",
    "Above the equilibrium price there is a surplus: sellers want to sell more than buyers want to buy, so the price falls. Below it there is a shortage, and the price rises.",
    "Careful with the difference between a movement along a curve and a shift of the curve. A change in the price moves you along the curve. A change in income, tastes, or the price of a related good shifts the whole curve.",
    "Example: if a frost destroys part of the coffee harvest, the supply curve shifts left. The equilibrium price rises and the quantity traded falls.",
];

const SUPPLY_CHART: &[&str] = &[
    "Supply and demand for coffee. The demand curve D slopes down and the supply curve S slopes up; they cross at the equilibrium, price 6 and quantity 40. A price above 6 leaves a surplus.",
];

const SUPPLY_NOTES: &str = "## The model
- **Law of demand**: higher price, lower quantity demanded; **law of supply**: higher price, higher quantity supplied [1]
- **Equilibrium** where the curves cross: quantity demanded equals quantity supplied [2][6]

## Out of equilibrium
- **Surplus** above the equilibrium price pushes the price down; **shortage** below it pushes the price up [3]

## Movement or shift?
- A price change **moves along** a curve [4]
- Income, tastes, or the price of related goods **shift** the curve [4]
- Example: a frost cuts the coffee harvest, **supply shifts left**, price rises and quantity falls [5]";

const ELASTICITY_LECTURE: &[&str] = &[
    "Last time we saw that demand slopes down. Today: by how much? Price elasticity of demand measures how strongly the quantity demanded responds to a change in price.",
    "It is the percentage change in quantity demanded divided by the percentage change in price. Because demand slopes down it is negative, but we usually quote the absolute value.",
    "If the elasticity is greater than one, demand is elastic: quantity responds more than proportionally to price. Below one, demand is inelastic. Exactly one is unit elastic.",
    "What makes demand elastic? Close substitutes, goods that are luxuries rather than necessities, and a long time to adjust. Insulin has inelastic demand; one brand of cereal has elastic demand.",
    "Elasticity tells you what a price rise does to revenue. If demand is elastic, raising the price lowers total revenue. If it is inelastic, raising the price raises total revenue.",
    "Income elasticity works the same way: the percentage change in quantity per percentage change in income. Normal goods have positive income elasticity; inferior goods, like instant noodles, have negative.",
];

const ELASTICITY_ARTICLE: &[&str] = &[
    "Price elasticity of demand is a measure of the sensitivity of the quantity demanded to a change in the price of a good, other things held constant.",
    "Demand is called elastic when the absolute value of the elasticity is greater than one, and inelastic when it is less than one.",
    "When demand is inelastic, a price increase raises total revenue; when it is elastic, a price increase reduces it.",
];

/// The mitosis lecture as a tree of cards, citing the recording and the slides (which the
/// quiz cites too: `[1]` the recording, `[2]` the slides), then each phase.
const MITOSIS_DIAGRAM: &str = r#"flowchart TD
    cycle(["Cell cycle<br>- Interphase, mitosis, cytokinesis [2]"])
    interphase["Interphase<br>- Most of the cell's time [2]"]
    mitosis["Mitosis<br>- Four phases [1]<br>- Two identical cells [1]"]
    cytokinesis["Cytokinesis<br>- Splits the cytoplasm [9]"]
    g1["G1<br>- Growth"]
    s["S phase<br>- DNA replicated [10]"]
    g2["G2<br>- Final checks"]
    prophase["Prophase<br>- Chromosomes condense [3]<br>- Spindle forms [3]"]
    metaphase["Metaphase<br>- Chromosomes line up [4]<br>- Spindle checkpoint [5]"]
    anaphase["Anaphase<br>- Separase cuts cohesin [6]<br>- Chromatids pulled apart [6]"]
    telophase["Telophase<br>- Envelopes re-form [7]"]
    animal["Animal cells<br>- Cleavage furrow [8]"]
    plant["Plant cells<br>- Cell plate [8]"]
    cycle --> interphase & mitosis & cytokinesis
    interphase --> g1 & s & g2
    mitosis --> prophase & metaphase & anaphase & telophase
    cytokinesis --> animal & plant
"#;

const MITOSIS_DIAGRAM_CITES: &[(usize, usize)] = &[
    (0, 2),
    (1, 1),
    (0, 3),
    (0, 5),
    (0, 6),
    (0, 7),
    (0, 8),
    (1, 5),
    (0, 9),
    (0, 1),
];

/// Nucleophilic substitution as a tree: the two mechanisms and what decides between them.
const SUBSTITUTION_DIAGRAM: &str = r#"flowchart TD
    root(["Nucleophilic substitution<br>- A nucleophile replaces a leaving group [1]"])
    sn2["SN2<br>- One concerted step [2]"]
    sn1["SN1<br>- Two steps, via a carbocation [4]"]
    factors["What decides"]
    sn2rate["Rate<br>- Second order [8]"]
    sn2stereo["Stereochemistry<br>- Inversion [3]"]
    sn2substrate["Substrate<br>- Methyl and primary [3]"]
    sn1rate["Rate<br>- First order [8]"]
    sn1stereo["Stereochemistry<br>- Racemic product [5]"]
    sn1substrate["Substrate<br>- Tertiary favoured [5]"]
    solvent["Solvent<br>- Protic favours SN1 [6]<br>- Aprotic favours SN2 [6]"]
    leaving["Leaving group<br>- Weak bases leave best [7]<br>- Iodide, bromide, tosylate [9]"]
    root --> sn2 & sn1 & factors
    sn2 --> sn2rate & sn2stereo & sn2substrate
    sn1 --> sn1rate & sn1stereo & sn1substrate
    factors --> solvent & leaving
"#;

/// Elasticity as a tree: how it is measured, and what elastic and inelastic demand mean.
const ELASTICITY_DIAGRAM: &str = r#"flowchart TD
    root(["Price elasticity of demand<br>- How quantity responds to price [1]"])
    measure["Measure<br>- Percent change in quantity over percent change in price [2]"]
    elastic["Elastic<br>- Above one [3]"]
    inelastic["Inelastic<br>- Below one [3]"]
    income["Income elasticity<br>- The same idea for income [6]"]
    elasticwhy["Why<br>- Close substitutes [4]<br>- Long time to adjust [4]"]
    elasticrevenue["Raise the price<br>- Revenue falls [5]"]
    inelasticwhy["Why<br>- Necessities, like insulin [4]"]
    inelasticrevenue["Raise the price<br>- Revenue rises [5]"]
    normal["Normal goods<br>- Positive [6]"]
    inferior["Inferior goods<br>- Negative [6]"]
    root --> measure & elastic & inelastic & income
    elastic --> elasticwhy & elasticrevenue
    inelastic --> inelasticwhy & inelasticrevenue
    income --> normal & inferior
"#;

/// The road to the Rubicon as a tree.
const RUBICON_DIAGRAM: &str = r#"flowchart TD
    root(["First Triumvirate<br>- Pompey, Crassus and Caesar [1]"])
    breakdown["Personal ties lost"]
    gaul["Caesar in Gaul<br>- Since 58 BC [3]"]
    ultimatum["Ultimatum<br>- The Senate backs Pompey [5]"]
    crassus["Crassus<br>- Dies at Carrhae, 53 BC [2]"]
    julia["Julia<br>- Caesar's daughter, Pompey's wife [2]"]
    wealth["Wealth and fame [3]"]
    army["A loyal army [3]"]
    prosecution["Fear of prosecution<br>- Acts as consul in 59 BC [4]"]
    rubicon["The Rubicon, 49 BC<br>- One legion [5]<br>- Treason [6]"]
    war["Civil war<br>- Pharsalus, 48 BC [7]"]
    dictator["Dictator<br>- Assassinated in 44 BC [8]"]
    root --> breakdown & gaul & ultimatum
    breakdown --> crassus & julia
    gaul --> wealth & army
    ultimatum --> prosecution & rubicon
    rubicon --> war & dictator
"#;

/// Eigenvalues as a tree.
const EIGEN_DIAGRAM: &str = r#"flowchart TD
    root(["Eigenvectors<br>- Av = λv [1]"])
    finding["Finding them<br>- det(A − λI) = 0 [2]"]
    checks["Checks"]
    diag["Diagonalization<br>- A = PDP⁻¹ [6]"]
    example["Example<br>- λ = 1 and 3 [3]"]
    vectors["Eigenvectors<br>- (1, 1), (1, −1) [4]"]
    sums["Sum is the trace<br>- 1 + 3 = 4 [5]"]
    powers["Powers<br>- A^k = P D^k P⁻¹ [7]"]
    fails["Not always possible<br>- Needs n eigenvectors [8]"]
    root --> finding & checks & diag
    finding --> example & vectors
    checks --> sums
    diag --> powers & fails
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

/// The sessions of the courses, in no particular order: each dates itself. The showcase
/// sample has every file read and no session left waiting for work.
pub(super) fn conversations(sample: Sample) -> Vec<Conversation> {
    let mut all = development_conversations();
    if sample == Sample::Showcase {
        showcase(&mut all);
    }
    all
}

/// What the showcase sample changes: nothing failed, stopped or unread, no declined update,
/// and diagrams for the courses that had none.
fn showcase(all: &mut Vec<Conversation>) {
    all.retain(|c| !matches!(c.title, "Exam revision" | "Study plan"));
    for conversation in all.iter_mut() {
        conversation.declined = None;
        match conversation.title {
            "Fall of the Republic" => {
                conversation.attachments[1].outcome = Some(Outcome::Done {
                    blocks: GRACCHI_PODCAST,
                });
            }
            "Eigenvalues" => {
                conversation.attachments[2] =
                    Attachment::read("whiteboard-photo.jpg", ExtractorKind::Vision, WHITEBOARD, 9);
                conversation.answer = Some((
                    "An eigenvector of a square matrix A is a nonzero vector v with Av = λv for some scalar λ, its eigenvalue [1]: multiplying by A only stretches it, without changing its direction [2]. The whiteboard example shows it: for [[2, 1], [1, 2]] the eigenvalues are 1 and 3 [3].",
                    &[(0, 1), (1, 0), (2, 0)],
                ));
                conversation.made.push(Made {
                    kind: ArtifactKind::Diagram,
                    body: MadeBody::Diagram(EIGEN_DIAGRAM),
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
                });
            }
            "Caesar crosses the Rubicon" => conversation.made.push(Made {
                kind: ArtifactKind::Diagram,
                body: MadeBody::Diagram(RUBICON_DIAGRAM),
                cites: &[
                    (0, 0),
                    (0, 1),
                    (0, 2),
                    (0, 3),
                    (0, 4),
                    (1, 1),
                    (0, 5),
                    (0, 6),
                ],
            }),
            _ => {}
        }
    }
}

fn development_conversations() -> Vec<Conversation> {
    vec![
        Conversation {
            project: "Organic chemistry",
            title: "Alkanes and naming",
            text: "Lecture 2 and the slides.",
            hours_ago: 12 * 24,
            attachments: vec![
                Attachment::read(
                    "lecture-02-alkanes.mp3",
                    ExtractorKind::Transcription,
                    ALKANE_LECTURE,
                    498,
                ),
                Attachment::read(
                    "slides-alkanes.pdf",
                    ExtractorKind::Vision,
                    ALKANE_SLIDES,
                    28,
                ),
            ],
            answer: None,
            thread: &[],
            made: vec![Made {
                kind: ArtifactKind::Notes,
                body: MadeBody::Text(ORGANIC_NOTES),
                cites: &[
                    (0, 1),
                    (0, 2),
                    (0, 3),
                    (0, 4),
                    (0, 5),
                    (1, 1),
                    (1, 2),
                    (1, 3),
                ],
            }],
            declined: None,
        },
        Conversation {
            project: "Organic chemistry",
            title: "SN1 and SN2",
            text: "Lecture 5, the textbook chapter and an article on SN2. @study when does SN2 win over SN1?",
            hours_ago: 5 * 24,
            attachments: vec![
                Attachment::read(
                    "lecture-05-substitution.mp3",
                    ExtractorKind::Transcription,
                    SUBSTITUTION_LECTURE,
                    571,
                ),
                Attachment::read(
                    "textbook-chapter-7.pdf",
                    ExtractorKind::Vision,
                    SUBSTITUTION_CHAPTER,
                    33,
                ),
                Attachment::article(
                    Web {
                        title: "SN2 reaction – Wikipedia",
                        url: "https://en.wikipedia.org/wiki/SN2_reaction",
                        sections: &["overview", "stereochemistry", "substrate"],
                    },
                    SN2_ARTICLE,
                ),
            ],
            answer: Some((
                "SN2 wins with a strong nucleophile on a methyl or primary substrate, ideally in a polar aprotic solvent [1][2]. It is blocked on tertiary carbons by steric hindrance [3], which is where SN1 takes over.",
                &[(0, 6), (0, 5), (2, 2)],
            )),
            thread: &[],
            made: vec![
                Made {
                    kind: ArtifactKind::Diagram,
                    body: MadeBody::Diagram(SUBSTITUTION_DIAGRAM),
                    cites: &[
                        (0, 0),
                        (0, 1),
                        (0, 2),
                        (0, 3),
                        (0, 4),
                        (0, 5),
                        (0, 6),
                        (1, 1),
                        (1, 2),
                    ],
                },
                Made {
                    kind: ArtifactKind::Flashcards,
                    body: MadeBody::Cards(&[
                        (
                            "What is the rate law of an SN2 reaction?",
                            "Rate = k[RX][Nu]: second order, depending on substrate and nucleophile.",
                            &[1, 7],
                        ),
                        (
                            "What happens to stereochemistry in SN2?",
                            "Inversion at the carbon, from the back-side attack.",
                            &[2],
                        ),
                        (
                            "How many steps does SN1 have, and which is slow?",
                            "Two. Loss of the leaving group, forming a carbocation, is the slow step.",
                            &[3],
                        ),
                        (
                            "Why does SN1 give a racemic product?",
                            "The carbocation is planar, so the nucleophile attacks either face.",
                            &[4],
                        ),
                        (
                            "Which substrates favour SN1, and why?",
                            "Tertiary ones, because tertiary carbocations are the most stable.",
                            &[4],
                        ),
                        (
                            "Which solvents favour SN2?",
                            "Polar aprotic ones, such as acetone or DMSO, which leave the nucleophile strong.",
                            &[5],
                        ),
                        (
                            "Which solvents favour SN1?",
                            "Polar protic ones, such as water or ethanol, which stabilize the carbocation.",
                            &[5],
                        ),
                        (
                            "What makes a good leaving group?",
                            "A weak base, such as iodide, bromide or tosylate.",
                            &[6],
                        ),
                    ]),
                    cites: &[(0, 1), (0, 2), (0, 3), (0, 4), (0, 5), (0, 6), (1, 1)],
                },
            ],
            declined: None,
        },
        Conversation {
            project: "Microeconomics",
            title: "Supply and demand",
            text: "Lecture 1 and the chart from the board.",
            hours_ago: 15 * 24,
            attachments: vec![
                Attachment::read(
                    "lecture-01-markets.m4a",
                    ExtractorKind::Transcription,
                    SUPPLY_LECTURE,
                    455,
                ),
                Attachment::read(
                    "coffee-market-chart.png",
                    ExtractorKind::Vision,
                    SUPPLY_CHART,
                    11,
                ),
            ],
            answer: None,
            thread: &[],
            made: vec![Made {
                kind: ArtifactKind::Notes,
                body: MadeBody::Text(SUPPLY_NOTES),
                cites: &[(0, 1), (0, 2), (0, 3), (0, 4), (0, 5), (1, 0)],
            }],
            declined: None,
        },
        Conversation {
            project: "Microeconomics",
            title: "Elasticity",
            text: "Lecture 3 and an overview article. @study what does elasticity measure?",
            hours_ago: 3 * 24 + 4,
            attachments: vec![
                Attachment::read(
                    "lecture-03-elasticity.mp3",
                    ExtractorKind::Transcription,
                    ELASTICITY_LECTURE,
                    517,
                ),
                Attachment::article(
                    Web {
                        title: "Price elasticity of demand – Wikipedia",
                        url: "https://en.wikipedia.org/wiki/Price_elasticity_of_demand",
                        sections: &["definition", "interpretation", "revenue"],
                    },
                    ELASTICITY_ARTICLE,
                ),
            ],
            answer: Some((
                "Price elasticity of demand measures how much the quantity demanded responds to a change in price: the percentage change in quantity divided by the percentage change in price [1]. Above one in absolute value demand is elastic, below one it is inelastic [2].",
                &[(0, 1), (1, 1)],
            )),
            thread: &[],
            made: vec![
                Made {
                    kind: ArtifactKind::Diagram,
                    body: MadeBody::Diagram(ELASTICITY_DIAGRAM),
                    cites: &[(0, 0), (0, 1), (1, 1), (0, 3), (1, 2), (0, 5)],
                },
                Made {
                    kind: ArtifactKind::Flashcards,
                    body: MadeBody::Cards(&[
                        (
                            "What does price elasticity of demand measure?",
                            "How strongly the quantity demanded responds to a change in price.",
                            &[1],
                        ),
                        (
                            "How is it calculated?",
                            "Percentage change in quantity demanded divided by percentage change in price.",
                            &[1],
                        ),
                        (
                            "When is demand elastic?",
                            "When the absolute value of the elasticity is greater than one.",
                            &[2],
                        ),
                        (
                            "What does unit elastic mean?",
                            "The elasticity is exactly one.",
                            &[2],
                        ),
                        (
                            "Name two things that make demand more elastic.",
                            "Close substitutes, and a long time to adjust.",
                            &[3],
                        ),
                        (
                            "What happens to revenue if you raise the price and demand is elastic?",
                            "Total revenue falls.",
                            &[4],
                        ),
                        ("And if demand is inelastic?", "Total revenue rises.", &[4]),
                        (
                            "What is an inferior good?",
                            "One with negative income elasticity, such as instant noodles.",
                            &[5],
                        ),
                    ]),
                    cites: &[(0, 1), (0, 2), (0, 3), (0, 4), (0, 5)],
                },
            ],
            declined: None,
        },
        Conversation {
            project: "Cell biology",
            title: "The cell cycle",
            text: "Recording of the first lecture on how cells divide.",
            hours_ago: 18 * 24,
            attachments: vec![Attachment::read(
                "lecture-cell-cycle.mp3",
                ExtractorKind::Transcription,
                CELL_CYCLE_LECTURE,
                389,
            )],
            answer: None,
            thread: &[],
            made: Vec::new(),
            declined: None,
        },
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
                    cites: MITOSIS_DIAGRAM_CITES,
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
            title: "The early Republic",
            text: "Lecture 7 on the consuls, the Senate and the plebeians.",
            hours_ago: 16 * 24,
            attachments: vec![Attachment::read(
                "lecture-07-early-republic.m4a",
                ExtractorKind::Transcription,
                EARLY_REPUBLIC_LECTURE,
                352,
            )],
            answer: None,
            thread: &[],
            made: Vec::new(),
            declined: None,
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
            title: "Determinants",
            text: "Recording of lecture 5.",
            hours_ago: 17 * 24,
            attachments: vec![Attachment::read(
                "lecture-05.mp3",
                ExtractorKind::Transcription,
                DETERMINANT_LECTURE,
                402,
            )],
            answer: None,
            thread: &[],
            made: Vec::new(),
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
pub(super) fn practice_questions(sample: Sample) -> Vec<SeededQuestion> {
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
    let showcase = sample == Sample::Showcase;
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
            Some((PracticeAnswer::Choice(if showcase { 3 } else { 1 }), None)),
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
            Some(if showcase {
                (
                    PracticeAnswer::Open(
                        "Prophase, metaphase, anaphase and telophase, with prometaphase between prophase and metaphase."
                            .to_owned(),
                    ),
                    Some((
                        Verdict::Correct,
                        "Exactly: the four phases in order, and prometaphase fits between prophase and metaphase, when the nuclear envelope breaks down.",
                    )),
                )
            } else {
                (
                    PracticeAnswer::Open("Prophase, metaphase, anaphase, telophase.".to_owned()),
                    Some((
                        Verdict::Partly,
                        "Right: those are the four phases, in order. Missing is where prometaphase fits: between prophase and metaphase.",
                    )),
                )
            }),
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
            showcase.then_some((PracticeAnswer::Choice(2), None)),
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
