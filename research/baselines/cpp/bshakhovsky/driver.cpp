// Batch driver for BShakhovsky/PianoFingering_CalcModule (TrellisGraph facade).
// stdin:  one hand per block: "HAND <0|1> <nChords>" then one line per chord "k p1 ... pk" (MIDI)
// stdout: per chord one line with the k finger strings (first char = chosen finger, '?' = left out)
#include "stdafx.h"
#include "TrellisGraph_Facade.h"
#include <iostream>
#include <string>
using namespace std;
int main() {
    string tag;
    while (cin >> tag) {
        int hand; size_t n; cin >> hand >> n;
        vector<set<int16_t>> chords(n);
        for (size_t i = 0; i < n; ++i) {
            int k; cin >> k;
            for (int j = 0; j < k; ++j) { int p; cin >> p; chords[i].insert(static_cast<int16_t>(p)); }
        }
        TrellisGraph graph(chords, hand == 1);
        while (graph.NextStep()) {}
        graph.Finish();
        const auto& res = graph.GetResult();
        cout << "RESULT " << hand << " " << res.size() << "\n";
        for (const auto& chord : res) {
            for (size_t j = 0; j < chord.size(); ++j) cout << (j ? " " : "") << (chord[j].empty() ? "?" : chord[j]);
            cout << "\n";
        }
        cout.flush();
    }
    return 0;
}
