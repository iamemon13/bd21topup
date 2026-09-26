# Telegram zero-send VPS setup

This plan prepares one Ubuntu LTS host for identity verification and an explicitly scoped, read-only pilot preflight. It does not install an unrestricted queue loop and does not authorize a real pilot.

## Layout

```text
/opt/bd21topup/current                     reviewed detached Git release
/var/lib/bd21topup-telegram/               persistent private session directory
/etc/bd21topup/telegram-worker.env         private runtime environment
/etc/systemd/system/bd21topup-telegram-preflight@.service
```

## Base host and Node.js 24

Run these commands as an authorized Ubuntu administrator. Review the downloaded NodeSource setup script before executing it.

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl git util-linux
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup_24.sh
less /tmp/nodesource_setup_24.sh
sudo -E bash /tmp/nodesource_setup_24.sh
rm -f /tmp/nodesource_setup_24.sh
sudo apt-get install -y nodejs
node --version
npm --version
```

Require Node.js `24.x` before continuing.

## Account, directories, and release

```bash
sudo useradd --system --create-home --home-dir /var/lib/bd21telegram --shell /usr/sbin/nologin bd21telegram
sudo install -d -o root -g root -m 0755 /opt/bd21topup
sudo install -d -o bd21telegram -g bd21telegram -m 0750 /opt/bd21topup/current
sudo install -d -o bd21telegram -g bd21telegram -m 0700 /var/lib/bd21topup-telegram
sudo install -d -o root -g bd21telegram -m 0750 /etc/bd21topup
sudo -u bd21telegram git clone <REPO_URL> /opt/bd21topup/current
sudo -u bd21telegram git -C /opt/bd21topup/current fetch --prune origin
sudo -u bd21telegram git -C /opt/bd21topup/current checkout --detach <REVIEWED_COMMIT_SHA>
sudo -u bd21telegram git -C /opt/bd21topup/current status --short
sudo -u bd21telegram npm --prefix /opt/bd21topup/current ci
```

The status output must be empty. Keep exactly one checked-out release and one Telegram session user.

## Private environment and zero-send unit

Copy `deploy/telegram-worker/telegram-worker.env.template` to a temporary administrator-only path, replace placeholders without printing values, then install it and the unit:

```bash
sudo install -o root -g bd21telegram -m 0640 /root/telegram-worker.env /etc/bd21topup/telegram-worker.env
sudo install -o root -g root -m 0644 /opt/bd21topup/current/deploy/telegram-worker/bd21topup-telegram-preflight@.service /etc/systemd/system/bd21topup-telegram-preflight@.service
sudo systemctl daemon-reload
sudo systemctl cat bd21topup-telegram-preflight@.service
```

The environment must retain both flags exactly as follows:

```text
TELEGRAM_REAL_SEND_ENABLED=false
TELEGRAM_PILOT_ACKNOWLEDGED=false
```

The unit is deliberately `oneshot`, has no install target, uses a single-host lock, and runs only `telegram:pilot:preflight`. Do not add `telegram:pilot`, a queue loop, `Restart=always`, or an enable target during this stage.

## Authenticate and pin identity on the final host

Run the command as the worker account. Its shell loads the private environment without echoing it:

```bash
sudo -u bd21telegram /bin/bash -c 'set -a; . /etc/bd21topup/telegram-worker.env; set +a; cd /opt/bd21topup/current; exec /usr/bin/npm run telegram:identity'
sudo chmod 0600 /var/lib/bd21topup-telegram/bd21topup.session
sudo chown bd21telegram:bd21telegram /var/lib/bd21topup-telegram/bd21topup.session
```

Manually require username `kaiumrakibucbot`, entity type `user`, entity ID `7072880197`, and `messagesSent: 0`. After that independent comparison, keep the pinned entity ID in the private environment and run:

```bash
sudo -u bd21telegram /bin/bash -c 'set -a; . /etc/bd21topup/telegram-worker.env; set +a; cd /opt/bd21topup/current; exec /usr/bin/npm run telegram:check'
```

Again require the same username and entity ID, `messagesSent: 0`, and both activation flags `false`.

## Operator-selected zero-send preflight

Only after an operator records and reviews one dispatch UUID may the read-only unit be started:

```bash
sudo systemctl start bd21topup-telegram-preflight@<uuid>.service
sudo journalctl -u bd21topup-telegram-preflight@<uuid>.service --no-pager
```

The CLI validates the UUID, uses only the service-role preflight RPC, and returns before Telegram initialization, queue claim, or transport execution. Never substitute a guessed, latest, or automatically selected dispatch.

## Release update

Use an explicitly reviewed commit SHA. Stop the selected preflight unit first if it is active.

```bash
sudo systemctl stop bd21topup-telegram-preflight@<uuid>.service
sudo -u bd21telegram git -C /opt/bd21topup/current status --short
sudo -u bd21telegram git -C /opt/bd21topup/current fetch --prune origin
sudo -u bd21telegram git -C /opt/bd21topup/current cat-file -e <REVIEWED_COMMIT_SHA>^{commit}
sudo -u bd21telegram git -C /opt/bd21topup/current checkout --detach <REVIEWED_COMMIT_SHA>
sudo -u bd21telegram npm --prefix /opt/bd21topup/current ci
sudo -u bd21telegram git -C /opt/bd21topup/current status --short
```

Do not use `git pull` or deploy an unreviewed branch head.

## Emergency stop

For the one selected unit:

```bash
sudo systemctl stop bd21topup-telegram-preflight@<uuid>.service
sudo systemctl reset-failed bd21topup-telegram-preflight@<uuid>.service
```

For interactive identity or connectivity commands, press `Ctrl+C`. Keep both activation flags false. A future real pilot must remain a separately approved manual command with an explicit `--dispatch <uuid>`; it must not be placed in this systemd unit.
