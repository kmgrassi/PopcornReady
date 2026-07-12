#!/usr/bin/env bash

# Applies only PopcornReady's hosted Auth URL configuration. This deliberately
# uses the Management API instead of `supabase config push`: config push would
# also publish local-only settings from supabase/config.toml.
set -euo pipefail

project_ref="${SUPABASE_PROJECT_REF:-mllkugitfwasiwgbortk}"
config_file="${SUPABASE_AUTH_URL_CONFIG_FILE:-supabase/production/auth-url-config.json}"
api_url="https://api.supabase.com/v1/projects/${project_ref}/config/auth"

if [[ ! -f "$config_file" ]]; then
  echo "Auth URL config file not found: $config_file" >&2
  exit 1
fi

site_url="$(jq -er '.site_url | strings | select(test("^https://"))' "$config_file")"
redirect_urls="$(jq -cer '
  .redirect_urls
  | arrays
  | map(strings | select(test("^https://")))
  | if index($site_url) then . else . + [$site_url] end
  | unique
' --arg site_url "$site_url" "$config_file")"

if [[ "${DRY_RUN:-}" == "1" ]]; then
  jq -n --arg site_url "$site_url" --argjson redirect_urls "$redirect_urls" \
    '{site_url: $site_url, redirect_urls: $redirect_urls}'
  exit 0
fi

: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN to a token with Auth configuration write access.}"

current_config="$(curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "$api_url")"

uri_allow_list="$(jq -cn \
  --arg existing "$(jq -r '.uri_allow_list // ""' <<<"$current_config")" \
  --argjson required "$redirect_urls" '
    ($existing | split(",") | map(gsub("^\\s+|\\s+$"; "") | select(length > 0)) + $required)
    | unique
    | join(",")
  ')"

payload="$(jq -n \
  --arg site_url "$site_url" \
  --arg uri_allow_list "$uri_allow_list" \
  '{site_url: $site_url, uri_allow_list: $uri_allow_list}')"

updated_config="$(curl --fail-with-body --silent --show-error \
  --request PATCH \
  --header "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  --header "Content-Type: application/json" \
  --data "$payload" \
  "$api_url")"

actual_site_url="$(jq -r '.site_url // empty' <<<"$updated_config")"
actual_allow_list="$(jq -r '.uri_allow_list // ""' <<<"$updated_config")"

if [[ "$actual_site_url" != "$site_url" ]] || ! grep -Fqx "$site_url" < <(tr ',' '\n' <<<"$actual_allow_list" | sed 's/^ *//; s/ *$//'); then
  echo "Supabase did not persist the expected Auth URL configuration." >&2
  exit 1
fi

echo "Production Auth URL configuration is up to date for ${project_ref}."
