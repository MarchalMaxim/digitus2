"""A small LilyPond *interpreter* that extracts notes + editorial fingerings from .ly sources.

Built on python-ly's lexer (``ly.lex``), which reliably classifies LilyPond tokens (notes,
durations, fingerings, Scheme, markup, strings, comments). On top of it we implement the
subset of LilyPond semantics that matters for piano scores:

* variables (``name = { ... }``) and their substitution (``\\name``), ``\\include`` of local files
* ``\\relative`` (with and without start pitch, nested), ``\\absolute``, ``\\fixed``, ``\\transpose``
* durations: default-duration carry-over in *input order* (as LilyPond's parser), dots,
  ``*n/m`` scaling, ``\\times``/``\\tuplet``/``\\scaleDurations``, multi-measure rests
* chords ``< >`` (incl. per-note fingering), chord repetition ``q``, ties (merged into one key
  press), rests/spacers/skips, ``c4\\rest``
* grace notes (``\\grace``, ``\\acciaccatura``, ``\\appoggiatura``, ``\\slashedGrace``, ``\\afterGrace``)
* repeats: ``volta``/``segno`` are kept in *written* order (body + alternatives once each),
  ``unfold``/``percent``/``tremolo`` are expanded
* contexts: ``\\new``/``\\context`` Staff/PianoStaff/GrandStaff/Voice/Dynamics/Lyrics...,
  ``\\change Staff = "..."`` (cross-staff notes), ``\\autochange``, ``<< a \\\\ b >>`` voices
* ``\\score``/``\\book``/``\\bookpart`` blocks; MIDI-only scores are skipped
* fingering: ``-3``, ``^3``, ``_3`` (on notes, inside chords, after chords), ``\\finger "4-1"``
  and ``\\markup \\finger "..."`` (substitutions ``4-1`` become PIG ``4_1``)
* bar checks ``|`` are verified against the meter grid (``\\time``, ``\\partial``) as an
  internal parse-quality measure

Everything else (layout tweaks, markup, Scheme, lyrics, chord names, dynamics...) is skipped.
Embedded Scheme is never executed. Unsupported constructs are recorded in ``warnings``.
"""
from __future__ import annotations

import copy
import os
import re
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Any

import ly.document
import ly.lex
import ly.lex.lilypond as LP
import ly.lex.scheme as SC
import ly.pitch

STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11]
BS = chr(92)  # a single backslash (avoids escaping mistakes in command names)
PROPERTY_COMMANDS = tuple(BS + c for c in ("set", "override", "unset", "revert", "once", "temporary", "undo",
                                           "omit", "hide"))
LANG_FILES = {f"{k}.ly": k for k in ly.pitch.pitchInfo} | {"english.ly": "english", "deutsch.ly": "deutsch",
                                                              "italiano.ly": "italiano", "espanol.ly": "espanol",
                                                              "catalan.ly": "catalan", "portugues.ly": "portugues",
                                                              "norsk.ly": "norsk", "suomi.ly": "suomi",
                                                              "svenska.ly": "svenska", "vlaams.ly": "vlaams",
                                                              "nederlands.ly": "nederlands"}
LANG_ALIASES = {"espanol": "espanol", "español": "espanol", "francais": "italiano", "français": "italiano",
                "arabic": "italiano", "bagpipe": None, "persian": None}


class LyError(Exception):
    pass


# ---------------------------------------------------------------------------------------
# tokens
# ---------------------------------------------------------------------------------------

@dataclass
class Tok:
    cls: str          # python-ly class name, e.g. "Note", "Length", "SchemeStart"
    text: str
    file: str
    line: int
    mod: str = "lilypond"   # lexer module ("lilypond", "scheme", ...)


SKIP_CLASSES = {"Space", "Comment", "LineComment", "BlockComment", "BlockCommentStart", "BlockCommentEnd",
                "BlockCommentSpace", "LineCommentSpace"}


def _token_class_name(tok) -> tuple[str, str]:
    return type(tok).__name__, type(tok).__module__.rsplit(".", 1)[-1]


def tokenize_file(path: Path, seen: set | None = None, depth: int = 0, warnings: list | None = None,
                  search_dirs: list[Path] | None = None) -> list[Tok]:
    """Tokenise ``path`` and splice in local ``\\include`` files (relative to the including
    file, then to ``search_dirs``). Non-local includes (LilyPond's own) become ``Include`` toks."""
    seen = seen if seen is not None else set()
    warnings = warnings if warnings is not None else []
    path = Path(path)
    key = str(path.resolve()).lower()
    if key in seen or depth > 20:
        return []
    seen.add(key)
    raw_bytes = path.read_bytes()
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw_bytes.decode("cp1252", errors="replace")
    doc = ly.document.Document(text, mode="lilypond")
    raw: list[Tok] = []
    for block in doc:
        ln = doc.index(block) + 1
        for t in doc.tokens(block):
            c, m = _token_class_name(t)
            if c in SKIP_CLASSES or (m == "lilypond" and c.endswith("Comment")) or "Comment" in c:
                continue
            raw.append(Tok(c, str(t), path.name, ln, m))
    out: list[Tok] = []
    i = 0
    while i < len(raw):
        t = raw[i]
        if t.cls == "Keyword" and t.text == "\\include":
            # \include "file"
            j = i + 1
            fname = None
            if j < len(raw) and raw[j].cls == "StringQuotedStart":
                parts = []
                j += 1
                while j < len(raw) and raw[j].cls != "StringQuotedEnd":
                    parts.append(raw[j].text)
                    j += 1
                fname = "".join(parts)
                j += 1
            if fname:
                cands = [path.parent / fname] + [d / fname for d in (search_dirs or [])]
                found = next((c for c in cands if c.is_file()), None)
                if found is not None:
                    out += tokenize_file(found, seen, depth + 1, warnings, search_dirs)
                else:
                    out.append(Tok("Include", fname, t.file, t.line))
            i = j
            continue
        out.append(t)
        i += 1
    return out


# ---------------------------------------------------------------------------------------
# AST
# ---------------------------------------------------------------------------------------

@dataclass
class PostEvents:
    fingers: list = field(default_factory=list)      # list of (direction, text)
    tie: bool = False
    is_rest: bool = False   # "c4\\rest"
    arpeggio: bool = False


@dataclass
class NoteN:
    name: str
    octave: int                  # octave marks as written (relative or absolute)
    step: int = 0                # 0..6
    alter: Fraction = Fraction(0)
    dur: Fraction | None = None
    post: PostEvents = field(default_factory=PostEvents)
    octave_check: int | None = None
    abs_octave: int | None = None    # after relative resolution (0 = c, 1 = c')
    file: str = ""
    line: int = 0


@dataclass
class ChordN:
    notes: list
    dur: Fraction | None = None
    post: PostEvents = field(default_factory=PostEvents)
    file: str = ""
    line: int = 0


@dataclass
class QN:
    chord: Any
    dur: Fraction | None = None
    post: PostEvents = field(default_factory=PostEvents)
    file: str = ""
    line: int = 0


@dataclass
class RestN:
    dur: Fraction
    kind: str = "r"
    pitch: Any = None   # positioned rest "d8\rest": the pitch still moves the \relative reference


@dataclass
class SeqN:
    items: list


@dataclass
class SimN:
    items: list


@dataclass
class RelativeN:
    ref: Any
    body: Any


@dataclass
class AbsoluteN:
    body: Any


@dataclass
class FixedN:
    ref: Any
    body: Any


@dataclass
class TransposeN:
    frm: Any
    to: Any
    body: Any


@dataclass
class ScaleN:
    factor: Fraction
    body: Any


@dataclass
class GraceN:
    body: Any
    kind: str = "grace"


@dataclass
class AfterGraceN:
    main: Any
    grace: Any
    fraction: Fraction = Fraction(3, 4)


@dataclass
class RepeatN:
    kind: str
    count: int
    body: Any
    alts: list = field(default_factory=list)


@dataclass
class ContextN:
    ctype: str
    name: str | None
    body: Any
    new: bool = True


@dataclass
class ChangeN:
    staff: str


@dataclass
class PartialN:
    dur: Fraction


@dataclass
class MeasurePosN:
    """``\\set Score.measurePosition = #(ly:make-moment a b)`` (an anacrusis without \\partial)."""
    pos: Fraction


@dataclass
class TimeN:
    num: int
    den: int


@dataclass
class BarCheckN:
    file: str = ""
    line: int = 0


@dataclass
class ClefN:
    clef: str


@dataclass
class TempoN:
    bpm_quarter: float


@dataclass
class AutochangeN:
    body: Any


@dataclass
class TagN:
    tags: list
    body: Any


@dataclass
class KeepTagN:
    tags: list
    body: Any
    keep: bool = True


@dataclass
class UnfoldN:
    body: Any


@dataclass
class ScoreN:
    music: Any
    has_layout: bool
    has_midi: bool
    header: dict
    index: int = 0
    file: str = ""
    line: int = 0


MUSIC_NODES = (NoteN, ChordN, QN, RestN, SeqN, SimN, RelativeN, AbsoluteN, FixedN, TransposeN, ScaleN, GraceN,
               AfterGraceN, RepeatN, ContextN, ChangeN, PartialN, MeasurePosN, TimeN, BarCheckN, ClefN, TempoN,
               AutochangeN, TagN, KeepTagN, UnfoldN)

MUSIC_FUNCS_1 = {"\\grace": "grace", "\\acciaccatura": "acciaccatura", "\\appoggiatura": "appoggiatura",
                 "\\slashedGrace": "slashedGrace"}
