Parncutt baseline (engine rules + template, weight set on disk) on validation: M_gen 64.67 / M_high 65.32 / M_soft 67.72 / M_rec 65.94 (20 pieces, 8936 notes)

### (a) PA-I sweep: validation M_gen by rho (rows) and C (columns), best epoch of 20

| rho \ C | 0.01 | 0.05 | 0.2 | 1.0 |
|---|---|---|---|---|
| 0.0 | 69.11 (ep 11) | 69.28 (ep 20) | 69.16 (ep 9) | 69.16 (ep 9) |
| 0.5 | 69.85 (ep 3) | 69.74 (ep 18) | 69.94 (ep 2) | 69.94 (ep 2) |
| 1.0 | 69.84 (ep 4) | 69.28 (ep 20) | 70.35 (ep 3) | 70.03 (ep 2) |
| 2.0 | 70.08 (ep 5) | 69.32 (ep 3) | 69.29 (ep 2) | 69.16 (ep 8) |

| run | M_gen | M_high | M_soft | M_rec | best epoch | delta gen vs Parncutt [95% CI] | s/epoch |
|---|---|---|---|---|---|---|---|
| pa_rho1.0_C0.2 | 70.35 | 71.48 | 73.52 | 72.13 | 3 | +5.69 [+2.48, +9.31] | 1.6 |
| pa_rho2.0_C0.01 | 70.08 | 71.01 | 73.09 | 71.54 | 5 | +5.41 [+2.02, +9.35] | 1.6 |
| pa_rho1.0_C1.0 | 70.03 | 71.12 | 73.27 | 71.74 | 2 | +5.36 [+2.15, +8.90] | 1.6 |
| pa_rho0.5_C0.2 | 69.94 | 70.99 | 73.13 | 71.60 | 2 | +5.27 [+2.10, +8.70] | 1.5 |
| pa_rho0.5_C1.0 | 69.94 | 70.99 | 73.13 | 71.60 | 2 | +5.27 [+2.10, +8.70] | 1.5 |
| pa_rho0.5_C0.01 | 69.85 | 70.74 | 72.93 | 71.45 | 3 | +5.19 [+1.97, +8.72] | 1.6 |
| pa_rho1.0_C0.01 | 69.84 | 70.85 | 72.86 | 71.43 | 4 | +5.18 [+1.81, +8.98] | 1.8 |
| pa_rho0.5_C0.05 | 69.74 | 70.82 | 72.83 | 71.48 | 18 | +5.08 [+1.39, +9.26] | 1.6 |
| pa_rho2.0_C0.05 | 69.32 | 70.37 | 72.43 | 70.97 | 3 | +4.66 [+1.27, +8.59] | 1.6 |
| pa_rho2.0_C0.2 | 69.29 | 70.42 | 72.47 | 71.11 | 2 | +4.62 [+1.50, +8.11] | 1.6 |
| pa_rho1.0_C0.05 | 69.28 | 70.29 | 72.31 | 70.95 | 20 | +4.61 [+1.07, +8.78] | 1.8 |
| pa_rho0.0_C0.05 | 69.28 | 70.17 | 72.36 | 70.91 | 20 | +4.61 [+1.31, +8.11] | 1.3 |
| pa_rho0.0_C0.2 | 69.16 | 70.08 | 72.16 | 70.73 | 9 | +4.49 [+1.46, +7.75] | 1.5 |
| pa_rho0.0_C1.0 | 69.16 | 70.08 | 72.16 | 70.73 | 9 | +4.49 [+1.46, +7.75] | 1.5 |
| pa_rho2.0_C1.0 | 69.16 | 70.25 | 72.27 | 70.91 | 8 | +4.49 [+1.29, +8.39] | 1.6 |
| pa_rho0.0_C0.01 | 69.11 | 69.93 | 72.08 | 70.64 | 11 | +4.45 [+1.50, +7.67] | 1.3 |

Epoch curve of the best sweep run `pa_rho1.0_C0.2` (validation M_gen per epoch, averaged weights):

