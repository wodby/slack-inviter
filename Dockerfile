# check=skip=InvalidDefaultArgInFrom
ARG WODBY_BASE_IMAGE
FROM ${WODBY_BASE_IMAGE}

ENV NGINX_SERVER_ROOT=/var/www/html \
    NGINX_VHOST_PRESET=slack

COPY --chown=wodby:wodby public/ /var/www/html/
COPY --chown=wodby:wodby config/config.js.template /etc/gotpl/slack-config.js.tmpl
COPY --chown=wodby:wodby nginx/preset.conf.tmpl /etc/gotpl/presets/slack.conf.tmpl
COPY --chown=wodby:wodby --chmod=755 docker/10-slack-config.sh /docker-entrypoint-init.d/10-slack-config.sh
