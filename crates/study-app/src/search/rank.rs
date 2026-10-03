//! Ranking: the nearest vectors to a query, and fusing ranked lists into one.

use std::collections::HashMap;
use std::hash::Hash;

use study_core::Result;
use study_pipeline::QueryVector;

/// Rank damping for reciprocal rank fusion; 60 is the value from the original paper and
/// works without tuning.
const RRF_K: f32 = 60.0;

/// Merges ranked lists of ids, best first. An id's score is the sum of `1 / (k + rank)` over
/// the lists it appears in, so agreement between lists beats a high rank in only one.
pub(crate) fn fuse<Id: Copy + Eq + Hash>(lists: &[&[Id]]) -> Vec<Id> {
    let mut scores: HashMap<Id, f32> = HashMap::new();
    let mut first_seen = Vec::new();
    for list in lists {
        for (rank, &id) in list.iter().enumerate() {
            let score = scores.entry(id).or_insert_with(|| {
                first_seen.push(id);
                0.0
            });
            *score += 1.0 / (RRF_K + rank as f32 + 1.0);
        }
    }
    // Ties keep the order ids were first seen in, so results are stable.
    first_seen.sort_by(|a, b| scores[b].total_cmp(&scores[a]));
    first_seen
}

/// Keeps the `limit` best-scoring ids at or above `min_score`.
struct Nearest<Id> {
    limit: usize,
    min_score: f32,
    best: Vec<(f32, Id)>,
}

impl<Id: Copy> Nearest<Id> {
    fn new(limit: usize, min_score: f32) -> Self {
        Self {
            limit,
            min_score,
            best: Vec::with_capacity(limit + 1),
        }
    }

    fn offer(&mut self, id: Id, score: f32) {
        if score < self.min_score
            || (self.best.len() == self.limit
                && self.best.last().is_some_and(|&(worst, _)| score <= worst))
        {
            return;
        }
        let at = self.best.partition_point(|&(kept, _)| kept >= score);
        self.best.insert(at, (score, id));
        self.best.truncate(self.limit);
    }

    fn into_ids(self) -> Vec<Id> {
        self.best.into_iter().map(|(_, id)| id).collect()
    }
}

/// The ids of at most `limit` vectors most similar to `query`, at or above
/// `min_similarity`, of those `scan` visits; none without a query, when only words are
/// matched. A vector of another length than the query's does not compare and is skipped.
pub(crate) fn nearest<Id: Copy>(
    query: Option<&QueryVector>,
    limit: usize,
    min_similarity: f32,
    scan: impl FnOnce(&str, &mut dyn FnMut(Id, &[f32])) -> Result<()>,
) -> Result<Vec<Id>> {
    let Some(query) = query else {
        return Ok(Vec::new());
    };
    let mut nearest = Nearest::new(limit, min_similarity);
    scan(&query.model, &mut |id, vector| {
        if vector.len() == query.vector.len() {
            nearest.offer(id, dot(&query.vector, vector));
        }
    })?;
    Ok(nearest.into_ids())
}

/// Cosine similarity of two unit-length vectors.
fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agreement_between_lists_ranks_first() {
        assert_eq!(fuse(&[&[1, 2, 3], &[3, 4]]), [3, 1, 2, 4]);
        assert_eq!(fuse(&[&[], &[7, 8]]), [7, 8]);
        assert!(fuse::<i64>(&[]).is_empty());
    }

    #[test]
    fn nearest_keeps_the_best_above_the_floor() {
        let mut nearest = Nearest::new(2, 0.5);
        for (id, score) in [(1, 0.9), (2, 0.4), (3, 0.7), (4, 0.95), (5, 0.6)] {
            nearest.offer(id, score);
        }
        assert_eq!(nearest.into_ids(), [4, 1]);
        assert_eq!(dot(&[0.6, 0.8], &[0.6, 0.8]), 1.0);
    }

    #[test]
    fn nearest_skips_vectors_of_another_length() {
        let query = QueryVector {
            model: "model".into(),
            vector: vec![1.0, 0.0],
        };
        let ids = nearest(Some(&query), 10, 0.5, |_, offer| {
            offer(1, &[1.0]);
            offer(2, &[1.0, 0.0, 0.0]);
            offer(3, &[0.8, 0.6]);
            Ok(())
        })
        .unwrap();
        assert_eq!(ids, [3]);
    }
}
