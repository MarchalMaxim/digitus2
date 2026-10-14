# Login gate for the VPS deployment

Status: research, 2026-10-14. Every source below was checked on 2026-10-14. Input to M12 (VPS deployment) and M13 (installable PWA), spec `docs/superpowers/specs/2026-10-13-digitus2-design.md` section 12; request T4 in `docs/TODO.md`.

The app is static files with no server process, so the login belongs in front of it, at the reverse proxy. The app stays unchanged, apart from one PWA attribute (section 4.4).

## 1. Recommendation

| Role              | Setup                                                                                                                                                                                                                             | Why                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary           | **Authelia** (one container, SQLite, in-memory sessions, YAML users) behind **Caddy `forward_auth`**, portal on the app's host under `/authelia/`, policy `two_factor` (TOTP or WebAuthn such as Face ID), Caddy login rate limit | Login form, "remember me" [35], argon2id [33], silent IP bans [32], second factor [36]; no OAuth client, no third party; 28.3 MB image [76], 20–25 MB RAM reported [44] |
| Simplest fallback | **Caddy `basic_auth`** with long random passwords from a password manager, plus a **fail2ban** jail on 401s                                                                                                                       | No new process, about ten lines of configuration; no second factor, no logout, browser dialog                                                                           |

Two facts drive this choice:

- **Random passwords make guessing hopeless, so lockouts mainly protect the VPS.** A 20-character password over 62 symbols has 119 bits; at 1,000 guesses per second the expected search takes about 10^25 years. Spam can still burn resources, because each wrong guess costs a hash: bcrypt at cost 14 in Caddy [3], argon2id with 64 MiB in Authelia [33]. The gate needs a cheap check in front of the hash.
- **On iPhones, the PWA wants the login on its own origin.** Home Screen web apps keep cookies apart from Safari, which copies them once at install [25], and an iOS 11.3-era report describes a login on another host leaving the standalone app [26]. Authelia can serve its portal under a path of the app's host [40][30]; tinyauth needs its own subdomain [46], and the Pocket ID chain adds a third host.

## 2. Options at a glance

Current versions: Authelia 4.39.28 (2026-09-17) [29], tinyauth v5.2.0 (2026-09-07) [51], Pocket ID v2.18.0 (2026-10-04) [64], caddy-security v1.4.1 (2026-10-05) [54], Headscale v0.29.5 [72]. Images are compressed linux/amd64 sizes from the registries [76][77] (tinyauth: the `ghcr.io/tinyauthapp/tinyauth:v5.2.0` manifest [46]). The projects themselves publish no idle RAM figures that I could find; the Authelia figure comes from a hosting provider [44].

Table 1. Footprint and attack resistance

| Option                  | Processes                                                | Image               | RAM                                                          | Config files                                                  | Brute force and spam                                                                                                                                                                                            | Second factor                       |
| ----------------------- | -------------------------------------------------------- | ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1 Basic auth + fail2ban | Caddy, plus fail2ban                                     | none                | fail2ban not published; CrowdSec under 100 MB [14]           | Caddyfile block; fail2ban filter and jail                     | One hash per guess (bcrypt cost 14 [3], argon2id 46 MiB [4]); no lockout. fail2ban bans IPs after repeated 401s [13], but each visit starts with a 401 [11]; caddy-ratelimit counts requests, not failures [10] | None                                |
| 2a Authelia             | 1 container                                              | 28.3 MB [76]        | 20–25 MB reported [44], plus 64 MiB per concurrent hash [33] | `configuration.yml`, `users.yml`, 3 secret files              | argon2id [33]; silent bans by user, IP or both, default 3 failures in 2 min then 5 min [32]; limits on TOTP and code endpoints [41]                                                                             | TOTP, WebAuthn, passkey login [36]  |
| 2b tinyauth             | 1 container                                              | 17.7 MB             | not published                                                | Environment variables or a users file [47]                    | bcrypt [78]; lockout per username, 3 failures then 300 s [47][52]; unknown usernames not counted [52]                                                                                                           | TOTP [48]                           |
| 2c caddy-security       | Custom Caddy build [79]                                  | none                | inside Caddy                                                 | Caddyfile                                                     | Had a 2FA lockout bypass (CVE-2024-21500) [55] and predictable nonces (CVE-2024-21495) [56]                                                                                                                     | MFA portal [79]                     |
| 2d Vouch Proxy          | 1 container plus an identity provider [57]               | n/a                 | n/a                                                          | Its config plus the provider                                  | No local users; delegates to OAuth or OIDC [57]                                                                                                                                                                 | The provider's                      |
| 3 Pocket ID + tinyauth  | 2 containers                                             | 34.9 + 17.7 MB [77] | not published                                                | Pocket ID `.env` (2 keys) [59]; tinyauth OAuth variables [53] | No passwords [58]; per-IP limits: passkey login 1 per 5 s (burst 10), login codes 1 per 10 s (burst 5) [63]                                                                                                     | Passkey with user verification [60] |
| 4 Client certificates   | none                                                     | none                | none                                                         | Caddyfile `tls` block, a CA, one certificate per device [8]   | Handshake fails without your CA's certificate, before any HTTP [8][18]                                                                                                                                          | The certificate                     |
| 5 WireGuard / Headscale | Kernel module [68]; Headscale adds a public service [71] | n/a                 | not published                                                | One config per device                                         | WireGuard ignores unauthenticated packets [67]                                                                                                                                                                  | Device key                          |

