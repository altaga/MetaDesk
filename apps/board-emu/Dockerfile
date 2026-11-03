# A MetaDesk board in a container: the board API plus the board agent, cloud-only
# (no Ollama, no CUDA). It boots unpaired and answers /setup, so the desk's
# "Set up a board" wizard can discover and enroll it like a Jetson.
#
# Built from apps/ (see docker-compose.yml): context ".." so both apps are in reach.

FROM python:3.12.7-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# A non-root operator account, like the real board's user.
RUN useradd -m -u 1000 -s /bin/bash jetson \
 && apt-get update \
 && apt-get install -y --no-install-recommends procps \
 && rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt /opt/api/requirements.txt
COPY board-agent/requirements.txt /opt/agent/requirements.txt
RUN pip install -r /opt/api/requirements.txt -r /opt/agent/requirements.txt

# The board browser (Machine → Preview): Playwright and its Chromium, installed
# where the non-root operator can read them.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
COPY api/requirements-browser.txt /opt/api/requirements-browser.txt
RUN pip install -r /opt/api/requirements-browser.txt \
 && playwright install --with-deps chromium \
 && chmod -R a+rX /opt/ms-playwright \
 && rm -rf /var/lib/apt/lists/*

COPY api/app /opt/api/app
COPY board-agent/metadesk_agent /opt/agent/metadesk_agent
COPY board-emu/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod 0755 /entrypoint.sh

USER jetson
WORKDIR /home/jetson
ENTRYPOINT ["/entrypoint.sh"]