| epoch | updates | infeasible targets | mean loss | aug. hamming | val M_gen | val M_high | val M_soft | val M_rec | s |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 200 | 49 | 191.1 | 58.3% | 69.39 | 70.61 | 72.58 | 71.11 | 1.7 |
| 2 | 198 | 50 | 163.0 | 60.0% | 70.16 | 71.24 | 73.41 | 71.87 | 1.7 |
| 3 | 200 | 48 | 156.2 | 58.5% | 70.35 | 71.48 | 73.52 | 72.13 | 1.5 |
| 4 | 199 | 50 | 160.7 | 58.2% | 69.92 | 71.03 | 73.12 | 71.70 | 1.7 |
| 5 | 199 | 51 | 163.3 | 57.0% | 69.73 | 70.78 | 72.88 | 71.44 | 1.5 |
| 6 | 200 | 49 | 155.3 | 57.1% | 69.61 | 70.81 | 72.75 | 71.42 | 1.7 |
| 7 | 199 | 49 | 159.9 | 57.7% | 69.42 | 70.62 | 72.57 | 71.21 | 1.5 |
| 8 | 199 | 50 | 160.5 | 56.9% | 69.57 | 70.64 | 72.65 | 71.26 | 1.6 |
| 9 | 199 | 48 | 159.4 | 56.9% | 69.50 | 70.61 | 72.55 | 71.22 | 1.6 |
| 10 | 198 | 51 | 163.0 | 56.2% | 69.51 | 70.62 | 72.57 | 71.25 | 1.5 |
| 11 | 199 | 50 | 155.2 | 56.8% | 69.29 | 70.34 | 72.28 | 70.95 | 1.6 |
| 12 | 199 | 49 | 159.7 | 55.9% | 69.06 | 70.14 | 72.08 | 70.75 | 1.8 |
| 13 | 200 | 50 | 158.6 | 56.5% | 69.06 | 70.14 | 72.08 | 70.75 | 1.5 |
| 14 | 198 | 48 | 168.4 | 56.0% | 69.03 | 70.07 | 72.05 | 70.70 | 1.8 |
| 15 | 200 | 50 | 153.4 | 54.3% | 68.97 | 70.01 | 71.99 | 70.64 | 1.6 |
| 16 | 200 | 48 | 157.5 | 55.8% | 68.94 | 70.02 | 71.96 | 70.63 | 1.5 |
| 17 | 199 | 50 | 165.9 | 55.6% | 69.10 | 70.18 | 72.12 | 70.79 | 1.5 |
| 18 | 200 | 51 | 166.8 | 57.2% | 68.99 | 70.07 | 72.01 | 70.68 | 1.4 |
| 19 | 200 | 50 | 167.2 | 57.8% | 69.05 | 70.10 | 72.08 | 70.73 | 1.7 |
| 20 | 199 | 49 | 161.0 | 55.2% | 68.95 | 70.00 | 71.98 | 70.62 | 1.7 |

### (a) trainer variants at the best (rho, C) = (1.0, 0.2); delta is against that run (paired bootstrap over the 20 pieces)

| run | M_gen | M_high | M_soft | M_rec | best epoch | delta gen vs best PA [95% CI] | s/epoch |
|---|---|---|---|---|---|---|---|
| best PA (reference) | 70.35 | 71.48 | 73.52 | 72.13 | 3 | - | 1.6 |
| pa_first | 69.39 | 70.34 | 72.36 | 71.01 | 10 | -0.97 [-2.45, +0.36] | 1.4 |
| pa_noaverage | 68.47 | 69.79 | 71.41 | 70.13 | 11 | -1.89 [-4.02, -0.07] | 1.5 |
| pa_noproject | 68.87 | 69.99 | 71.92 | 70.65 | 17 | -1.48 [-3.29, +0.24] | 1.5 |
| pa_seed1 | 69.37 | 70.31 | 72.45 | 71.02 | 8 | -0.98 [-2.79, +0.76] | 1.5 |
| pa_skip_infeasible | 69.72 | 70.84 | 72.88 | 71.58 | 8 | -0.63 [-1.93, +0.72] | 1.4 |
| pa_zeros | 69.53 | 70.64 | 72.65 | 71.26 | 3 | -0.82 [-2.15, +0.23] | 1.5 |
| perceptron_eta0.005 | 69.92 | 70.98 | 72.93 | 71.53 | 14 | -0.44 [-1.99, +1.05] | 1.4 |
| perceptron_eta0.02 | 70.15 | 71.29 | 73.17 | 71.72 | 18 | -0.21 [-2.50, +2.38] | 1.6 |
| perceptron_eta0.1 | 69.72 | 70.62 | 72.69 | 71.21 | 20 | -0.64 [-2.91, +2.08] | 1.2 |

### (b) feature family ablation (cumulative), validation; delta against the previous row

