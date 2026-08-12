# check=skip=InvalidDefaultArgInFrom
ARG WODBY_BASE_IMAGE=node:24-alpine
FROM ${WODBY_BASE_IMAGE}

WORKDIR /usr/src/app

ARG COPY_FROM=.
COPY --chown=node:node ${COPY_FROM} /usr/src/app

CMD ["npm", "run", "start"]