NO_ARG_SKIP_PREFIXES = ("\\stem", "\\slur", "\\tie", "\\voice", "\\dynamic", "\\tuplet", "\\phrasing",
                        "\\dots", "\\textSpanner", "\\arpeggio", "\\autoBeam", "\\hairpin", "\\cresc",
                        "\\decresc", "\\dim", "\\sustain", "\\unaCorda", "\\treCorde", "\\sostenuto",
                        "\\oneVoice", "\\cadenza", "\\break", "\\pageBreak", "\\noBreak", "\\noPageBreak",
                        "\\showStaffSwitch", "\\hideStaffSwitch", "\\shiftOn", "\\shiftOff", "\\shiftOnn",
                        "\\shiftOnnn", "\\mergeDifferentlyHeaded", "\\mergeDifferentlyDotted",
                        "\\override", "\\revert", "\\set", "\\unset", "\\once", "\\temporary", "\\undo",
                        "\\numericTimeSignature", "\\defaultTimeSignature", "\\compressFullBarRests",
                        "\\expandFullBarRests", "\\compressEmptyMeasures", "\\expandEmptyMeasures",
                        "\\harmonicsOn", "\\harmonicsOff", "\\easyHeadsOn", "\\easyHeadsOff", "\\xNotesOn",
                        "\\xNotesOff", "\\improvisationOn", "\\improvisationOff", "\\hideNotes",
                        "\\unHideNotes", "\\textLengthOn", "\\textLengthOff", "\\markLengthOn",
                        "\\markLengthOff", "\\predefinedFretboardsOn", "\\predefinedFretboardsOff",
                        "\\balloonLengthOn", "\\balloonLengthOff", "\\startTrillSpan", "\\stopTrillSpan",
                        "\\startTextSpan", "\\stopTextSpan", "\\startGroup", "\\stopGroup", "\\ignore",
                        "\\melisma", "\\melismaEnd", "\\autoLineBreaksOn", "\\autoLineBreaksOff",
                        "\\autoPageBreaksOn", "\\autoPageBreaksOff", "\\clusterOn", "\\clusterOff",
                        "\\deadNotesOn", "\\deadNotesOff", "\\bassFigure", "\\endSpanners",
                        "\\stopStaff", "\\startStaff", "\\newSpacingSection", "\\pointAndClick",
                        "\\fermataMarkup", "\\breathe", "\\default", "\\italianChords", "\\germanChords",
                        "\\semiGermanChords", "\\frenchChords", "\\powerChords", "\\accepts", "\\denies",
                        "\\consists", "\\remove", "\\alias", "\\defaultchild", "\\name", "\\type",
                        "\\description", "\\inherit-acceptability", "\\portato", "\\staccato",
                        "\\staccatissimo", "\\tenuto", "\\accent", "\\marcato", "\\espressivo",
                        "\\fermata", "\\trill", "\\prall", "\\mordent", "\\turn", "\\reverseturn",
                        "\\prallprall", "\\prallmordent", "\\upprall", "\\downprall", "\\upmordent",
                        "\\downmordent", "\\lineprall", "\\prallup", "\\pralldown", "\\shortfermata",
                        "\\longfermata", "\\verylongfermata", "\\segno", "\\coda", "\\varcoda",
                        "\\signumcongruentiae", "\\thumb", "\\open", "\\stopped", "\\flageolet",
                        "\\halfopen", "\\snappizzicato", "\\upbow", "\\downbow", "\\lheel", "\\rheel",
                        "\\ltoe", "\\rtoe", "\\glissando", "\\laissezVibrer", "\\repeatTie", "\\noBeam",
                        "\\fff", "\\ff", "\\f", "\\mf", "\\mp", "\\p", "\\pp", "\\ppp", "\\sf", "\\sfz",
                        "\\fp", "\\rfz", "\\sp", "\\spp", "\\fz", "\\sff", "\\pppp", "\\ffff",
                        "\\allowPageTurn", "\\grobdescriptions", "\\featherDurations", "\\harmonic",
                        "\\afterGraceFraction", "\\addQuote", "\\quoteDuring", "\\cueDuring",
                        "\\enablePolymeter", "\\RemoveEmptyStaves", "\\RemoveAllEmptyStaves",
                        "\\Staff", "\\Score", "\\Voice", "\\PianoStaff", "\\GrandStaff", "\\Lyrics",
                        "\\Dynamics", "\\StaffGroup", "\\ChoirStaff", "\\RhythmicStaff", "\\ChordNames",
                        "\\FiguredBass", "\\TabStaff", "\\TabVoice", "\\DrumStaff", "\\DrumVoice",
                        "\\NullVoice", "\\CueVoice", "\\Devnull", "\\Global", "\\Timing")


# ---------------------------------------------------------------------------------------
# parser
# ---------------------------------------------------------------------------------------