Table 2. Operations for two or three people (2c and 2d are out: a CVE history and a custom build, or an outside identity provider)

| Option | User management                                                                                  | Session on a phone                                                                                                                                             | Static app, caching, service worker                                                                    | Maintenance                                                                                   | Verdict                  |
| ------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------ |
| 1      | One line per user, hashed with `caddy hash-password` [2]                                         | Browser dialog; no server-side expiry, no logout. Chrome has failed to prompt once a service worker controlled the page [20].                                  | `Cache-Control: private`; the manifest needs `crossorigin="use-credentials"` [21]                      | Caddy updates only                                                                            | **Fallback**             |
| 2a     | `users.yml`, hashes from `authelia crypto hash generate argon2` [34], reloaded with `watch` [33] | Login form that password managers fill; "remember me" lasts 1 month by default [35]; portal on the app's host [40]                                             | One `forward_auth` subrequest per file [6]; expired sessions stop service worker updates quietly (4.4) | Frequent patches (five in 9–17 Sept 2026) [29]                                                | **Primary**              |
| 2b     | Environment variables or users file; `user create` and `totp generate` CLIs [46][48]             | 1 day by default, secure cookie off by default [47]; own subdomain, cookie for the parent domain, so sibling apps such as the photo app receive it [46]        | As 2a, plus a redirect to another host                                                                 | "configuration may change often" [45]; three security-fix releases in July–Sept 2026 [50][51] | Close second             |
| 3      | Admin creates users; first passkey via a one-time login code [60][61]                            | Face ID or fingerprint; "sign in with another device" [60]; two redirects to other hosts                                                                       | As 2b                                                                                                  | Two fast-moving projects [64][51] and an OIDC client secret [53]                              | Upgrade path             |
| 4      | Your own CA, one `.p12` per device                                                               | OS certificate picker; install through Settings > VPN & Device Management on iOS [65], Encryption & credentials on Android [66]; Home Screen apps undocumented | Certificates are credentials [23]: same manifest attribute                                             | Certificate renewal, CA key custody                                                           | For technical users only |
| 5      | One key pair per device, by QR code                                                              | VPN must be on; official apps [68]; Headscale through the Tailscale apps' custom server [74]                                                                   | Unaffected                                                                                             | Key distribution; Headscale is pre-1.0 [72]                                                   | Overkill here            |

## 3. Notes per option

### 3.1 Basic auth at the proxy

- Caddy's `basic_auth` (called `basicauth` before v2.8.0) accepts bcrypt or argon2id hashes, never plaintext [1]. Its bcrypt cost of 14 [3] is above OWASP's minimum of 10 [27], and a hash cache spares repeated requests a second hash [5]. nginx's `auth_basic` accepts `crypt()`, apr1 and RFC 2307 hashes [16], and `limit_req` is built in [80].
- fail2ban needs a loose threshold because the 401 challenge is part of every normal visit [11]; a working filter for Caddy's JSON log exists [13]. CrowdSec's scenario needs auth-failure events from a log parser [15], and its agent needs up to about 100 MB [14], too heavy here. The password travels with every request, so HTTPS is mandatory [19].

