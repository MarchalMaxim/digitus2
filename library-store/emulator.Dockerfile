# The Firestore emulator for the rules tests (run-rules-tests.mjs): Java and the Firebase CLI stay
# inside this image, so the host needs only Docker.
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g firebase-tools@14.17.0 \
  && firebase setup:emulators:firestore
WORKDIR /work