| features | n | M_gen | M_high | M_soft | M_rec | best epoch | delta gen vs previous [95% CI] | delta gen vs Parncutt [95% CI] |
|---|---|---|---|---|---|---|---|---|
| rules | 24 | 68.57 | 69.41 | 71.58 | 70.09 | 2 | - | +3.90 [+1.58, +6.51] |
| rules+colour | 34 | 68.13 | 68.85 | 71.10 | 69.55 | 20 | -0.44 [-1.43, +0.65] | +3.46 [+1.01, +6.11] |
| rules+colour+trans | 84 | 70.10 | 71.19 | 73.10 | 71.85 | 10 | +1.97 [-0.37, +4.13] | +5.43 [+2.04, +9.46] |
| rules+colour+trans+chord | 94 | 69.45 | 70.37 | 72.50 | 71.03 | 5 | -0.65 [-1.78, +0.33] | +4.78 [+1.50, +8.67] |
| rules+colour+trans+chord+lattice+timing | 99 | 70.35 | 71.48 | 73.52 | 72.13 | 3 | +0.91 [-0.82, +2.63] | +5.69 [+2.48, +9.31] |
| rules+colour+trans+chord+lattice+timing+rest | 103 | 70.20 | 71.13 | 73.29 | 71.83 | 2 | -0.15 [-1.62, +1.06] | +5.54 [+2.06, +9.46] |
| rules+colour+trans+chord+lattice+timing+rest+fitts | 105 | 70.54 | 71.73 | 73.78 | 72.42 | 7 | +0.34 [-0.93, +1.64] | +5.88 [+2.30, +10.03] |
| rules+colour+trans+chord+lattice+timing+rest+fitts+geo | 155 | 69.93 | 70.75 | 72.99 | 71.42 | 2 | -0.61 [-2.23, +0.95] | +5.26 [+2.12, +8.94] |
| rules+colour+trans+chord+lattice+timing+rest+fitts+geo+trColour | 255 | 70.57 | 71.30 | 73.62 | 72.09 | 4 | +0.64 [-0.67, +2.30] | +5.91 [+2.55, +9.68] |
| rules+colour+trans+chord+lattice+timing+rest+fitts+geo+trColour+latticeBins | 980 | 70.80 | 71.69 | 73.91 | 72.32 | 7 | +0.22 [-2.56, +2.61] | +6.13 [+2.11, +10.58] |

Largest learned weights of the last ablation model (absolute value):

| feature | weight |
|---|---|
| `chordBeyondPractical` | +9.651 |
| `hop` | +2.374 |
| `weakFifth` | +1.391 |
| `chordStretch` | +1.168 |
| `chordSmallSpan` | +1.020 |
| `thumbPassing` | +0.966 |
| `tr:11:down` | +0.963 |
| `weakFinger` | +0.844 |
| `cm:22:down` | +0.842 |
| `tr:11:up` | +0.815 |
| `lb:41:-14` | +0.796 |
| `fourOnBlack` | +0.788 |
| `tr:21:down` | -0.720 |
| `cm:44:down` | +0.709 |
| `tr:11:down:white` | +0.689 |
| `threeToFour` | +0.689 |
| `cm:11:up` | +0.683 |
| `cm:44:up` | +0.658 |
| `beyondPractical` | +0.649 |
| `lb:51:-14` | -0.635 |
| `positionChangeCount` | +0.597 |
| `cm:33:down` | +0.580 |
| `fittsFast` | +0.579 |
| `cm:33:up` | +0.565 |
| `tr:22:up` | +0.563 |

### (c) partial supervision: PIG train with and without the Mutopia train half (finger 0 = unknown)

| run | train notes (fingered) | PIG val M_gen | PIG val M_rec | Mutopia test M_gen (fingered notes) | delta PIG val vs pig_only [95% CI] | delta Mutopia test vs pig_only [95% CI] | s/epoch |
|---|---|---|---|---|---|---|---|
| mutopia_only | 129167 (27378) | 65.20 | 66.66 | 66.13 (62 parts, 8805 notes) | -5.16 [-7.27, -3.06] | +6.23 [+3.40, +9.22] | 6.7 |
| pig_only | 29563 (29563) | 70.35 | 72.13 | 59.89 (62 parts, 8805 notes) | - | - | 1.5 |
| pig_plus_mutopia | 158730 (56941) | 68.25 | 69.80 | 64.67 (62 parts, 8805 notes) | -2.10 [-4.09, -0.30] | +4.78 [+2.58, +7.12] | 8.3 |