### 3.2 Forward-auth gates

`forward_auth` sends a GET subrequest per request: a 2xx response lets it through, and any other response (usually a redirect to the login page) goes back to the browser [6]. The nginx equivalent is `auth_request`, which is not built by default [17]; Authelia ships nginx snippets for it [31]. The trap: if the files are served outside the block that holds `forward_auth`, an unreachable auth service lets everyone in [12]. Section 4.3 tests for this.

- **Authelia** (Apache-2.0, 29.3k stars [28]) defaults to argon2id with t=3, 64 MiB, p=4 [33]. A single instance keeps sessions in memory without Redis [35] and uses SQLite [39]. Regulation bans by user by default; the docs recommend IP [32]. Registering a second factor needs a one-time code from the notifier [37]. The docs call the filesystem notifier testing-only [38]; for two or three people, reading it over SSH is acceptable, and SMTP is cleaner.
- **tinyauth** (AGPL-3.0, 8.4k stars, OpenID Certified since v5.1 [45]) stores users as `username:bcrypt:totp` [46] and answers Caddy at `/api/auth/caddy` [49]: smaller than Authelia, but younger and still changing.
- **caddy-security** needs a Caddy build that includes it [79]; **Vouch Proxy** cannot work without an outside identity provider [57].

### 3.3 Pocket ID (passkeys only)

Pocket ID is an OIDC provider that accepts only passkeys [58]: one container or binary with built-in SQLite, configured by `APP_URL` and `ENCRYPTION_KEY` [59]. It cannot gate a static site alone; an authentication proxy must act as the OIDC client [62]. The moving parts:

1. Caddy's `forward_auth` asks tinyauth (or oauth2-proxy) whether the request has a session.
2. If not, tinyauth redirects the browser to Pocket ID, where the user signs in with a passkey.
3. Pocket ID sends the browser to tinyauth's callback; tinyauth exchanges the code with Pocket ID directly, sets its cookie and returns the browser to the app [53][62].

You register one OIDC client in your own Pocket ID and copy its ID and secret into tinyauth [53]: an OAuth client, but only against your own server. Signups can stay off or require a token [61]. Passkeys can live in a password manager, on the phone or on a security key [81].

### 3.4 Client certificates

In Caddy, `tls { client_auth { ... } }` supports `require_and_verify` with a trust pool, which can list CA or leaf certificates; trusting leaves means a lost phone is revoked by removing its certificate [8]. nginx has `ssl_verify_client`, `ssl_client_certificate` and `ssl_crl` [18]. This setup has no state and nothing to brute-force. The cost is a small CA and a password-protected `.p12` file installed on each device [65][66].

### 3.5 Network-level private access

WireGuard has been in the Linux kernel since 5.6, with official iOS and Android apps [68], and it has a cookie-based defence against denial of service [67]. Caddy would answer only tunnel addresses, with port 80 left public so certificates renew [9]. Tailscale is ruled out: it has no passwords of its own, so accounts come from Apple, Google, GitHub, Microsoft, Okta, OneLogin or a custom OIDC provider [69], and a passkey can join a tailnet but not create one [70]. Headscale replaces the control server (BSD-3, one tailnet, not associated with Tailscale Inc. [71]); the admin approves nodes from the command line or with pre-auth keys [73]. Either way, each phone needs the VPN on to open the app.

## 4. Primary setup

### 4.1 Caddyfile