class Parser:
    def __init__(self, toks: list[Tok], language: str = "nederlands", version: tuple = (2, 18)):
        self.t = toks
        self.i = 0
        self.vars: dict[str, Any] = {}
        self.language = language
        self.reader = ly.pitch.pitchReader(language)
        self.last_dur = Fraction(1, 4)
        self.last_chord: ChordN | None = None
        self.scores: list[ScoreN] = []
        self.toplevel_music: list = []
        self.header: dict = {}
        self.warnings: list[str] = []
        self.version = version
        self.unknown_commands: dict[str, int] = {}

    # --- helpers ------------------------------------------------------------------------
    def peek(self, k: int = 0) -> Tok | None:
        j = self.i + k
        return self.t[j] if j < len(self.t) else None

    def next(self) -> Tok:
        tok = self.t[self.i]
        self.i += 1
        return tok

    def at(self, cls: str, text: str | None = None, k: int = 0) -> bool:
        p = self.peek(k)
        return p is not None and p.cls == cls and (text is None or p.text == text)

    def warn(self, msg: str) -> None:
        if len(self.warnings) < 500:
            self.warnings.append(msg)

    def set_language(self, lang: str) -> None:
        lang = LANG_ALIASES.get(lang, lang)
        if lang in ly.pitch.pitchInfo:
            self.language = lang
            self.reader = ly.pitch.pitchReader(lang)
        else:
            self.warn(f"unsupported language {lang!r}")

    # --- skipping -----------------------------------------------------------------------
    def skip_scheme(self) -> str:
        """Skip a Scheme expression after '#'; return its text (for small values)."""
        assert self.peek().cls == "SchemeStart"
        self.next()
        buf = []
        p = self.peek()
        if p is None:
            return ""
        depth = 0
        # quote/quasiquote prefixes
        while p is not None and p.mod == "scheme" and p.text in ("'", "`", ",", ",@"):
            buf.append(self.next().text)
            p = self.peek()
        if p is None:
            return "".join(buf)
        if p.cls in ("OpenParen", "VectorStart") or p.text in ("(", "#("):
            while self.peek() is not None:
                q = self.next()
                buf.append(q.text)
                if q.mod == "scheme" and (q.cls in ("OpenParen", "VectorStart") or q.text == "("):
                    depth += 1
                elif q.mod == "scheme" and (q.cls == "CloseParen" or q.text == ")"):
                    depth -= 1
                    if depth == 0:
                        break
                elif q.cls == "LilyPondStart":
                    self._skip_embedded_lilypond()
            return " ".join(buf)
        if p.cls == "LilyPondStart":
            self.next()
            self._skip_embedded_lilypond()
            return ""
        if p.cls == "StringQuotedStart":
            return self.read_string()
        q = self.next()
        buf.append(q.text)
        return "".join(buf)

    def _skip_embedded_lilypond(self) -> None:
        """Skip ``#{ ... #}`` (already past ``#{``); handles nesting."""
        depth = 1
        while self.peek() is not None and depth > 0:
            q = self.next()
            if q.cls == "LilyPondStart":
                depth += 1
            elif q.cls == "LilyPondEnd":
                depth -= 1

    def _skip_until_cls(self, cls: str) -> None:
        while self.peek() is not None and self.peek().cls != cls:
            self.next()
        if self.peek() is not None:
            self.next()

    def read_string(self) -> str:
        assert self.peek().cls == "StringQuotedStart"
        self.next()
        parts = []
        while self.peek() is not None and self.peek().cls != "StringQuotedEnd":
            parts.append(self.next().text)
        if self.peek() is not None:
            self.next()
        return "".join(parts)

    def skip_markup(self) -> list[str]:
        """Skip a \\markup / \\markuplist expression; return fingering texts found inside."""
        self.next()  # \markup / \markuplist
        # python-ly's lexer tracks markup mode: every token of the markup expression is a
        # Markup*/bracket/string/scheme token, and the first token after it is a music token.
        fingers: list[str] = []
        expect_finger = False
        while self.peek() is not None:
            p = self.peek()
            c = p.cls
            if c in ("OpenBracketMarkup", "CloseBracketMarkup") or c.startswith("Markup"):
                if c == "MarkupCommand" and p.text == BS + "finger":
                    expect_finger = True
                elif c == "MarkupWord" and expect_finger:
                    fingers.append(p.text)
                    expect_finger = False
                self.next()
                continue
            if c == "StringQuotedStart":
                s = self.read_string()
                if expect_finger:
                    fingers.append(s)
                    expect_finger = False
                continue
            if c == "SchemeStart":
                s = self.skip_scheme()
                if expect_finger:
                    fingers.append(s.strip('"'))
                    expect_finger = False
                continue
            if p.mod == "scheme":
                self.next()
                continue
            break
        return fingers

    def skip_block(self) -> None:
        """Skip a { ... } block of any kind (header/paper/layout/midi/with/lyrics...)."""
        opens = ("OpenBracket", "SequentialStart", "OpenBracketMarkup", "SimultaneousStart")
        closes = ("CloseBracket", "SequentialEnd", "CloseBracketMarkup", "SimultaneousEnd")
        p = self.peek()
        if p is None or p.cls not in opens:
            return
        depth = 0
        while self.peek() is not None:
            q = self.next()
            if q.cls in opens:
                depth += 1
            elif q.cls in closes:
                depth -= 1
                if depth == 0:
                    return

    def parse_header(self) -> dict:
        hdr: dict = {}
        if not (self.at("OpenBracket") or self.at("SequentialStart")):
            return hdr
        self.next()
        depth = 1
        while self.peek() is not None and depth > 0:
            p = self.peek()
            if p.cls in ("CloseBracket", "SequentialEnd"):
                depth -= 1
                self.next()
                continue
            if p.cls in ("OpenBracket", "SequentialStart"):
                depth += 1
                self.next()
                continue
            if p.cls in ("Name", "HeaderVariable", "Variable", "UserVariable") and self.at("EqualSign", k=1):
                key = self.next().text
                self.next()
                if self.at("StringQuotedStart"):
                    hdr[key] = self.read_string()
                elif self.at("MarkupStart"):
                    self.skip_markup()
                elif self.at("SchemeStart"):
                    hdr[key] = self.skip_scheme().strip('"')
                elif self.peek() is not None and self.peek().cls == "UserCommand":
                    self.next()
                continue
            if p.cls == "MarkupStart":
                self.skip_markup()
                continue
            if p.cls == "SchemeStart":
                self.skip_scheme()
                continue
            if p.cls == "StringQuotedStart":
                self.read_string()
                continue
            self.next()
        return hdr

    # --- durations / pitches -------------------------------------------------------------
    def parse_duration(self, set_default: bool = True) -> Fraction | None:
        p = self.peek()
        if p is None or p.cls != "Length":
            return None
        txt = self.next().text
        if txt == "\\breve":
            base = Fraction(2)
        elif txt == "\\longa":
            base = Fraction(4)
        elif txt == "\\maxima":
            base = Fraction(8)
        else:
            try:
                base = Fraction(1, int(txt))
            except (ValueError, ZeroDivisionError):
                self.warn(f"bad length {txt}")
                base = Fraction(1, 4)
        d = base
        add = base
        while self.at("Dot"):
            self.next()
            add /= 2
            d += add
        while self.at("Scaling"):
            s = self.next().text.lstrip("*")
            try:
                d *= Fraction(s)
            except (ValueError, ZeroDivisionError):
                self.warn(f"bad scaling {s}")
        if set_default:
            self.last_dur = d
        return d

    def parse_pitch_token(self) -> NoteN:
        tok = self.next()
        r = self.reader(tok.text)
        if not r:
            # try other languages as a fallback (files sometimes omit \language)
            for lang in ("nederlands", "english", "deutsch", "italiano"):
                r = ly.pitch.pitchReader(lang)(tok.text)
                if r:
                    break
        if not r:
            self.warn(f"{tok.file}:{tok.line}: unknown pitch name {tok.text!r} (skipped)")
            while self.at("Octave") or self.at("Length") or self.at("Dot"):
                self.next()
            return None
        step, alter = r
        octave = 0
        if self.at("Octave"):
            octave = ly.pitch.octaveToNum(self.next().text)
        n = NoteN(tok.text, octave, step, Fraction(alter), file=tok.file, line=tok.line)
        while self.at("Accidental") or self.at("AccidentalReminder") or self.at("AccidentalCautionary"):
            self.next()
        if self.at("OctaveCheck"):
            txt = self.next().text
            oc = self.peek()
            if oc is not None and oc.cls == "Octave":
                n.octave_check = ly.pitch.octaveToNum(self.next().text)
            else:
                n.octave_check = 0 if txt == "=" else ly.pitch.octaveToNum(txt.lstrip("="))
        return n

    def parse_simple_pitch(self) -> NoteN:
        if not self.at("Note"):
            raise LyError(f"expected pitch at {self._where()}")
        n = self.parse_pitch_token()
        if n is None:
            raise LyError(f"bad pitch at {self._where()}")
        return n

    def _where(self) -> str:
        p = self.peek()
        return f"{p.file}:{p.line} ({p.cls} {p.text!r})" if p else "EOF"

    # --- post events ---------------------------------------------------------------------
    def parse_post_events(self, pe: PostEvents) -> None:
        while self.peek() is not None:
            p = self.peek()
            c = p.cls
            if c == "Tie":
                self.next()
                pe.tie = True
            elif c == "Direction":
                d = self.next().text
                q = self.peek()
                if q is None:
                    break
                if q.cls == "Fingering":
                    pe.fingers.append((d, self.next().text))
                elif q.cls == "Tie":                 # directed tie: c^~ / c_~
                    self.next()
                    pe.tie = True
                elif q.cls == "MarkupStart":
                    for f in self.skip_markup():
                        pe.fingers.append((d, f))
                elif q.cls == "StringQuotedStart":
                    self.read_string()
                elif q.cls in ("Command", "UserCommand") and q.text == "\\finger":
                    self.next()
                    if self.at("StringQuotedStart"):
                        pe.fingers.append((d, self.read_string()))
                    elif self.at("SchemeStart"):
                        pe.fingers.append((d, self.skip_scheme().strip('"')))
                    elif self.at("MarkupStart"):
                        for f in self.skip_markup():
                            pe.fingers.append((d, f))
                    elif self.at("Fingering") or self.at("IntegerValue"):
                        pe.fingers.append((d, self.next().text))
                elif q.cls == "Command" and q.text == "\\tweak":
                    self.skip_tweak()
                elif q.cls == "SchemeStart":
                    self.skip_scheme()
                elif q.cls in ("Command", "UserCommand", "Articulation", "ArticulationCommand",
                               "ScriptAbbreviation", "Dynamic",
                               "StringNumber", "SlurStart", "SlurEnd", "PhrasingSlurStart",
                               "PhrasingSlurEnd", "Tie", "BeamStart", "BeamEnd"):
                    self.next()
                    if q.text == "\\rightHandFinger" and self.at("SchemeStart"):
                        self.skip_scheme()
                    elif q.text == "\\bendAfter" and self.at("SchemeStart"):
                        self.skip_scheme()
                else:
                    self.next()
            elif c in ("Articulation", "ArticulationCommand", "TremoloDuration", "Dynamic", "SlurStart",
                       "SlurEnd", "PhrasingSlurStart",
                       "PhrasingSlurEnd", "BeamStart", "BeamEnd", "StringNumber", "Tremolo",
                       "TremoloColon", "TremoloDuration", "ScriptAbbreviation", "Spanner", "SpannerStart",
                       "SpannerEnd", "Hairpin", "HairpinStart", "HairpinEnd", "Ligature", "LigatureStart",
                       "LigatureEnd", "Slur", "Beam", "Arpeggio", "Fingering"):
                if c == "Fingering":  # fingering without explicit direction (rare)
                    pe.fingers.append(("-", self.next().text))
                else:
                    if p.text == "\\arpeggio":
                        pe.arpeggio = True
                    self.next()
            elif c == "Command" and p.text == "\\rest":
                self.next()
                pe.is_rest = True
            elif c == "Command" and p.text == "\\finger":
                self.next()
                if self.at("StringQuotedStart"):
                    pe.fingers.append(("-", self.read_string()))
                elif self.at("SchemeStart"):
                    pe.fingers.append(("-", self.skip_scheme().strip('"')))
            elif c == "Command" and p.text in ("\\arpeggio", "\\glissando", "\\fermata", "\\trill", "\\prall",
                                                "\\mordent", "\\turn", "\\staccato", "\\accent", "\\tenuto",
                                                "\\marcato", "\\sustainOn", "\\sustainOff", "\\startTrillSpan",
                                                "\\stopTrillSpan", "\\laissezVibrer", "\\noBeam", "\\breathe",
                                                "\\startTextSpan", "\\stopTextSpan", "\\upbow", "\\downbow",
                                                "\\espressivo", "\\portato", "\\staccatissimo", "\\thumb",
                                                "\\cresc", "\\decresc", "\\dim", "\\!", "\\<", "\\>", "\\(",
                                                "\\)", "\\repeatTie", "\\harmonic", "\\unaCorda",
                                                "\\treCorde", "\\sostenutoOn", "\\sostenutoOff",
                                                "\\shortfermata", "\\longfermata", "\\upprall", "\\prallprall",
                                                "\\reverseturn", "\\segno", "\\coda", "\\open", "\\stopped",
                                                "\\flageolet", "\\snappizzicato", "\\lheel", "\\rheel",
                                                "\\ltoe", "\\rtoe", "\\prallmordent", "\\downprall",
                                                "\\upmordent", "\\downmordent", "\\lineprall", "\\prallup",
                                                "\\pralldown", "\\verylongfermata", "\\varcoda",
                                                "\\signumcongruentiae", "\\halfopen"):
                if p.text == "\\arpeggio":
                    pe.arpeggio = True
                self.next()
            elif c == "Dynamic" or (c == "Command" and p.text in ("\\f", "\\p", "\\ff", "\\pp", "\\mf", "\\mp",
                                                                  "\\sf", "\\sfz", "\\fp", "\\fff", "\\ppp",
                                                                  "\\rfz", "\\fz", "\\sp", "\\spp")):
                self.next()
            else:
                break

    def skip_tweak(self) -> None:
        self.next()  # \tweak
        while self.at("Name") or self.at("GrobName") or self.at("ContextName") or self.at("Dot") or \
                self.at("GrobProperty") or self.at("ContextProperty") or self.at("Variable"):
            self.next()
        if self.at("SchemeStart"):
            self.skip_scheme()
        elif self.at("StringQuotedStart"):
            self.read_string()
        elif self.at("MarkupStart"):
            self.skip_markup()

    # --- music -----------------------------------------------------------------------------
    def parse_note_or_chord_tail(self, node) -> None:
        dur = self.parse_duration()
        if dur is None:
            dur = self.last_dur
        node.dur = dur
        self.parse_post_events(node.post)

    def parse_music(self) -> Any:
        """Parse one music expression; return an AST node or None (no music here)."""
        while True:
            p = self.peek()
            if p is None:
                return None
            c, txt = p.cls, p.text
            if c == "SequentialStart" or (c == "OpenBracket" and txt == "{"):
                self.next()
                items = self.parse_music_list(("SequentialEnd", "CloseBracket"))
                return SeqN(items)
            if c == "SimultaneousStart":
                self.next()
                return self.parse_simultaneous()
            if c == "Note":
                n = self.parse_pitch_token()
                if n is None:
                    continue
                self.parse_note_or_chord_tail(n)
                if n.post.is_rest:
                    return RestN(n.dur, "r", pitch=n)
                return n
            if c == "ChordStart":
                return self.parse_chord()
            if c == "Q":
                tok = self.next()
                q = QN(self.last_chord, file=tok.file, line=tok.line)
                self.parse_note_or_chord_tail(q)
                if self.last_chord is None:
                    self.warn(f"{tok.file}:{tok.line}: q without previous chord")
                    return RestN(q.dur, "s")
                return q
            if c in ("Rest", "Spacer", "Skip"):
                tok = self.next()
                kind = tok.text
                if kind == "\\skip":
                    d = self.parse_duration(set_default=False) or self.last_dur
                else:
                    d = self.parse_duration() or self.last_dur
                pe = PostEvents()
                self.parse_post_events(pe)
                return RestN(d, kind)
            if c == "Command" and txt == "\\skip":
                self.next()
                d = self.parse_duration(set_default=False) or self.last_dur
                return RestN(d, "s")
            if c == "PitchCommand" and txt == "\\relative":
                self.next()
                ref = None
                if self.at("Note"):
                    ref = self.parse_pitch_token()
                body = self.parse_music()
                return RelativeN(ref, body)
            if c == "PitchCommand" and txt == "\\transpose":
                self.next()
                a = self.parse_simple_pitch()
                b = self.parse_simple_pitch()
                body = self.parse_music()
                return TransposeN(a, b, body)
            if (c in ("Command", "PitchCommand")) and txt == "\\fixed":
                self.next()
                ref = self.parse_simple_pitch()
                return FixedN(ref, self.parse_music())
            if c == "Command" and txt == "\\absolute":
                self.next()
                return AbsoluteN(self.parse_music())
            if c == "PitchCommand" and txt in ("\\key",):
                self.next()
                if self.at("Note"):
                    self.parse_pitch_token()
                if self.at("KeySignatureMode") or self.at("Command") and self.peek().text in (
                        "\\major", "\\minor", "\\dorian", "\\mixolydian", "\\lydian", "\\phrygian",
                        "\\locrian", "\\ionian", "\\aeolian"):
                    self.next()
                elif self.at("SchemeStart"):
                    self.skip_scheme()
                continue
            if c == "PitchCommand" and txt in ("\\transposition",):
                self.next()
                if self.at("Note"):
                    self.parse_pitch_token()
                continue
            if c == "PitchCommand" and txt in ("\\octaveCheck",):
                self.next()
                if self.at("Note"):
                    self.parse_pitch_token()
                continue
            if c == "Command" and txt == BS + "parallelMusic":
                self.parse_parallel_music()   # defines the voice variables; yields no music itself
                return SeqN([])
            if c == "Command" and txt in ("\\times", "\\tuplet", "\\scaleDurations"):
                return self.parse_scaler()
            if c == "Command" and txt in MUSIC_FUNCS_1:
                self.next()
                body = self.parse_music()
                return GraceN(body, MUSIC_FUNCS_1[txt])
            if c == "Command" and txt == "\\afterGrace":
                self.next()
                frac = Fraction(3, 4)
                if self.at("Fraction"):
                    try:
                        frac = Fraction(self.next().text)
                    except ValueError:
                        pass
                elif self.at("SchemeStart"):
                    self.skip_scheme()
                main = self.parse_music()
                grace = self.parse_music()
                return AfterGraceN(main, grace, frac)
            if c == "Repeat":
                return self.parse_repeat()
            if c in ("New", "Context"):
                return self.parse_context()
            if c == "Change":
                self.next()
                if self.at("ContextName") or self.at("Name"):
                    self.next()
                if self.at("EqualSign"):
                    self.next()
                name = None
                if self.at("StringQuotedStart"):
                    name = self.read_string()
                elif self.peek() is not None:
                    name = self.next().text
                return ChangeN(name or "")
            if c == "Partial":
                self.next()
                d = self.parse_duration(set_default=False)
                if self.at("SchemeStart"):
                    self.skip_scheme()
                return PartialN(d or Fraction(0))
            if c == "Command" and txt == "\\time":
                self.next()
                if self.at("Fraction"):
                    num, den = self.next().text.split("/")
                    try:
                        return TimeN(int(num.split(",")[-1]), int(den))
                    except ValueError:
                        return TimeN(4, 4)
                if self.at("SchemeStart"):
                    self.skip_scheme()
                    if self.at("Fraction"):
                        num, den = self.next().text.split("/")
                        return TimeN(int(num), int(den))
                return None if False else TimeN(4, 4)
            if c == "Clef":
                self.next()
                clef = ""
                if self.at("ClefSpecifier"):
                    clef = self.next().text
                elif self.at("StringQuotedStart"):
                    clef = self.read_string()
                return ClefN(clef)
            if c == "Tempo":
                return self.parse_tempo()
            if c == "PipeSymbol":
                tok = self.next()
                return BarCheckN(tok.file, tok.line)
            if c == "VoiceSeparator":
                return "VOICESEP"
            if c == "Command" and txt in ("\\autochange", "\\autoChange"):
                self.next()
                if self.at("Note"):
                    self.parse_pitch_token()
                return AutochangeN(self.parse_music())
            if c == "Command" and txt in ("\\partcombine", "\\partCombine", "\\partcombineUp",
                                          "\\partcombineDown"):
                self.next()
                a = self.parse_music()
                b = self.parse_music()
                return SimN([a, b])
            if c == "Command" and txt in ("\\unfoldRepeats", "\\unfoldrepeats"):
                self.next()
                if self.at("SchemeStart"):
                    self.skip_scheme()
                return UnfoldN(self.parse_music())
            if c == "Command" and txt == "\\tag":
                self.next()
                tags = self._tag_list()
                return TagN(tags, self.parse_music())
            if c == "Command" and txt in ("\\keepWithTag", "\\removeWithTag"):
                self.next()
                tags = self._tag_list()
                return KeepTagN(tags, self.parse_music(), keep=txt == "\\keepWithTag")
            if c == "Command" and txt in ("\\applyMusic", "\\applyContext", "\\applyOutput"):
                self.next()
                if self.at("SchemeStart"):
                    self.skip_scheme()
                if txt == "\\applyMusic":
                    return self.parse_music()
                continue
            if c == "Command" and txt in ("\\articulate", "\\displayMusic", "\\void", "\\inStaffSegno",
                                          "\\parenthesize", "\\crossStaff", "\\magnifyMusic"):
                self.next()
                if txt == "\\magnifyMusic" and self.at("SchemeStart"):
                    self.skip_scheme()
                continue
            if c in ("LyricMode", "Lyricmode") or txt in ("\\lyricmode", "\\addlyrics", "\\lyrics",
                                                           "\\chordmode", "\\chords", "\\figuremode",
                                                           "\\figures", "\\drummode", "\\drums",
                                                           "\\lyricsto"):
                self.next()
                if txt == "\\lyricsto":
                    if self.at("StringQuotedStart"):
                        self.read_string()
                    elif self.peek() is not None:
                        self.next()
                self.skip_block()
                continue
            if c == "MarkupStart":
                self.skip_markup()
                continue
            if c == "SchemeStart":
                self.skip_scheme()
                continue
            if c == "StringQuotedStart":
                self.read_string()
                continue
            if c in self.PROPERTY_CLASSES or (c == "Command" and txt in PROPERTY_COMMANDS):
                node = self.skip_property_command()
                if node is not None:
                    return node
                continue
            if c == "Tweak" or (c == "Command" and txt == BS + "tweak"):
                self.skip_tweak()
                continue
            if c == "SimultaneousOrSequentialCommand":
                self.next()
                if self.at("SequentialStart") or self.at("OpenBracket"):
                    self.next()
                    items = self.parse_music_list(("SequentialEnd", "CloseBracket"))
                    return SimN(items) if txt == BS + "simultaneous" else SeqN(items)
                continue
            if c == "NoteMode":
                self.next()
                continue
            if c in ("MarkupList", "MarkupLines"):
                self.skip_markup()
                continue
            if c.startswith("Lyric") or c.startswith("Figure") or c.startswith("Chord") and c not in (
                    "ChordStart", "ChordEnd") or c in ("ErrorInChord", "Unparsed", "DotPath", "ContextProperty",
                                                       "GrobName", "GrobProperty", "BackSlashedContextName",
                                                       "LayoutVariable", "PaperVariable", "HeaderVariable",
                                                       "AccidentalStyleSpecifier", "Unit", "TremoloColon",
                                                       "TremoloDuration", "ArticulationCommand"):
                if c in ("LyricMode",):
                    self.next()
                    self.skip_block()
                    continue
                self.next()
                continue
            if c in ("Name", "UserVariable", "Variable") and self.at("EqualSign", k=1):
                return None  # an assignment: never swallow it as part of a music expression
            if c in ("Score", "Book", "BookPart"):
                return None  # toplevel blocks end any music expression (handled by parse_file)
            if c == "UserCommand":
                name = txt[1:]
                tok = self.next()
                if name in self.vars:
                    v = self.vars[name]
                    if isinstance(v, MUSIC_NODES):
                        return copy.deepcopy(v)
                    continue  # non-music variable (markup, number...)
                self.unknown_commands[txt] = self.unknown_commands.get(txt, 0) + 1
                continue
            if c in ("Command", "Keyword", "Dynamic", "Articulation", "ScriptAbbreviation", "Direction",
                     "StringNumber", "Tie", "SlurStart", "SlurEnd", "BeamStart", "BeamEnd",
                     "PhrasingSlurStart", "PhrasingSlurEnd", "Fingering", "Length", "Dot", "Scaling",
                     "Fraction", "IntegerValue", "DecimalValue", "EqualSign", "Name", "ContextName",
                     "GrobName", "ContextProperty", "GrobProperty", "Variable", "ClefSpecifier",
                     "KeySignatureMode", "Octave", "OctaveCheck", "AccidentalReminder",
                     "AccidentalCautionary", "Accidental", "RepeatSpecifier", "RepeatCount", "Unit",
                     "Spanner", "Hairpin", "Tremolo", "Unparsed", "OpenBracket", "PitchCommand",
                     "Layout", "Midi", "Header", "Paper", "With", "Include", "Mark", "Bar",
                     "Change", "ChordModifier", "ChordSeparator", "ChordStepNumber", "DotChord",
                     "UserVariable", "Error", "SchemeLilyEnd"):
                if c == "Command" and txt in ("\\set", "\\override", "\\unset", "\\revert", "\\once",
                                              "\\temporary"):
                    self.skip_property_command()
                    continue
                if c == "Command" and txt in ("\\bar", "\\mark", "\\ottava", "\\label", "\\barNumberCheck",
                                              "\\tweak", "\\omit", "\\hide", "\\shape", "\\footnote",
                                              "\\fontSize", "\\textMark", "\\sectionLabel", "\\sostenuto",
                                              "\\breathe", "\\caesura", "\\section", "\\fine",
                                              "\\codaMark", "\\segnoMark", "\\jump", "\\stopStaff"):
                    self.next()
                    self._skip_simple_args(txt)
                    continue
                if c in ("With",):
                    self.next()
                    self.skip_block()
                    continue
                if c in ("Layout", "Midi", "Header", "Paper"):
                    self.next()
                    self.skip_block()
                    continue
                if c == "Command" and not txt.startswith(NO_ARG_SKIP_PREFIXES):
                    self.unknown_commands[txt] = self.unknown_commands.get(txt, 0) + 1
                self.next()
                continue
            # anything else (closing brackets etc.) ends this music expression
            return None

    def _tag_list(self) -> list:
        tags = []
        if self.at("SchemeStart"):
            s = self.skip_scheme()
            tags = re.findall(r"[A-Za-z][\w-]*", s)
        elif self.at("Name") or self.at("Variable") or self.at("UserVariable"):
            tags = [self.next().text]
        return tags

    def _skip_simple_args(self, cmd: str) -> None:
        if cmd in ("\\bar", "\\label", "\\textMark", "\\sectionLabel"):
            if self.at("StringQuotedStart"):
                self.read_string()
            elif self.at("SchemeStart"):
                self.skip_scheme()
            elif self.at("MarkupStart"):
                self.skip_markup()
        elif cmd in ("\\mark", "\\jump"):
            if self.at("StringQuotedStart"):
                self.read_string()
            elif self.at("SchemeStart"):
                self.skip_scheme()
            elif self.at("MarkupStart"):
                self.skip_markup()
            elif self.at("Command", "\\default") or self.at("Keyword", "\\default"):
                self.next()
        elif cmd in ("\\ottava", "\\barNumberCheck", "\\fontSize"):
            if self.at("SchemeStart"):
                self.skip_scheme()
            elif self.at("IntegerValue"):
                self.next()
        elif cmd in ("\\tweak",):
            self.i -= 1
            self.skip_tweak()
        elif cmd in ("\\omit", "\\hide"):
            while self.at("ContextName") or self.at("GrobName") or self.at("Name") or self.at("Dot"):
                self.next()
        elif cmd == "\\shape":
            if self.at("SchemeStart"):
                self.skip_scheme()
            while self.at("GrobName") or self.at("Name") or self.at("ContextName") or self.at("Dot"):
                self.next()
        elif cmd == "\\footnote":
            for _ in range(3):
                if self.at("SchemeStart"):
                    self.skip_scheme()
                elif self.at("MarkupStart"):
                    self.skip_markup()
                elif self.at("StringQuotedStart"):
                    self.read_string()

    PROPERTY_CLASSES = ("Override", "Set", "Revert", "Unset", "Omit", "Hide", "AccidentalStyle")
    PATH_CLASSES = ("ContextName", "GrobName", "Name", "Dot", "DotPath", "ContextProperty", "GrobProperty",
                    "Variable", "UserVariable", "Unparsed", "BackSlashedContextName", "AccidentalStyleSpecifier")

    def skip_property_command(self) -> Any:
        """Skip \\set/\\override/... ; returns a MeasurePosN for ``\\set Score.measurePosition``."""
        tok = self.next()
        cmd = tok.text
        if cmd in (BS + "once", BS + "temporary", BS + "undo"):
            if self.peek() is not None and (self.peek().cls in self.PROPERTY_CLASSES or
                                            self.peek().text in PROPERTY_COMMANDS or
                                            self.peek().text == BS + "tweak"):
                if self.peek().text == BS + "tweak" or self.peek().cls == "Tweak":
                    self.skip_tweak()
                else:
                    return self.skip_property_command()
            return None
        guard = 0
        path = []
        expects_value = cmd in (BS + "set", BS + "override")
        last_line = tok.line
        while self.peek() is not None and guard < 16:
            guard += 1
            p = self.peek()
            if p.cls in self.PATH_CLASSES:
                # a name followed by "=" on a new line (or after \revert/\unset/\omit/\hide, which take
                # no value) starts the next assignment, not this property path
                if self.at("EqualSign", k=1) and (not expects_value or p.line != last_line):
                    break
                path.append(self.next().text)
                last_line = p.line
                continue
            if p.cls == "SchemeStart" and cmd in (BS + "override", BS + "revert") and not self.at("EqualSign"):
                # old syntax: \override Stem #'length = #5 / \revert Stem #'length
                self.skip_scheme()
                if cmd == BS + "revert":
                    break
                continue
            break
        if cmd in (BS + "set", BS + "override") and self.at("EqualSign"):
            self.next()
            if self.at("SchemeStart"):
                val = self.skip_scheme()
                if path and path[-1] == "measurePosition":
                    m = re.search(r"make-moment\s+(-?\d+)\s*/?\s*(\d+)?", val)
                    if m:
                        return MeasurePosN(Fraction(int(m.group(1)), int(m.group(2) or 1)))
            elif self.at("StringQuotedStart"):
                self.read_string()
            elif self.at("MarkupStart") or self.at("MarkupList"):
                self.skip_markup()
            elif self.peek() is not None and self.peek().cls in ("IntegerValue", "DecimalValue", "Fraction",
                                                                 "UserCommand", "Name", "Note", "Command",
                                                                 "BackSlashedContextName"):
                self.next()
        return None

    def parse_tempo(self) -> Any:
        self.next()
        if self.at("StringQuotedStart"):
            self.read_string()
        elif self.at("MarkupStart"):
            self.skip_markup()
        bpm = None
        if self.at("Length"):
            d = self.parse_duration(set_default=False)
            if self.at("EqualSign"):
                self.next()
                if self.at("IntegerValue"):
                    v = int(self.next().text)
                    bpm = v * float(d / Fraction(1, 4))
                    if self.at("Unparsed") or (self.peek() is not None and self.peek().text == "-"):
                        self.next()
                        if self.at("IntegerValue"):
                            self.next()
        return TempoN(bpm)  # never None: the tokens were consumed (None would mean "no music here")

    def parse_scaler(self) -> Any:
        cmd = self.next().text
        factor = Fraction(1)
        if self.at("Fraction"):
            fr = Fraction(self.next().text)
            factor = fr if cmd in ("\\times", "\\scaleDurations") else 1 / fr
        elif self.at("SchemeStart"):
            s = self.skip_scheme()
            m = re.search(r"(\d+)\s*\.\s*(\d+)", s)
            if m:
                fr = Fraction(int(m.group(1)), int(m.group(2)))
                factor = fr if cmd in ("\\times", "\\scaleDurations") else 1 / fr
        if cmd == "\\tuplet" and self.at("Length"):
            self.parse_duration(set_default=False)  # tuplet span duration
        body = self.parse_music()
        return ScaleN(factor, body)

    def parse_repeat(self) -> Any:
        self.next()
        kind = "volta"
        if self.at("RepeatSpecifier"):
            kind = self.next().text
        elif self.at("StringQuotedStart"):          # \repeat "tremolo" 4 {...} (older syntax)
            kind = self.read_string().strip()
        elif self.at("Name") or self.at("Unparsed"):
            kind = self.next().text
        count = 2
        if self.at("RepeatCount") or self.at("IntegerValue") or (self.peek() is not None and
                                                                   self.peek().text.isdigit()):
            try:
                count = int(self.next().text)
            except ValueError:
                pass
        body = self.parse_music()
        alts = []
        if self.at("Command", "\\alternative") or self.at("Keyword", "\\alternative"):
            self.next()
            if self.at("SequentialStart") or self.at("OpenBracket"):
                self.next()
                while self.peek() is not None and not (self.at("SequentialEnd") or self.at("CloseBracket")):
                    m = self.parse_music()
                    if m is None or m == "VOICESEP":
                        if self.peek() is not None and not (self.at("SequentialEnd") or self.at("CloseBracket")):
                            self.next()
                        continue
                    alts.append(m)
                if self.peek() is not None:
                    self.next()
        return RepeatN(kind, count, body, alts)

    def parse_context(self) -> Any:
        new = self.next().text == "\\new"
        ctype = self.next().text if (self.at("ContextName") or self.at("Name")) else "Voice"
        name = None
        if self.at("EqualSign"):
            self.next()
            if self.at("StringQuotedStart"):
                name = self.read_string()
            elif self.peek() is not None:
                name = self.next().text
        while self.at("With"):
            self.next()
            self.skip_block()
        if ctype in ("Lyrics", "ChordNames", "FiguredBass", "FretBoards", "NoteNames", "TabStaff",
                     "DrumStaff", "Dynamics"):
            # skip their content entirely
            m = self.parse_music_or_skip_lyrics(ctype)
            return ContextN(ctype, name, m, new)
        body = self.parse_music()
        return ContextN(ctype, name, body, new)

    def parse_music_or_skip_lyrics(self, ctype: str) -> Any:
        if ctype == "Dynamics":
            return self.parse_music()
        p = self.peek()
        if p is not None and p.cls in ("SequentialStart", "SimultaneousStart", "OpenBracket"):
            self.skip_block()
            return None
        if p is not None and (p.cls in ("LyricMode",) or p.text in ("\\lyricmode", "\\lyricsto", "\\chordmode",
                                                                   "\\figuremode", "\\lyrics", "\\chords",
                                                                   "\\figures", "\\drummode")):
            self.next()
            if p.text == "\\lyricsto":
                if self.at("StringQuotedStart"):
                    self.read_string()
                elif self.peek() is not None:
                    self.next()
            self.skip_block()
            return None
        if p is not None and p.cls == "UserCommand":
            self.next()
        return None

    def parse_chord(self) -> ChordN:
        start = self.next()
        notes = []
        while self.peek() is not None and not self.at("ChordEnd"):
            if self.at("Note"):
                n = self.parse_pitch_token()
                if n is None:
                    continue
                self.parse_post_events(n.post)
                notes.append(n)
            elif self.at("SchemeStart"):
                self.skip_scheme()
            elif self.at("MarkupStart"):
                self.skip_markup()
            elif self.at("Command") and self.peek().text == "\\tweak":
                self.skip_tweak()
            else:
                self.next()
        if self.peek() is not None:
            self.next()
        ch = ChordN(notes, file=start.file, line=start.line)
        self.parse_note_or_chord_tail(ch)
        self.last_chord = ch
        return ch

    def parse_simultaneous(self) -> SimN:
        voices: list = []
        current: list = []
        while self.peek() is not None:
            if self.at("SimultaneousEnd"):
                self.next()
                break
            m = self.parse_music()
            if m == "VOICESEP":
                self.next()
                voices.append(SeqN(current))
                current = []
                continue
            if m is None:
                if self.peek() is not None and not self.at("SimultaneousEnd"):
                    self.warn(f"unexpected {self._where()} in << >>")
                    self.next()
                continue
            current.append(m)
        if voices:
            voices.append(SeqN(current))
            return SimN(voices)
        return SimN(current)

    def parse_music_list(self, end_classes: tuple) -> list:
        items = []
        while self.peek() is not None:
            if self.peek().cls in end_classes:
                self.next()
                break
            m = self.parse_music()
            if m == "VOICESEP":
                self.next()
                items.append("VOICESEP")
                continue
            if m is None:
                if self.peek() is not None and self.peek().cls not in end_classes:
                    self.warn(f"unexpected {self._where()} in {{ }}")
                    self.next()
                continue
            items.append(m)
        if "VOICESEP" in items:  # "{ a \\ b }" is legal and means << a \\ b >>
            voices, cur = [], []
            for it in items:
                if it == "VOICESEP":
                    voices.append(SeqN(cur))
                    cur = []
                else:
                    cur.append(it)
            voices.append(SeqN(cur))
            return [SimN(voices)]
        return items

    # --- toplevel ------------------------------------------------------------------------
    def parse_file(self) -> None:
        while self.peek() is not None:
            p = self.peek()
            c, txt = p.cls, p.text
            if c == "Keyword" and txt == "\\version":
                self.next()
                if self.at("StringQuotedStart"):
                    v = self.read_string()
                    try:
                        self.version = tuple(int(x) for x in v.split(".")[:2])
                    except ValueError:
                        pass
                continue
            if c == "Keyword" and txt == "\\language":
                self.next()
                if self.at("StringQuotedStart"):
                    self.set_language(self.read_string())
                continue
            if c == "Include":
                self.next()
                lang = LANG_FILES.get(os.path.basename(txt))
                if lang:
                    self.set_language(lang)
                continue
            if c in ("Name", "UserVariable", "Variable") and self.at("EqualSign", k=1):
                self.parse_assignment()
                continue
            if c == "Command" and txt == BS + "parallelMusic":
                self.parse_parallel_music()
                continue
            if c == "Header":
                self.next()
                self.header.update(self.parse_header())
                continue
            if c in ("Paper", "Layout", "Midi"):
                self.next()
                self.skip_block()
                continue
            if c == "Score":
                self.next()
                self.parse_score()
                continue
            if c in ("Book", "BookPart"):
                self.next()
                if self.at("OpenBracket") or self.at("SequentialStart"):
                    self.next()
                continue  # scores inside are parsed by the main loop; closing brace skipped below
            if c in ("CloseBracket", "SequentialEnd"):
                self.next()
                continue
            if c == "SchemeStart":
                self.skip_scheme()
                continue
            if c == "MarkupStart":
                self.skip_markup()
                continue
            m = None
            start = self.i
            try:
                m = self.parse_music()
            except LyError as e:
                self.warn(str(e))
            if m is not None and m != "VOICESEP":
                self.toplevel_music.append(m)
            if self.i == start:
                self.next()

    def parse_parallel_music(self) -> None:
        """``\\parallelMusic #'(va vb ...) { bar-of-va | bar-of-vb | bar-of-va | ... }``:
        segments separated by top-level bar checks are dealt round-robin to the named
        variables; each variable is then parsed on its own (durations and \\relative
        references continue within each voice, as LilyPond documents)."""
        self.next()
        names: list[str] = []
        if self.at("SchemeStart"):
            names = re.findall(r"[A-Za-z][\w-]*", self.skip_scheme())
        if not names or not (self.at("SequentialStart") or self.at("OpenBracket")):
            self.warn("malformed \\parallelMusic")
            return
        self.next()
        depth = 0
        segments: list[list[Tok]] = [[]]
        while self.peek() is not None:
            t = self.next()
            if t.cls in ("SequentialStart", "SimultaneousStart", "ChordStart", "OpenBracket") or \
                    t.cls == "LilyPondStart":
                depth += 1
            elif t.cls in ("SequentialEnd", "SimultaneousEnd", "ChordEnd", "CloseBracket") or \
                    t.cls == "LilyPondEnd":
                if depth == 0:
                    break
                depth -= 1
            segments[-1].append(t)
            if t.cls == "PipeSymbol" and depth == 0:
                segments.append([])
        voices: list[list[Tok]] = [[] for _ in names]
        for k, seg in enumerate(s for s in segments if s):
            voices[k % len(names)] += seg
        for name, toks in zip(names, voices):
            sub = Parser(toks, self.language, self.version)
            sub.vars = self.vars
            sub.unknown_commands = self.unknown_commands
            items = sub.parse_music_list(("SequentialEnd",))
            self.warnings += sub.warnings[:20]
            self.vars[name] = SeqN(items)

    def parse_assignment(self) -> None:
        name = self.next().text
        self.next()  # =
        p = self.peek()
        if p is None:
            return
        if p.cls == "SchemeStart":
            self.skip_scheme()
            return
        if p.cls == "StringQuotedStart":
            self.vars[name] = self.read_string()
            return
        if p.cls == "MarkupStart":
            self.skip_markup()
            self.vars[name] = "markup"
            return
        if p.cls in ("With",):
            self.next()
            self.skip_block()
            return
        if p.cls in ("Layout", "Midi", "Paper", "Header"):
            self.next()
            self.skip_block()
            return
        if p.cls == "UserCommand" and p.text[1:] in self.vars and not isinstance(self.vars[p.text[1:]], MUSIC_NODES):
            self.next()  # alias of a non-music variable (markup, string, number ...)
            self.vars[name] = self.vars[p.text[1:]]
            return
        if p.cls in ("IntegerValue", "DecimalValue", "Fraction"):
            self.next()
            return
        if p.cls in ("OpenBracket",) and p.text == "{" and False:
            pass
        try:
            m = self.parse_music()
        except LyError as e:
            self.warn(f"variable {name}: {e}")
            m = None
        if m is not None and m != "VOICESEP":
            self.vars[name] = m

    def parse_score(self) -> None:
        if not (self.at("OpenBracket") or self.at("SequentialStart")):
            return
        start = self.next()
        music_items = []
        has_layout = has_midi = False
        header: dict = {}
        while self.peek() is not None:
            p = self.peek()
            if p.cls in ("CloseBracket", "SequentialEnd"):
                self.next()
                break
            if p.cls == "Layout":
                has_layout = True
                self.next()
                self.skip_block()
                continue
            if p.cls == "Midi":
                has_midi = True
                self.next()
                self.skip_block()
                continue
            if p.cls == "Header":
                self.next()
                header.update(self.parse_header())
                continue
            if p.cls == "Paper":
                self.next()
                self.skip_block()
                continue
            before = self.i
            try:
                m = self.parse_music()
            except LyError as e:
                self.warn(str(e))
                m = None
            if m is not None and m != "VOICESEP":
                music_items.append(m)
            if self.i == before:
                self.next()
        music = music_items[0] if len(music_items) == 1 else SimN(music_items)
        self.scores.append(ScoreN(music, has_layout, has_midi, header, len(self.scores), start.file, start.line))


