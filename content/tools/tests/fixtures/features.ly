\version "2.24.0"
% Regression fixture for ly2musicxml.py: one feature per bar where possible.
\header { title = "Features" }

upper = \relative c'' {
  \clef treble \key g \major \time 3/4
  \partial 4 d4-3\p( |
  g,8[-1 a b c]) <d-1 fis-3>4-. |
  \acciaccatura e16 d4 \tuplet 3/2 { c8\< b a } g4\! |
  \repeat volta 2 {
    << { \voiceOne b'2 a4 } \\ { \voiceTwo g2 fis4 } >> \oneVoice |
    e4~ e8 fis g4 |
  }
  \alternative { { d2. } { d2 r4 } }
  \repeat volta 2 { b8 c d e fis g | a2 }
  r4 | g2.\f \bar "|."
}

lower = \relative c {
  \clef bass \key g \major \time 3/4
  \partial 4 r4 |
  g2. | g4 b d |
  \repeat volta 2 { g,2. | c2 \clef treble e'4 \clef bass | }
  \alternative { { d,2. } { d2 r4 } }
  \repeat volta 2 { g2. | d2 }
  r4 | g,2. \bar "|."
}

\score {
  \new PianoStaff << \new Staff = "up" \upper \new Staff = "down" \lower >>
  \layout { }
  \midi { \tempo 4 = 100 }
}