```caddyfile
# /etc/caddy/Caddyfile (sketch); replace piano.example.com.
# TLS: automatic certificate and HTTP-to-HTTPS redirect [9].
piano.example.com {
	encode zstd gzip
	log {
		output file /var/log/caddy/piano.log
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "same-origin"
		-Server
	}

	# Login brake. Needs the caddy-ratelimit plugin [10]; delete this block on stock Caddy
	# (Authelia's regulation still applies). Endpoint paths from Authelia's API [43].
	rate_limit {
		zone login_per_ip {
			match {
				method POST
				path /authelia/api/firstfactor* /authelia/api/secondfactor/*
			}
			key {remote_host}
			ipv6_prefix 64
			events 10
			window 5m
		}
		zone login_all {
			match {
				method POST
				path /authelia/api/firstfactor* /authelia/api/secondfactor/*
			}
			key static
			events 60
			window 5m
		}
	}

	# The login portal, on the same origin as the app.
	handle /authelia* {
		reverse_proxy 127.0.0.1:9091
	}

	# Everything else: Authelia decides first, then Caddy serves the build.
	# Keep file_server inside this block so the gate fails closed [12].
	handle {
		forward_auth 127.0.0.1:9091 {
			uri /api/authz/forward-auth?authelia_url=https://piano.example.com/authelia/
			copy_headers Remote-User
		}
		root * /srv/digitus2/current
		@hashed path /assets/*
		header @hashed Cache-Control "private, max-age=31536000, immutable"
		@other not path /assets/*
		header @other Cache-Control "private, no-cache"
		file_server {
			precompressed br gzip
		}
	}
}
```

Caddy discards client-sent `X-Forwarded-For` values, so Authelia's IP bans see the real address [7]; the `authelia_url` form follows Authelia's subpath example [30]. If nginx already owns port 443 for the photo app, use nginx `auth_request` with Authelia's snippets [31] and `limit_req` [80] instead.

### 4.2 Authelia

`/opt/authelia/compose.yml`:

```yaml
services:
  authelia:
    image: authelia/authelia:4.39
    restart: unless-stopped
    ports: ['127.0.0.1:9091:9091']
    volumes: ['./config:/config', './secrets:/secrets:ro']
    mem_limit: 512m
    environment:
      AUTHELIA_SESSION_SECRET_FILE: /secrets/session
      AUTHELIA_STORAGE_ENCRYPTION_KEY_FILE: /secrets/storage
      AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET_FILE: /secrets/jwt
```

`config/configuration.yml` (the secret variable names are from [42], the options from [32][33][35][36][40]):

```yaml
server:
  address: 'tcp://:9091/authelia'
totp:
  issuer: 'digitus2'
webauthn:
  enable_passkey_login: false # true: a passkey can replace the password step
authentication_backend:
  password_reset:
    disable: true
  file:
    path: '/config/users.yml'
    watch: true
access_control:
  default_policy: 'deny'
  rules:
    - domain: 'piano.example.com'
      policy: 'two_factor'
session:
  cookies:
    - domain: 'piano.example.com'
      authelia_url: 'https://piano.example.com/authelia'
      default_redirection_url: 'https://piano.example.com/'
      inactivity: '2h'
      remember_me: '1M'
regulation:
  modes: ['ip']
  max_retries: 5
  find_time: '10m'
  ban_time: '1h'
storage:
  local:
    path: '/config/db.sqlite3'
notifier:
  filesystem:
    filename: '/config/notification.txt'
```

The `mem_limit` caps the worst case on the shared VPS: each concurrent hash takes 64 MiB [33], and the `login_all` zone bounds how many hashes can start in any five minutes.

### 4.3 Your steps

1. **DNS:** point an A record (and AAAA with IPv6) for the subdomain at the VPS, with ports 80 and 443 open; Caddy then gets the certificate and redirects HTTP by itself [9].
2. **Caddy with the plugin:** `xcaddy build --with github.com/mholt/caddy-ratelimit` [10] or the experimental `caddy add-package` [2]; or delete the `rate_limit` block.
3. **Secrets:** `openssl rand -hex 64 > /opt/authelia/secrets/<name>` for `session`, `storage` and `jwt`, then `chmod 600`.
4. **Users:** for each person, run `docker run --rm -it authelia/authelia:4.39 authelia crypto hash generate argon2` [34] and add an entry to `config/users.yml`:

   ```yaml
   users:
     anna:
       displayname: 'Anna'
       password: '$argon2id$v=19$m=65536,t=3,p=4$...'
       email: 'anna@example.com'
   ```

