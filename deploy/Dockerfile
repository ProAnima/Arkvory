FROM node:24.21.0-bookworm-slim
WORKDIR /opt/depot
COPY --chown=root:root . .
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "apps/deploy/dist/container.js"]
CMD ["api"]