Parncutt baseline on the Mutopia test half: M_gen 56.63 (62 parts, 8805 fingered notes).

### (d) open configuration (textbook + Beringer + Mutopia train): what the shippable set reaches on PIG validation

| run | train notes (fingered) | PIG val M_gen | PIG val M_high | PIG val M_soft | PIG val M_rec | delta vs Parncutt [95% CI] | Mutopia test M_gen | best epoch |
|---|---|---|---|---|---|---|---|---|
| open_all | 147079 (45287) | 64.88 | 65.73 | 67.82 | 66.29 | +0.21 [-3.16, +3.63] | 65.53 | 1 |
| open_all_unweighted | 147079 (45287) | 64.74 | 65.49 | 67.56 | 65.98 | +0.08 [-3.69, +4.02] | 64.49 | 12 |
| open_all_zeros | 147079 (45287) | 64.98 | 65.74 | 67.83 | 66.27 | +0.32 [-3.40, +4.31] | 65.20 | 7 |
| open_textbook_beringer | 17912 (17909) | 64.15 | 65.02 | 66.99 | 65.49 | -0.52 [-3.67, +2.52] | 59.68 | 1 |

### seed variance of the best PA setting (validation M_gen, best epoch of 20): 69.37, 69.36, 69.13, 69.39, 69.33, 70.35 -> mean 69.49, sd 0.43, best epochs [8, 6, 7, 4, 1, 3]


### (f) 5-fold cross-validation over all 120 PIG train pieces (3 epochs, last averaged weights); paired bootstrap over the 120 held-out pieces against the plan configuration

| configuration | pieces | mean M_gen | delta vs plan [95% CI] | delta vs Parncutt [95% CI] |
|---|---|---|---|---|
| Parncutt (no learning) | 120 | 61.27 | -6.81 [-7.99, -5.67] | - |
| full | 120 | 68.41 | +0.33 [-0.51, +1.24] | +7.14 [+5.75, +8.60] |
| plan | 120 | 68.08 | - | +6.81 [+5.67, +7.99] |
| plan_first | 120 | 67.70 | -0.38 [-0.83, +0.05] | +6.42 [+5.23, +7.61] |
| plan_noproject | 120 | 67.85 | -0.23 [-0.81, +0.36] | +6.58 [+5.30, +7.88] |
| rho0 | 120 | 66.77 | -1.31 [-2.00, -0.64] | +5.49 [+4.37, +6.65] |
| rules | 120 | 65.26 | -2.82 [-3.81, -1.89] | +3.99 [+3.08, +4.88] |
| rules_colour_trans | 120 | 67.77 | -0.31 [-0.76, +0.13] | +6.50 [+5.32, +7.70] |

### the plan's `pig` configuration (PIG train + textbook + Beringer) and everything together

| run | train notes (fingered) | PIG val M_gen | PIG val M_high | PIG val M_soft | PIG val M_rec | delta vs Parncutt [95% CI] | Mutopia test M_gen | best epoch |
|---|---|---|---|---|---|---|---|---|
| everything | 176642 (74850) | 66.95 | 67.69 | 69.93 | 68.42 | +2.28 [-1.42, +6.29] | 65.93 | 2 |
| pig_mutopia_w0.1 | 158730 (56941) | 69.02 | 70.05 | 72.03 | 70.69 | +4.35 [+0.90, +8.45] | 61.50 | 10 |
| pig_textbook_beringer | 47475 (47472) | 67.71 | 68.68 | 70.86 | 69.31 | +3.04 [-0.54, +7.27] | 60.98 | 12 |
| pig_textbook_beringer_20ep | 47475 (47472) | 67.99 | 68.95 | 71.16 | 69.58 | +3.33 [-0.30, +7.59] | 61.09 | 16 |
| pig_textbook_beringer_w0.02 | 47475 (47472) | 69.51 | 70.68 | 72.64 | 71.24 | +4.85 [+1.25, +8.87] | 62.20 | 6 |
| pig_textbook_beringer_w0.1 | 47475 (47472) | 68.78 | 69.84 | 71.91 | 70.50 | +4.11 [+0.75, +8.14] | 61.10 | 10 |

### (e) timing (Python prototype, one core, below-normal priority)