5. **Start:** run `docker compose up -d`, then `caddy reload`.
6. **Prove the gate fails closed:** with Authelia stopped, `curl -sI https://piano.example.com/` must return 502, not 200; once it runs again, 302 to `/authelia/`.
7. **Enable 2FA:** each person logs in, ticks "Remember me" and registers a second factor; the one-time code appears in `config/notification.txt` (read it over SSH and pass it on) or by mail with SMTP [37][38]. On phones choose WebAuthn (Face ID, Touch ID or a security key), with TOTP as a backup.
8. **Phone:** log in in the browser, then "Add to Home Screen"; the cookie is copied once at install [25]. If the Home Screen app asks again, log in inside it.

### 4.4 Caching, service worker and PWA

- Every response is `private`; hashed assets are `immutable`, and `index.html`, `sw.js` and the manifest are `no-cache` (section 4.1).
- Any credentialed gate needs `<link rel="manifest" crossorigin="use-credentials">` [21]: the one app change, in M13.
- The service worker must leave `/authelia/` alone (no navigation fallback, no runtime caching), or the cached shell hides the login page.
- After the session expires, the service worker update is fetched with redirect mode "error" [22], so it fails quietly and the installed version keeps working from cache, offline practice included. Navigations and score or sample fetches get a redirect to the login; the app should treat a redirected or opaque response as "signed out" and reload (M13 task).
- Safari deletes script-writable storage, service worker caches included, after seven days of Safari use without visiting the site; Home Screen apps count their own days [24].

### 4.5 CI deploy job

- The deploy and the gate are independent. On a tag, the job rsyncs the build over SSH into `/srv/digitus2/releases/<tag>/` and switches the `current` symlink that Caddy serves (for example with a fixed script behind a second forced-command key). The Caddyfile and Authelia files live elsewhere and belong to root, so the deploy key cannot touch the gate.
- Restrict the deploy key with `command="rrsync /srv/digitus2"` in `authorized_keys` [75]. SSH is not behind the gate and accepts keys only.
- The smoke check runs without credentials: `/` must return 302 to `/authelia/` (gate closed) and `/authelia/api/health` must return 200 [40]; `rsync --list-only` over the deploy key confirms the files. No user credentials go into CI.
- The GitHub Pages mirror stays public (spec, M12), so the gate protects only the VPS copy, and the private library (`content/private/`, T2) ships to the VPS only.

## 5. Fallback setup

```caddyfile
piano.example.com {
	encode zstd gzip
	log {
		output file /var/log/caddy/piano.log
		format json {
			time_format common_log
		}
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "same-origin"
		Cache-Control "private, no-cache"
	}
	basic_auth {
		anna $2a$14$...
		ben  $2a$14$...
	}
	root * /srv/digitus2/current
	file_server
}
```

The fail2ban filter and jail are adapted from [13]. Test the filter with `fail2ban-regex` before enabling the jail.

```ini
# /etc/fail2ban/filter.d/caddy-auth.local
[Definition]
failregex = ^.*"remote_ip":"<HOST>",.*?"status":401.*$
datepattern = %%d/%%b/%%Y:%%H:%%M:%%S %%z

# /etc/fail2ban/jail.d/caddy-auth.local
[caddy-auth]
enabled  = true
backend  = auto
filter   = caddy-auth
logpath  = /var/log/caddy/piano.log
port     = http,https
maxretry = 20
findtime = 10m
bantime  = 1d
```

To set it up, create the users with `caddy hash-password` [2], using 20 or more random characters from a password manager. Pick `maxretry` high enough to absorb the normal 401 challenges [11]. Add the same `crossorigin` attribute to the manifest [21].

## 6. To verify on real devices before M12 ships

| Check                                                                                | Why                                                                    |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| iPhone Home Screen app: log in inside the standalone app, then reopen it a day later | Cookie isolation [25]; reports of login redirects leaving the app [26] |
| Android installed app: the same check                                                | Separate storage per installed app                                     |
| Stop Authelia: the site must return 502, not files                                   | Fail-open trap [12]                                                    |
| Fallback only: basic auth prompt inside the installed PWA                            | Service worker prompt bug [20]                                         |

## Sources