# ---------------------------------------------------------------------------------------
# relative-octave resolution
# ---------------------------------------------------------------------------------------

def _abs_from(n: NoteN, ref_step: int, ref_oct: int) -> int:
    """Octave (0 = c) of ``n`` relative to a reference (step, octave) - LilyPond's rule."""
    return ref_oct - (n.step - ref_step + 3) // 7 + n.octave


class Relativizer:
    def __init__(self, version: tuple):
        self.version = version

    def resolve(self, node: Any, ref: list | None) -> None:
        """Walk in input order; ``ref`` = [step, octave] (mutable) or None in absolute mode."""
        if node is None:
            return
        if isinstance(node, NoteN):
            self._note(node, ref)
        elif isinstance(node, ChordN):
            first = None
            cur = list(ref) if ref is not None else None
            for n in node.notes:
                self._note(n, cur)
                if first is None:
                    first = (n.step, n.abs_octave)
            if ref is not None and first is not None:
                ref[0], ref[1] = first
        elif isinstance(node, QN):
            pass  # resolved at evaluation from the referenced chord
        elif isinstance(node, RestN):
            if node.pitch is not None:
                self._note(node.pitch, ref)
        elif isinstance(node, (SeqN, SimN)):
            for it in node.items:
                self.resolve(it, ref)
        elif isinstance(node, RelativeN):
            if node.ref is not None:
                self._note(node.ref, None)
                r = [node.ref.step, node.ref.abs_octave]
            else:
                # LilyPond >= 2.18: no start pitch -> first note is absolute (reference f)
                r = [3, 0] if self.version >= (2, 18) else [0, 1]
            self.resolve(node.body, r)
        elif isinstance(node, AbsoluteN):
            self.resolve(node.body, None)
        elif isinstance(node, FixedN):
            self._note(node.ref, None)
            self._fixed(node.body, node.ref.abs_octave)
        elif isinstance(node, TransposeN):
            self._note(node.frm, None)
            self._note(node.to, None)
            self.resolve(node.body, None)
        elif isinstance(node, (ScaleN, GraceN, ContextN, AutochangeN, TagN, KeepTagN, UnfoldN)):
            self.resolve(node.body, ref)
        elif isinstance(node, AfterGraceN):
            self.resolve(node.main, ref)
            self.resolve(node.grace, ref)
        elif isinstance(node, RepeatN):
            self.resolve(node.body, ref)
            for a in node.alts:
                self.resolve(a, ref)

    def _note(self, n: NoteN, ref: list | None) -> None:
        if n.abs_octave is not None:
            if ref is not None:
                ref[0], ref[1] = n.step, n.abs_octave
            return
        if ref is None:
            n.abs_octave = n.octave
        else:
            n.abs_octave = _abs_from(n, ref[0], ref[1])
            if n.octave_check is not None:
                n.abs_octave = n.octave_check
            ref[0], ref[1] = n.step, n.abs_octave

    def _fixed(self, node: Any, oct_add: int) -> None:
        if node is None:
            return
        if isinstance(node, NoteN):
            if n_abs_unset(node):
                node.abs_octave = node.octave + oct_add
        elif isinstance(node, ChordN):
            for n in node.notes:
                self._fixed(n, oct_add)
        elif isinstance(node, (SeqN, SimN)):
            for it in node.items:
                self._fixed(it, oct_add)
        elif isinstance(node, RelativeN):
            self.resolve(node, None)
        elif isinstance(node, (ScaleN, GraceN, ContextN, AutochangeN, TagN, KeepTagN, UnfoldN)):
            self._fixed(node.body, oct_add)
        elif isinstance(node, AfterGraceN):
            self._fixed(node.main, oct_add)
            self._fixed(node.grace, oct_add)
        elif isinstance(node, RepeatN):
            self._fixed(node.body, oct_add)
            for a in node.alts:
                self._fixed(a, oct_add)
        elif isinstance(node, (TransposeN, AbsoluteN, FixedN)):
            self.resolve(node, None)


