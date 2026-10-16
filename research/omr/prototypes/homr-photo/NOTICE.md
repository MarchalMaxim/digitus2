# Upstream notice

The optional native recognizer is [homr](https://github.com/liebharc/homr/tree/ab369ac54277afab582afa4725441f7cbba76593), pinned to commit `ab369ac54277afab582afa4725441f7cbba76593`.

homr source and its published model weights use AGPL-3.0, as stated in the pinned [license](https://github.com/liebharc/homr/blob/ab369ac54277afab582afa4725441f7cbba76593/LICENSE) and [license FAQ](https://github.com/liebharc/homr/blob/ab369ac54277afab582afa4725441f7cbba76593/LICENSE_FAQ.md). The complete upstream license is preserved in LICENSE.upstream. Upstream-derived diff context and changes to the upstream inference source retain that license. Original orchestration scripts are provided under this repository's MIT license; they do not relicense homr or the models.

The runtime, vendor source, pretrained weights and private recognition evidence remain under ignored research output directories. They are optional local PC components, separate from the MIT browser application, and are not bundled in the public web application.

Model weights: segmentation308 and transformer465. The upstream FAQ separately identifies training-data licenses and uncertainties, including Camera-PrIMuS's non-commercial metadata. No datasets or model binaries are committed or redistributed here. The app's non-commercial scope does not turn upstream code or model weights into MIT assets.

All candidate changes are explicit: geometry selection before layout repair/decoding, cue pixel boundaries before decoding, and accidental spelling during native MusicXML generation. Exact pristine and modified inference Python file digests and patch digests are pinned in source-manifests.json. These modifications do not train the model, alter the user's original bytes, or replace recognized pitches/durations with a reference transcription.