| run | train notes | features | s/epoch | epochs | total s |
|---|---|---|---|---|---|
| sweep/pa_rho0.0_C0.01 | 29563 | 99 | 1.32 | 20 | 28.0 |
| sweep/pa_rho0.0_C0.05 | 29563 | 99 | 1.30 | 20 | 27.6 |
| sweep/pa_rho0.0_C0.2 | 29563 | 99 | 1.52 | 20 | 31.5 |
| sweep/pa_rho0.0_C1.0 | 29563 | 99 | 1.47 | 20 | 30.5 |
| sweep/pa_rho0.5_C0.01 | 29563 | 99 | 1.60 | 20 | 33.2 |
| sweep/pa_rho0.5_C0.05 | 29563 | 99 | 1.61 | 20 | 33.6 |
| sweep/pa_rho0.5_C0.2 | 29563 | 99 | 1.53 | 20 | 32.1 |
| sweep/pa_rho0.5_C1.0 | 29563 | 99 | 1.55 | 20 | 32.2 |
| sweep/pa_rho1.0_C0.01 | 29563 | 99 | 1.76 | 20 | 36.5 |
| sweep/pa_rho1.0_C0.05 | 29563 | 99 | 1.76 | 20 | 36.6 |
| sweep/pa_rho1.0_C0.2 | 29563 | 99 | 1.60 | 20 | 33.2 |
| sweep/pa_rho1.0_C1.0 | 29563 | 99 | 1.62 | 20 | 33.8 |
| sweep/pa_rho2.0_C0.01 | 29563 | 99 | 1.58 | 20 | 33.0 |
| sweep/pa_rho2.0_C0.05 | 29563 | 99 | 1.59 | 20 | 33.0 |
| sweep/pa_rho2.0_C0.2 | 29563 | 99 | 1.56 | 20 | 32.5 |
| sweep/pa_rho2.0_C1.0 | 29563 | 99 | 1.57 | 20 | 32.7 |
| variants/pa_first | 29563 | 99 | 1.41 | 20 | 29.6 |
| variants/pa_noaverage | 29563 | 99 | 1.51 | 20 | 31.7 |
| variants/pa_noproject | 29563 | 99 | 1.52 | 20 | 32.2 |
| variants/pa_seed1 | 29563 | 99 | 1.52 | 20 | 31.5 |
| variants/pa_skip_infeasible | 29563 | 99 | 1.44 | 20 | 30.2 |
| variants/pa_zeros | 29563 | 99 | 1.53 | 20 | 32.1 |
| variants/perceptron_eta0.005 | 29563 | 99 | 1.44 | 20 | 30.2 |
| variants/perceptron_eta0.02 | 29563 | 99 | 1.56 | 20 | 32.5 |
| variants/perceptron_eta0.1 | 29563 | 99 | 1.24 | 20 | 25.8 |
| ablation/abl00_rules | 29563 | 24 | 1.52 | 20 | 32.3 |
| ablation/abl01_colour | 29563 | 34 | 1.57 | 20 | 32.9 |
| ablation/abl02_trans | 29563 | 84 | 1.55 | 20 | 32.4 |
| ablation/abl03_chord | 29563 | 94 | 1.53 | 20 | 32.0 |
| ablation/abl04_lattice+timing | 29563 | 99 | 1.55 | 20 | 32.5 |
| ablation/abl05_rest | 29563 | 103 | 1.53 | 20 | 31.7 |
| ablation/abl06_fitts | 29563 | 105 | 1.45 | 20 | 30.3 |
| ablation/abl07_geo | 29563 | 155 | 1.60 | 20 | 33.4 |
| ablation/abl08_trColour | 29563 | 255 | 1.13 | 20 | 23.8 |
| ablation/abl09_latticeBins | 29563 | 980 | 1.36 | 20 | 28.4 |
| partial/mutopia_only | 129167 | 99 | 6.68 | 12 | 89.4 |
| partial/pig_only | 29563 | 99 | 1.54 | 12 | 30.9 |
| partial/pig_plus_mutopia | 158730 | 99 | 8.26 | 12 | 108.9 |
| open/open_all | 147079 | 99 | 6.79 | 12 | 91.5 |
| open/open_all_unweighted | 147079 | 99 | 6.37 | 12 | 85.2 |
| open/open_all_zeros | 147079 | 99 | 6.68 | 12 | 87.7 |
| open/open_textbook_beringer | 17912 | 99 | 1.05 | 12 | 23.3 |
| cv/cv0_full | 31174 | 980 | 0.97 | 3 | 3.4 |
| cv/cv0_plan | 31174 | 99 | 1.06 | 3 | 21.1 |
| cv/cv0_plan_first | 31174 | 99 | 0.86 | 3 | 3.2 |
| cv/cv0_plan_noproject | 31174 | 99 | 1.43 | 3 | 5.0 |
| cv/cv0_rho0 | 31174 | 99 | 0.94 | 3 | 3.2 |
| cv/cv0_rules | 31174 | 24 | 0.99 | 3 | 3.4 |
| cv/cv0_rules_colour_trans | 31174 | 84 | 0.97 | 3 | 3.3 |
| cv/cv1_full | 30865 | 980 | 1.22 | 3 | 4.4 |
| cv/cv1_plan | 30865 | 99 | 1.33 | 3 | 5.6 |
| cv/cv1_plan_first | 30865 | 99 | 1.10 | 3 | 3.9 |
| cv/cv1_plan_noproject | 30865 | 99 | 1.32 | 3 | 4.5 |
| cv/cv1_rho0 | 30865 | 99 | 1.33 | 3 | 4.6 |
| cv/cv1_rules | 30865 | 24 | 1.33 | 3 | 4.6 |
| cv/cv1_rules_colour_trans | 30865 | 84 | 1.35 | 3 | 4.7 |
| cv/cv2_full | 30080 | 980 | 1.53 | 3 | 5.8 |
| cv/cv2_plan | 30080 | 99 | 1.68 | 3 | 7.2 |
| cv/cv2_plan_first | 30080 | 99 | 1.47 | 3 | 5.7 |
| cv/cv2_plan_noproject | 30080 | 99 | 1.55 | 3 | 5.9 |
| cv/cv2_rho0 | 30080 | 99 | 1.43 | 3 | 5.6 |
| cv/cv2_rules | 30080 | 24 | 1.58 | 3 | 6.0 |
| cv/cv2_rules_colour_trans | 30080 | 84 | 1.66 | 3 | 6.2 |
| cv/cv3_full | 29332 | 980 | 0.98 | 3 | 3.6 |
| cv/cv3_plan | 29332 | 99 | 1.35 | 3 | 6.1 |
| cv/cv3_plan_first | 29332 | 99 | 0.86 | 3 | 3.2 |
| cv/cv3_plan_noproject | 29332 | 99 | 0.97 | 3 | 3.6 |
| cv/cv3_rho0 | 29332 | 99 | 1.09 | 3 | 4.1 |
| cv/cv3_rules | 29332 | 24 | 1.01 | 3 | 3.7 |
| cv/cv3_rules_colour_trans | 29332 | 84 | 1.06 | 3 | 3.8 |
| cv/cv4_full | 32545 | 980 | 0.90 | 3 | 3.1 |
| cv/cv4_plan | 32545 | 99 | 0.96 | 3 | 4.0 |
| cv/cv4_plan_first | 32545 | 99 | 0.81 | 3 | 2.8 |
| cv/cv4_plan_noproject | 32545 | 99 | 0.92 | 3 | 3.1 |
| cv/cv4_rho0 | 32545 | 99 | 0.94 | 3 | 3.2 |
| cv/cv4_rules | 32545 | 24 | 0.94 | 3 | 3.2 |
| cv/cv4_rules_colour_trans | 32545 | 84 | 0.92 | 3 | 3.1 |
| seeds/seed1 | 29563 | 99 | 1.10 | 20 | 23.4 |
| seeds/seed2 | 29563 | 99 | 1.08 | 20 | 22.4 |
| seeds/seed3 | 29563 | 99 | 1.07 | 20 | 22.3 |
| seeds/seed4 | 29563 | 99 | 1.08 | 20 | 22.5 |
| seeds/seed5 | 29563 | 99 | 1.16 | 20 | 24.0 |
| pigconfig/everything | 176642 | 99 | 7.17 | 12 | 95.1 |
| pigconfig/pig_mutopia_w0.1 | 158730 | 99 | 6.86 | 12 | 91.1 |
| pigconfig/pig_textbook_beringer | 47475 | 99 | 1.42 | 12 | 26.2 |
| pigconfig/pig_textbook_beringer_20ep | 47475 | 99 | 1.45 | 20 | 38.2 |
| pigconfig/pig_textbook_beringer_w0.02 | 47475 | 99 | 1.44 | 20 | 37.7 |
| pigconfig/pig_textbook_beringer_w0.1 | 47475 | 99 | 1.45 | 20 | 38.3 |
