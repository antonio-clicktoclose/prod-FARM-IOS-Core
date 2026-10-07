#!/bin/sh
# Inject the Ronaldo Marketing Slack bot token from 1Password into the monitor process only. Never written to disk.
cd /Users/antoniomonteiro/Developer/phone-farm || exit 1
SLACK_BOT_TOKEN="$(/usr/bin/python3 -c 'import importlib.util,os;s=importlib.util.spec_from_file_location("s",os.path.expanduser("~/.local/share/c2c-secrets/c2c_secrets.py"));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.fields("c2c-monorepo","Slack App — Ronaldo Marketing (c2c-content Socket Mode)")["SLACK_BOT_TOKEN"])')" \
SLACK_ALERT_USER=U07K58XAD97 \
exec /Users/antoniomonteiro/.local/bin/node --env-file-if-exists=.env --import tsx scripts/monitor.ts "${1:-check}"