def n_abs_unset(n: NoteN) -> bool:
    return n.abs_octave is None


def midi_of(n: NoteN, transpose: int = 0) -> int:
    octv = n.abs_octave if n.abs_octave is not None else n.octave
    return 48 + 12 * octv + STEP_SEMITONES[n.step] + int(n.alter * 2) + transpose


# ---------------------------------------------------------------------------------------
# evaluation
# ---------------------------------------------------------------------------------------

@dataclass
class NoteEvent:
    onset: Fraction          # whole notes
    offset: Fraction
    pitch: int
    staff: str               # unique staff key
    voice: str
    fingers: list            # list of finger texts (raw, from the source)
    grace: bool = False
    grace_order: int = 0
    file: str = ""
    line: int = 0
    in_chord: int = 1        # number of notes in the written chord
    chord_post_fingers: list = field(default_factory=list)
    chord_id: int = -1
    autochange: bool = False


@dataclass
class StaffInfo:
    key: str
    name: str | None
    group: str               # key of the enclosing PianoStaff/GrandStaff ('' if none)
    order: int
    clef: str = ""


class Evaluator:
    def __init__(self) -> None:
        self.events: list[NoteEvent] = []
        self.staves: dict[str, StaffInfo] = {}
        self.staff_names: dict[tuple, str] = {}
        self.bar_checks: list[tuple[Fraction, str, int, str]] = []
        self.meter_events: list[tuple[Fraction, Fraction]] = []      # (time, measure length)
        self.partial_events: list[tuple[Fraction, Fraction]] = []
        self.measure_pos_events: list[tuple[Fraction, Fraction]] = []
        self.group_names: dict[tuple, str] = {}
        self.tempo: float | None = None
        self.warnings: list[str] = []
        self._chord_counter = 0
        self._group_counter = 0
        self._staff_counter = 0
        self.keep_tags: set | None = None
        self.remove_tags: set = set()

    # state: dict with time, staff, voice, scale, transpose, grace, group, unfold, autochange
    def run(self, music: Any) -> None:
        st = {"time": Fraction(0), "staff": None, "voice": "v0", "scale": Fraction(1), "transpose": 0,
              "grace": False, "group": "", "unfold": False, "autochange": False, "grace_index": None}
        self.eval(music, st)
        # ties: merge
        self._merge_ties()

    def _new_staff(self, name: str | None, group: str) -> str:
        key_name = (group, name) if name else None
        if key_name and key_name in self.staff_names:
            return self.staff_names[key_name]
        self._staff_counter += 1
        key = f"S{self._staff_counter}"
        order = sum(1 for s in self.staves.values() if s.group == group)
        self.staves[key] = StaffInfo(key, name, group, order)
        if key_name:
            self.staff_names[key_name] = key
        return key

    def _staff_for(self, st: dict) -> str:
        if st["staff"] is None:
            st["staff"] = self._new_staff(None, st["group"])
        return st["staff"]

    def eval(self, node: Any, st: dict) -> Fraction:
        """Evaluate ``node`` starting at st['time']; return its duration (whole notes)."""
        if node is None:
            return Fraction(0)
        t0 = st["time"]
        if isinstance(node, SeqN):
            for it in node.items:
                d = self.eval(it, st)
                st["time"] += d
            dur = st["time"] - t0
            st["time"] = t0
            return dur
        if isinstance(node, SimN):
            longest = Fraction(0)
            base_voice = st["voice"]
            for k, it in enumerate(node.items):
                sub = dict(st)
                sub["voice"] = f"{base_voice}.{k}"
                d = self.eval(it, sub)
                longest = max(longest, d)
                # staff changes inside a voice do not leak
            st["time"] = t0
            return longest
        if isinstance(node, NoteN):
            d = node.dur * st["scale"]
            if st["grace"]:
                d_eff = Fraction(0)
            else:
                d_eff = d
            self._emit([node], st, d, node.post, chord=False)
            return d_eff
        if isinstance(node, ChordN):
            d = node.dur * st["scale"]
            self._emit(node.notes, st, d, node.post, chord=True)
            return Fraction(0) if st["grace"] else d
        if isinstance(node, QN):
            d = node.dur * st["scale"]
            ch = node.chord
            notes = [copy.copy(n) for n in ch.notes] if ch is not None else []
            for n in notes:
                n.post = PostEvents(fingers=[], tie=node.post.tie)
            self._emit(notes, st, d, node.post, chord=True)
            return Fraction(0) if st["grace"] else d
        if isinstance(node, RestN):
            return Fraction(0) if st["grace"] else node.dur * st["scale"]
        if isinstance(node, ScaleN):
            sub = dict(st)
            sub["scale"] = st["scale"] * node.factor
            return self.eval(node.body, sub)
        if isinstance(node, (RelativeN, AbsoluteN, FixedN)):
            return self.eval(node.body, st)
        if isinstance(node, TransposeN):
            sub = dict(st)
            sub["transpose"] = st["transpose"] + (midi_of(node.to) - midi_of(node.frm))
            return self.eval(node.body, sub)
        if isinstance(node, GraceN):
            sub = dict(st)
            sub["grace"] = True
            start = len(self.events)
            self.eval(node.body, sub)
            graces = self.events[start:]
            # all grace notes were emitted at t0; order them before the main note (order 0):
            # first grace -> -k, ..., last grace -> -1 (chord members share one emission id)
            orders = sorted({e.grace_order for e in graces})
            rank = {o: i for i, o in enumerate(orders)}
            for e in graces:
                e.grace = True
                e.grace_order = -(len(orders) - rank[e.grace_order])
            return Fraction(0)
        if isinstance(node, AfterGraceN):
            d = self.eval(node.main, st)
            sub = dict(st)
            sub["time"] = st["time"] + d * node.fraction
            sub["grace"] = True
            start = len(self.events)
            self.eval(node.grace, sub)
            for e in self.events[start:]:
                e.grace = True
                e.grace_order = abs(e.grace_order) or 1   # after-graces sort after the beat
            return d
        if isinstance(node, RepeatN):
            if node.kind == "tremolo" and not st["unfold"]:
                # written form (as engraved and as LilyPond's MIDI renders it): every note of the
                # body once, durations stretched by the repeat count
                sub = dict(st)
                sub["scale"] = st["scale"] * max(1, node.count)
                return self.eval(node.body, sub)
            if node.kind == "percent" and not st["unfold"]:
                # written once (fingering is printed once); the repeated measures only take time
                d = self.eval(node.body, st)
                return d * max(1, node.count)
            if node.kind in ("unfold", "percent", "tremolo") or st["unfold"]:
                k = len(node.alts)
                count = max(1, node.count, k)
                total = Fraction(0)
                for i in range(count):
                    st["time"] = t0 + total
                    total += self.eval(node.body, st)
                    if k:
                        j = max(0, i - (count - k))
                        st["time"] = t0 + total
                        total += self.eval(node.alts[j], st)
                st["time"] = t0
                return total
            # volta / segno: written order: body, then each alternative once
            total = self.eval(node.body, st)
            for a in node.alts:
                st["time"] = t0 + total
                total += self.eval(a, st)
            st["time"] = t0
            return total
        if isinstance(node, ContextN):
            sub = dict(st)
            ct = node.ctype
            if ct in ("PianoStaff", "GrandStaff", "StaffGroup", "ChoirStaff"):
                cur_type = st["group"].split(":")[1] if st["group"] else ""
                if not node.new and node.name is None and cur_type == ct:
                    return self.eval(node.body, sub)          # \context PianoStaff inside itself
                if not node.new and node.name is not None and (ct, node.name) in self.group_names:
                    sub["group"] = self.group_names[(ct, node.name)]
                else:
                    self._group_counter += 1
                    sub["group"] = f"G{self._group_counter}:{ct}:{node.name or ''}"
                    if node.name is not None:
                        self.group_names[(ct, node.name)] = sub["group"]
                sub["staff"] = None
                return self.eval(node.body, sub)
            if ct in ("Staff", "RhythmicStaff"):
                if node.new:
                    # \new always creates a context (a name only makes it addressable later)
                    key = self._new_staff(None, st["group"]) if node.name is None else \
                        self._new_staff_named(node.name, st["group"])
                elif node.name is None:
                    # \context Staff without a name re-uses the current staff if there is one
                    key = st["staff"] if st["staff"] is not None else self._new_staff(None, st["group"])
                else:
                    key = self._new_staff_named(node.name, st["group"])
                sub["staff"] = key
                if key != st["staff"]:
                    sub["voice"] = f"{key}.v"
                return self.eval(node.body, sub)
            if ct in ("Voice", "CueVoice", "NullVoice"):
                if ct == "NullVoice":
                    return Fraction(0)
                sub["voice"] = f"{st['voice']}/{node.name or 'v'}"
                return self.eval(node.body, sub)
            if ct in ("Dynamics", "Lyrics", "ChordNames", "FiguredBass", "FretBoards", "NoteNames", "TabStaff",
                      "DrumStaff", "Devnull"):
                return Fraction(0)
            return self.eval(node.body, sub)
        if isinstance(node, ChangeN):
            group = st["group"]
            k = (group, node.staff)
            if k in self.staff_names:
                st["staff"] = self.staff_names[k]
            else:
                # forward reference: create the named staff
                st["staff"] = self._new_staff_named(node.staff, group)
            return Fraction(0)
        if isinstance(node, PartialN):
            self.partial_events.append((st["time"], node.dur * st["scale"]))
            return Fraction(0)
        if isinstance(node, MeasurePosN):
            self.measure_pos_events.append((st["time"], node.pos))
            return Fraction(0)
        if isinstance(node, TimeN):
            self.meter_events.append((st["time"], Fraction(node.num, node.den)))
            return Fraction(0)
        if isinstance(node, BarCheckN):
            if not st["grace"]:
                self.bar_checks.append((st["time"], node.file, node.line, st["voice"]))
            return Fraction(0)
        if isinstance(node, ClefN):
            key = self._staff_for(st)
            if not self.staves[key].clef:
                self.staves[key].clef = node.clef
            return Fraction(0)
        if isinstance(node, TempoN):
            if self.tempo is None and node.bpm_quarter:
                self.tempo = node.bpm_quarter
            return Fraction(0)
        if isinstance(node, AutochangeN):
            sub = dict(st)
            sub["autochange"] = True
            if st["staff"] is None:
                sub["staff"] = None
            return self.eval(node.body, sub)
        if isinstance(node, TagN):
            tags = set(node.tags)
            if self.keep_tags is not None and not (tags & self.keep_tags):
                return Fraction(0)
            if tags & self.remove_tags:
                return Fraction(0)
            return self.eval(node.body, st)
        if isinstance(node, KeepTagN):
            old_k, old_r = self.keep_tags, set(self.remove_tags)
            if node.keep:
                self.keep_tags = set(node.tags)
            else:
                self.remove_tags |= set(node.tags)
            d = self.eval(node.body, st)
            self.keep_tags, self.remove_tags = old_k, old_r
            return d
        if isinstance(node, UnfoldN):
            sub = dict(st)
            sub["unfold"] = True
            return self.eval(node.body, sub)
        if isinstance(node, str):
            return Fraction(0)
        self.warnings.append(f"unhandled node {type(node).__name__}")
        return Fraction(0)

    def _new_staff_named(self, name: str, group: str) -> str:
        k = (group, name)
        if k in self.staff_names:
            return self.staff_names[k]
        return self._new_staff(name, group)

    _emit_counter = 0

    def _emit(self, notes: list, st: dict, d: Fraction, post: PostEvents, chord: bool) -> None:
        staff = self._staff_for(st)
        if st["autochange"]:
            pass
        self._chord_counter += 1
        Evaluator._emit_counter += 1
        chord_fingers = [f for _, f in post.fingers] if chord else []
        for n in notes:
            fingers = [f for _, f in n.post.fingers]
            if not chord:
                fingers = [f for _, f in post.fingers]
            p = midi_of(n, st["transpose"])
            sk = staff
            ev = NoteEvent(onset=st["time"], offset=st["time"] + (d if not st["grace"] else d), pitch=p,
                           staff=sk, voice=st["voice"], fingers=fingers, grace=st["grace"],
                           grace_order=Evaluator._emit_counter if st["grace"] else 0, file=n.file, line=n.line,
                           in_chord=len(notes) if chord else 1, chord_post_fingers=chord_fingers,
                           chord_id=self._chord_counter, autochange=st["autochange"])
            ev.tie = (n.post.tie or post.tie)  # type: ignore[attr-defined]
            self.events.append(ev)

    def _merge_ties(self) -> None:
        """Merge tied notes (same staff/voice, same pitch, next onset == this offset)."""
        by_key: dict = {}
        evs = sorted(self.events, key=lambda e: (e.onset, e.grace_order))
        keep = []
        open_ties: dict = {}
        for e in evs:
            k = (e.staff, e.pitch)
            prev = open_ties.get(k)
            if prev is not None and prev.offset == e.onset and not e.grace:
                prev.offset = e.offset
                if not prev.fingers and e.fingers:
                    prev.fingers = e.fingers
                if not getattr(e, "tie", False):
                    del open_ties[k]
                continue
            if prev is not None and prev.offset < e.onset:
                del open_ties[k]
            keep.append(e)
            if getattr(e, "tie", False):
                open_ties[k] = e
        self.events = keep
