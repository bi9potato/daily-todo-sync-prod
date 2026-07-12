#!/usr/bin/env bash
# One-time server setup: installs android-auto-publish.sh from this repo and
# schedules it with a systemd timer, so every new android-latest release is
# published to the server automatically (~10 minutes) with no manual steps
# and no GitHub Actions minutes. Run on the droplet as root:
#   curl -fsSL https://raw.githubusercontent.com/bi9potato/daily-todo-sync-prod/main/infra/install-android-auto-publish.sh | bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (pipe into 'sudo bash' instead of 'bash')." >&2
  exit 1
fi

PROD_REPO="bi9potato/daily-todo-sync-prod"

curl -fsSL --retry 3 \
  "https://raw.githubusercontent.com/${PROD_REPO}/main/infra/android-auto-publish.sh" \
  -o /usr/local/bin/android-auto-publish
chmod 755 /usr/local/bin/android-auto-publish

cat > /etc/systemd/system/android-auto-publish.service << 'EOF'
[Unit]
Description=Publish the latest Daily Todo Android build to the app server
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/android-auto-publish
EOF

cat > /etc/systemd/system/android-auto-publish.timer << 'EOF'
[Unit]
Description=Check for a new Daily Todo Android build every 10 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
RandomizedDelaySec=1min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now android-auto-publish.timer

# Publish immediately so the current release goes live without waiting for
# the first timer tick.
/usr/local/bin/android-auto-publish

systemctl list-timers android-auto-publish.timer --no-pager | head -3
echo "Installed: new Android builds now publish automatically within ~10 minutes."
