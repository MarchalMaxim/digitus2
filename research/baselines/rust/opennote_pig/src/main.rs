//! usage: opennote_pig <rules: consensus|parncutt|jacobs|balliauw|badgerow> <in1.txt> <out1.tsv> [<in2> <out2> ...]
//! For each PIG file: on_train::corpus::read (hands from the channel column when the finger
//! column is 0) -> on_train::eval::solve (rules only, no learned prior, medium hand) ->
//! writes "onset<TAB>midi<TAB>finger" per note in the reader's (onset, midi) order plus the
//! solve time in seconds on the first line ("#seconds<TAB>t").
use std::io::Write;
use std::path::Path;
use std::time::Instant;

use on_fingering::{FingeringOptions, RuleSet};
use on_hand::{HandProfile, HandSize};

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let rules = match args.get(1).map(String::as_str) {
        Some("parncutt") => RuleSet::Parncutt,
        Some("jacobs") => RuleSet::Jacobs,
        Some("balliauw") => RuleSet::Balliauw,
        Some("badgerow") => RuleSet::Badgerow,
        _ => RuleSet::Consensus,
    };
    let mut i = 2;
    while i + 1 < args.len() {
        let (pieces, skipped) = on_train::corpus::read(Path::new(&args[i]))?;
        anyhow::ensure!(skipped.is_empty() && pieces.len() == 1, "could not read {}: {:?}", args[i], skipped);
        let piece = &pieces[0];
        let mut options = FingeringOptions::for_hand(HandProfile::from_size(HandSize::Medium));
        options.rule_set = rules;
        let t0 = Instant::now();
        let fingers = on_train::eval::solve(piece, &options, None).unwrap_or_default();
        let secs = t0.elapsed().as_secs_f64();
        let mut out = std::fs::File::create(&args[i + 1])?;
        writeln!(out, "#seconds\t{secs}")?;
        for (note, f) in piece.notes.iter().zip(fingers.iter()) {
            writeln!(out, "{}\t{}\t{}", note.onset, note.midi, f.map(|x| x as i32).unwrap_or(0))?;
        }
        i += 2;
    }
    Ok(())
}
