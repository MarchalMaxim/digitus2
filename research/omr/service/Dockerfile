# The scan service: pinned homr (photos) and Audiveris 5.11.0 (PDFs) behind service.py.
# Build context is research/omr:
#   docker build -f research/omr/service/Dockerfile -t digitus2-scan research/omr
# The homr commit, the ONNX models, the text model, the Audiveris deb and the base image are checked against their
# SHA-256; the pip wheels are pinned by version. Nothing is fetched at run time.
FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac

# GDK_SCALE: on Linux, Audiveris probes the monitor scale through GTK unless GDK_SCALE is set, and
# the missing libgtk-3 then aborts it; the adapter passes the environment on to the JVM.
ENV DEBIAN_FRONTEND=noninteractive \
    GDK_SCALE=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

# Java's font manager needs fontconfig and one font even headless (Audiveris bundles its music fonts).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl fontconfig fonts-dejavu-core python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*

# Audiveris: the Ubuntu package installs under /opt/audiveris (bundled Java runtime, JavaCPP
# Tesseract and Leptonica); the package file stays beside it for the adapter's digest check.
# Its post-install registers a desktop menu entry and a MIME type, which fail without the
# system menu and MIME directories a desktop install would have; they are created empty.
ARG AUDIVERIS_DEB=Audiveris-5.11.0-ubuntu24.04-x86_64.deb
ARG AUDIVERIS_SHA256=f20113aaa33b3149ec8d6a09b2a7963360e65fafd92d69389987a85bbc3ec7a3
RUN mkdir -p /opt/audiveris /etc/xdg/menus /usr/share/applications /usr/share/desktop-directories /usr/share/mime/packages \
 && cd /opt/audiveris \
 && curl -fsSL -o "$AUDIVERIS_DEB" "https://github.com/Audiveris/audiveris/releases/download/5.11.0/$AUDIVERIS_DEB" \
 && echo "$AUDIVERIS_SHA256  $AUDIVERIS_DEB" | sha256sum -c - \
 && apt-get update \
 && apt-get install -y --no-install-recommends "./$AUDIVERIS_DEB" \
 && rm -rf /var/lib/apt/lists/* \
 && chmod 644 "$AUDIVERIS_DEB" \
 && test -x lib/runtime/bin/java \
 && test -d lib/app

# The legacy-capable English text model from tessdata 4.1.0 (Apache-2.0), with its licence.
ARG TESSDATA=https://raw.githubusercontent.com/tesseract-ocr/tessdata/4767ea922bcc460e70b87b1d303ebdfed0897da8
RUN mkdir -p /opt/text-models \
 && cd /opt/text-models \
 && curl -fsSL -o eng.traineddata "$TESSDATA/eng.traineddata" \
 && curl -fsSL -o LICENSE "$TESSDATA/LICENSE" \
 && printf '%s  %s\n' \
      daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047 eng.traineddata \
      cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30 LICENSE \
    | sha256sum -c - \
 && chmod 644 eng.traineddata LICENSE

# homr: pinned source, locked CPU dependencies, pinned models, the four patches. The setup
# imports homr.py, which imports the adapter's three standard-library neighbours.
COPY prototypes/homr-photo /app/research/omr/prototypes/homr-photo
COPY prototypes/photo-recovery /app/research/omr/prototypes/photo-recovery
COPY prototypes/local-worker/homr.py prototypes/local-worker/audiveris.py \
     prototypes/local-worker/normalize_export.py prototypes/local-worker/recognition_errors.py \
     /app/research/omr/prototypes/local-worker/
COPY service/setup-homr.py /app/research/omr/service/setup-homr.py
RUN python3 /app/research/omr/service/setup-homr.py --root /opt/homr --python /usr/bin/python3 \
 && rm -rf /opt/homr/pip-cache /opt/homr/downloads

# Audiveris's JDK ahead-of-time class cache (about 66 MB, about 3 s less per PDF), recorded from one
# recognition through the adapter; train-aot.py fails the build unless a strict run maps it and
# gives the same MusicXML. The adapter uses /opt/audiveris/audiveris.aot when the file exists.
COPY service/train-aot.py service/aot-training.pdf /app/research/omr/service/
RUN python3 /app/research/omr/service/train-aot.py --bundle /opt/audiveris --text-models /opt/text-models \
      --pdf /app/research/omr/service/aot-training.pdf \
 && rm -f /opt/audiveris/audiveris.aot.config \
 && chmod 644 /opt/audiveris/audiveris.aot

# The worker and the service; a code change rebuilds only these layers.
COPY prototypes/local-worker /app/research/omr/prototypes/local-worker
COPY service /app/research/omr/service

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin scan
USER 10001
WORKDIR /app
EXPOSE 8080
ENTRYPOINT ["python3", "research/omr/service/service.py", "--bundle", "/opt/audiveris", "--short-staves", "--text-models", "/opt/text-models", "--homr-toolchain", "/opt/homr"]
CMD []