1. Caddy, `basic_auth` directive. https://caddyserver.com/docs/caddyfile/directives/basic_auth
2. Caddy, command line (`hash-password`, `add-package`). https://caddyserver.com/docs/command-line
3. Caddy source, bcrypt default cost 14. https://github.com/caddyserver/caddy/blob/master/modules/caddyhttp/caddyauth/bcrypt.go
4. Caddy source, argon2id defaults (t=1, 46 MiB, 1 thread). https://github.com/caddyserver/caddy/blob/master/modules/caddyhttp/caddyauth/argon2id.go
5. Caddy source, Caddyfile enables the basic-auth hash cache. https://github.com/caddyserver/caddy/blob/master/modules/caddyhttp/caddyauth/caddyfile.go
6. Caddy, `forward_auth` directive. https://caddyserver.com/docs/caddyfile/directives/forward_auth
7. Caddy, `reverse_proxy` directive (X-Forwarded-For handling). https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
8. Caddy, `tls` directive (`client_auth`). https://caddyserver.com/docs/caddyfile/directives/tls
9. Caddy, automatic HTTPS. https://caddyserver.com/docs/automatic-https
10. mholt/caddy-ratelimit README. https://github.com/mholt/caddy-ratelimit
11. Caddy Community, "Caddy and fail2ban--401 logging" (2023-08-12). https://caddy.community/t/caddy-and-fail2ban-401-logging/20802
12. Caddy Community, forward_auth fails open when the files are served outside its block (2025-02-03). https://caddy.community/t/solved-what-happens-when-the-forward-auth-service-cannot-be-reached-all-doors-open/29826
13. skippy.net, "Caddy + fail2ban" (2025-03-25). https://skippy.net/caddy-fail2ban
14. CrowdSec FAQ, v1.1 docs (agent memory). https://doc.crowdsec.net/docs/v1.1/faq
15. CrowdSec Hub, `crowdsecurity/http-generic-bf`. https://app.crowdsec.net/hub/author/crowdsecurity/scenarios/http-generic-bf
16. nginx, `ngx_http_auth_basic_module`. https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html
17. nginx, `ngx_http_auth_request_module`. https://nginx.org/en/docs/http/ngx_http_auth_request_module.html
18. nginx, `ngx_http_ssl_module` (`ssl_verify_client`). https://nginx.org/en/docs/http/ngx_http_ssl_module.html
19. MDN, HTTP authentication. https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Authentication
20. w3c/ServiceWorker issue 1400, no basic-auth prompt with a service worker (Chrome). https://github.com/w3c/ServiceWorker/issues/1400
21. MDN, web app manifest (`crossorigin="use-credentials"`). https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest
22. W3C Service Workers, Update algorithm (redirect mode "error"). https://w3c.github.io/ServiceWorker/#update-algorithm
23. WHATWG Fetch, definition of credentials. https://fetch.spec.whatwg.org/#credentials
24. WebKit blog, "Full Third-Party Cookie Blocking and More" (2020-03-24). https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
25. Progressier, cookies in installed PWAs. https://progressier.com/pwa-capabilities/cookies-demo
26. Apple Developer Forums, "PWA standalone issue in iOS 11.3". https://developer.apple.com/forums/thread/100524
27. OWASP, Password Storage Cheat Sheet. https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
28. Authelia, GitHub repository. https://github.com/authelia/authelia
29. Authelia, releases. https://github.com/authelia/authelia/releases
30. Authelia, Caddy integration. https://www.authelia.com/integration/proxies/caddy/
31. Authelia, nginx integration. https://www.authelia.com/integration/proxies/nginx/
32. Authelia, regulation. https://www.authelia.com/configuration/security/regulation/
33. Authelia, file authentication backend. https://www.authelia.com/configuration/first-factor/file/
34. Authelia, passwords guide. https://www.authelia.com/reference/guides/passwords/
35. Authelia, session. https://www.authelia.com/configuration/session/introduction/
36. Authelia, WebAuthn. https://www.authelia.com/configuration/second-factor/webauthn/
37. Authelia, elevated session. https://www.authelia.com/configuration/identity-validation/elevated-session/
38. Authelia, filesystem notifier. https://www.authelia.com/configuration/notifications/file/
39. Authelia, get started. https://www.authelia.com/integration/prologue/get-started/
40. Authelia, server (address with path, `/api/health`). https://www.authelia.com/configuration/miscellaneous/server/
41. Authelia, endpoint rate limits. https://www.authelia.com/configuration/miscellaneous/server-endpoint-rate-limits/
42. Authelia, secrets. https://www.authelia.com/configuration/methods/secrets/
43. Authelia, OpenAPI specification. https://github.com/authelia/authelia/blob/master/api/openapi.yml
44. Railway, Authelia template ("20–25 MB of memory at runtime"). https://railway.com/deploy/authelia-lightweight-open-source-keycloak-alternative--authelia
45. tinyauth, README. https://github.com/steveiliop56/tinyauth
46. tinyauth, getting started. https://tinyauth.app/docs/getting-started/
47. tinyauth, configuration reference. https://tinyauth.app/docs/reference/configuration/
48. tinyauth, TOTP guide. https://tinyauth.app/docs/guides/totp/
49. tinyauth, Caddy guide. https://tinyauth.app/docs/community/caddy/
50. tinyauth, changelog. https://tinyauth.app/docs/reference/changelog/
51. tinyauth, releases. https://github.com/tinyauthapp/tinyauth/releases
52. tinyauth v5.2.0 source, login controller (lockout per username). https://github.com/tinyauthapp/tinyauth/blob/v5.2.0/internal/controller/user_controller.go
53. tinyauth, Pocket ID guide. https://tinyauth.app/docs/guides/pocket-id/
54. caddy-security, releases. https://github.com/greenpau/caddy-security/releases
55. NVD, CVE-2024-21500. https://nvd.nist.gov/vuln/detail/CVE-2024-21500
56. NVD, CVE-2024-21495. https://nvd.nist.gov/vuln/detail/CVE-2024-21495
57. Vouch Proxy, README. https://github.com/vouch/vouch-proxy
58. Pocket ID, README. https://github.com/pocket-id/pocket-id
59. Pocket ID, installation. https://pocket-id.org/docs/setup/installation
60. Pocket ID, sign-in methods. https://pocket-id.org/docs/guides/sign-in-methods
61. Pocket ID, user management. https://pocket-id.org/docs/setup/user-management
62. Pocket ID, authentication proxies. https://pocket-id.org/docs/guides/proxy-services
63. Pocket ID v2.18.0 source, rate-limit policies. https://github.com/pocket-id/pocket-id/blob/v2.18.0/backend/internal/middleware/rate_limit.go
64. Pocket ID, releases. https://github.com/pocket-id/pocket-id/releases
65. Cybozu, installing a client certificate on iOS 17. https://jp.cybozu.help/en/settings/browser/certificate/iphone/ios17.html
66. Google, installing certificates on Pixel phones. https://support.google.com/pixelphone/answer/2844832
67. WireGuard, protocol. https://www.wireguard.com/protocol/
68. WireGuard, installation. https://www.wireguard.com/install/
69. Tailscale, supported identity providers. https://tailscale.com/kb/1013/sso-providers
70. Tailscale, passkeys. https://tailscale.com/kb/1269/passkeys
71. Headscale, README. https://github.com/juanfont/headscale
72. Headscale, releases. https://github.com/juanfont/headscale/releases
73. Headscale, registration methods. https://headscale.net/stable/ref/registration/
74. Headscale, connecting Apple devices. https://headscale.net/stable/usage/connect/apple/
75. rsync, `rrsync` manual. https://download.samba.org/pub/rsync/rrsync.1
76. Docker Hub, `authelia/authelia` tags. https://hub.docker.com/r/authelia/authelia/tags
77. Docker Hub, `pocketid/pocket-id` tags. https://hub.docker.com/r/pocketid/pocket-id/tags
78. tinyauth, authentication reference (bcrypt). https://tinyauth.app/docs/reference/authentication/
79. AuthCrunch (caddy-security) documentation. https://docs.authcrunch.com/docs/intro
80. nginx, `ngx_http_limit_req_module`. https://nginx.org/en/docs/http/ngx_http_limit_req_module.html
81. Pocket ID, introduction. https://pocket-id.org/docs/
