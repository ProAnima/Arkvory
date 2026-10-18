FROM node:24.21.0-bookworm-slim
WORKDIR /opt/arkvory
# Module resolution stays in the release (ADR 0031, addendum 2026-10-18); no global search path.
ENV NODE_PATH=
COPY --chown=root:root . .
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "apps/deploy/dist/container.js"]
CMD ["api"]
