---
title: "systemd Portable Services Are Pretty Good"
date: 2025-12-31T00:00:00Z
lastmod: 2025-12-31T00:00:00Z
authors: ["Rishi Kulkarni"]
description: "How systemd portable services provide version-controlled deployment, atomic updates, and socket activation for a side project—without containers or orchestrators."
abstract: "Running a side project in production means coming back after months and needing deploys to just work. This post explores how systemd portable services solve version-controlled config, single-artifact deployment, and zero-downtime restarts for bowl.science—without the ceremony of containers or fleet orchestrators."
tags: ["systemd", "linux", "self hosting", "devops", "side projects"]
keywords: ["systemd portable services", "socket activation", "deployment", "Linux", "VPS", "side project", "Go", "SQLite", "Litestream", "Docker alternative", "container alternative", "atomic deployment", "zero-downtime restart", "portablectl", "systemd unit files"]
toc: true
---

I run [bowl.science](https://bowl.science), an online Science Bowl tournament platform. It's a side project, but it's real production: the DOE Office of Science uses it for their Science Bowl competitions. When a tournament is happening, the app needs to work. There's no "we'll fix it in the next sprint."

It's a Go server with SQLite, a real-time buzzer system via Server-Sent Events, and automatic TLS via Let's Encrypt—a single Debian 13 (Trixie) VPS runs the whole thing. The database is replicated to S3 using [Litestream](https://litestream.io/) for disaster recovery, and the VPS handles tournament load fine.

The challenge is maintaining it. This is a side project, which means I might not touch the code for months at a time, but I get feature requests from the Science Bowl steering committee once a season or so. When that happens, I need to make a change, deploy it, and not break production—without having to remember what I did last time. One command should deploy everything, no half-finished states. And if something breaks, I should be able to come back after six months and understand how the deployment works without re-learning a bespoke system.

For a while, I ran the app (server and Litestream) as bare binaries with systemd units I'd written directly on the server. It worked, but "how do you run this thing?" lived only in production. Every deploy was SSH, copy the new binary, restart the service. Making changes to the service configuration meant editing files on the server and hoping I remembered what I changed.

## What I Needed

Mostly I just wanted version-controlled deployment config. The systemd unit files, the environment setup, the whole "how to run this"—it should live in the repo, not on the server. If I could get that and also deploy the app and Litestream together as a single artifact, even better. No separately managing "deploying the app" and "deploying Litestream." Atomic updates: the new version swaps in completely, no partial states.

The coordination is a bit tricky. Litestream needs to restore the database before the app starts (for disaster recovery), then run continuously alongside it. Three services, one database, specific ordering. They all need to read/write the same SQLite file, so they need the same UID.

Oh, and ports. The app needs 80 and 443, but I don't want to run as root or put nginx in front.

## Why Not Docker or s6?

I assumed the landscape had changed since the last time I ran a server binary on a VM; containers are everywhere now. There had to be a clean way to get version-controlled config, single artifacts, and service coordination without adopting a fleet orchestrator.

At work, I'd reach for ECS. It checks every box: task definitions live in source control (via Terraform or CDK), you deploy container images as single artifacts, updates are atomic, and you can wire up service dependencies. ECS is good software.

But ECS abstracts over where your code runs. You don't know which EC2 instance your container lands on, or when it might migrate to a different one. That's the right model when you're scaling horizontally—you *want* the orchestrator to place containers wherever there's capacity.

I'm already managing the underlying VM: I picked the VPS, I SSH into it, I know it's the same machine every time. I don't need an abstraction that hides the server from me; the server is the whole point.

This ends up imposing a ton of constraints. You need an artifact registry, because the orchestrator pulls images rather than you pushing them. Pull-based GitOps makes sense when any node in a fleet might need your image at any time, but for a single server, it means uploading to ECR, waiting for propagation, then downloading it again to the same place you could have just `scp`'d it directly.

Deploys are slow. ECS pulls your image, starts the container, runs health checks, waits for the deregistration delay (default: 5 minutes), drains connections from the old task, updates the target group. That's all the right behavior for a fleet, but when "deploy" means "restart one process on one server," it's ceremony around a `systemctl restart`.

**Docker Compose** is the obvious starting point. Define your services in a `docker-compose.yml`, check it into git, `scp` it to the server, run `docker-compose up`. Version-controlled config, service dependencies, single command to deploy. But what is Docker Compose, really? It's a process manager. It starts your services, restarts them when they crash, manages their dependencies, coordinates their lifecycle. You know what else does that? The init system that's already running on the VM. And the container part—what's it buying me? Go already produces single-file statically-linked executables. The whole point of OCI images is packaging your app with its dependencies into a portable artifact. I don't have dependencies. I have a binary. Wrapping it in a container so I can use a process manager so I can run it on a system that already has a process manager feels like a lot of abstraction to end up back at "run this binary."

**s6-overlay** takes the opposite approach: bundle everything into one container with a lightweight supervisor inside. One image, one artifact, multiple processes. But now every deploy restarts everything, and in practice, I update the app constantly and Litestream almost never. Restarting Litestream forces a full database snapshot—I don't want that every time I fix a typo in a template.

**Multiple systemd units** is what I was already doing—just formalize it. Write the unit files locally, check them into git, copy them to the server as part of the deploy. This gets version control, but it's not a single artifact; I'm copying unit files, reloading the daemon, deploying the binaries separately, and there's no atomic "here's the new version of everything." The pieces can get out of sync. This is, in fact, what I had been doing—and I'd ended up writing about 600 lines of Python to orchestrate it all properly. That felt very silly.

I was poking around Lennart Poettering's blog when I found a post about portable services. It sounded like exactly what I wanted: systemd's process management, but with a single deployable image.

## How Portable Services Work

A portable service image is, essentially, an extremely minimal OS image. It has the standard Linux filesystem layout—`/usr/bin` for binaries, `/usr/lib/systemd/system` for unit files, `/etc` for configuration—but contains only what your application needs.

systemd can *dissect* this image. When you run `portablectl attach`, it mounts the image, looks inside, finds the unit files, and installs them as native systemd services. There's no abstraction layer, no daemon managing the container lifecycle, no translation between "what the container wants" and "what the host provides." The services in the image become regular systemd services, managed with `systemctl` like anything else.

Inside the image:

```
├── usr/
│   ├── bin/
│   │   ├── bowlscience-server        # The Go binary
│   │   └── litestream                # Database replication tool
│   ├── lib/
│   │   ├── os-release                # Identifies this as a portable service
│   │   └── systemd/system/
│   │       ├── bowlscience.target
│   │       ├── bowlscience.service
│   │       ├── bowlscience-http.socket
│   │       ├── bowlscience-https.socket
│   │       ├── bowlscience-litestream-restore.service
│   │       └── bowlscience-litestream-replicate.service
│   └── share/litestream/
│       ├── litestream-dev.yml
│       └── litestream-prod.yml
├── var/
│   ├── lib/bowlscience/              # StateDirectory (writable at runtime)
│   └── tmp/
├── etc/
│   ├── ssl/certs/                    # Bind-mounted from host
│   ├── resolv.conf                   # Bind-mounted from host
│   └── machine-id                    # Bind-mounted from host
├── dev/                              # Bind-mounted from host
├── proc/                             # Bind-mounted from host
├── sys/                              # Bind-mounted from host
├── tmp/
└── run/
```

Most of this is scaffolding—empty directories and placeholder files that get bind-mounted from the host at runtime. The actual content is the binaries, service units, and config files in `usr/`.

The [systemd portable services documentation](https://systemd.io/PORTABLE_SERVICES/) covers the details of building these images. The short version: create this directory layout, add an `os-release` file that tells systemd which unit files to extract, and compress it:

```bash
mksquashfs bin/bowlscience bin/bowlscience.raw -noappend -all-root -comp xz
```

The result is an 18 MB image. Given that it's two Go binaries xz-compressed, that's about as small as it gets. For updates, `portablectl reattach` atomically swaps to the new version—the old image is unmounted and the new one takes its place.

This gets me most of what I wanted. The service unit files live in `deployment/portable/usr/lib/systemd/system/` in my git repo—changes to how the app runs are code changes, reviewed and committed like anything else. Both binaries are in the same image, but they're still independent systemd services. One `make deploy` uploads one file, and the `reattach` command swaps the entire image atomically—but I can choose which services to restart, so I can update the app without bouncing Litestream.

It also solved a problem I didn't have a good answer for: downtime during restarts. Go binaries boot fast—a few hundred milliseconds—but that's still a window where requests get connection refused. With containers, you either accept the blip or put a load balancer in front. For a single-server side project, neither felt right.

## Zero-Downtime Restarts

systemd can bind the listening socket before your application starts, then pass it to the app as an already-open file descriptor. The socket stays open across restarts—systemd queues incoming connections in the kernel (up to the listen backlog, typically 4096) while the new process spins up. From the client's perspective, the request just takes a bit longer. No connection refused, no dropped requests.

This is something container runtimes can't easily provide. The container owns its network namespace; you can't hand it a socket that was bound outside. With portable services, the app runs directly under systemd, so socket activation just works.

It also solves the privileged port problem. The app serves HTTPS on port 443, which normally requires root. With socket activation, systemd binds the port (as root, during early boot) and hands it off, so the app can run unprivileged.

The socket unit:

```ini
# bowlscience-http.socket
[Unit]
Description=bowl.science HTTP Socket (port 80)
PartOf=bowlscience.target

[Socket]
ListenStream=80
FileDescriptorName=http
Service=bowlscience.service

[Install]
WantedBy=sockets.target
```

The socket points at a target, not at the service. The target is a small grouping unit that owns the app as a whole:

```ini
# bowlscience.target
[Unit]
Description=bowl.science (sockets, server, Litestream)
Wants=bowlscience-http.socket bowlscience-https.socket
Wants=bowlscience.service bowlscience-litestream-replicate.service

[Install]
WantedBy=multi-user.target
```

Every unit declares `PartOf=bowlscience.target`. `PartOf=` propagates stop and restart, and it's one-way: "changes to this unit do not affect the listed units." Restarting the server leaves the sockets alone and the queued connections intact, while `systemctl stop bowlscience.target` takes listeners and processes down together.

On the Go side, the `github.com/coreos/go-systemd/v22/activation` package retrieves the passed file descriptors. The server checks for activated listeners at startup; if none (local dev), it falls back to binding ports directly.

I wasn't thinking about security when I set up socket activation—I just wanted zero-downtime restarts. But the app never touches port 443 directly, which means it never needs elevated privileges. Security as a side effect.

Portable services come with more of this by default. `PrivateUsers=yes` means the app runs in its own user namespace—root inside the sandbox has no privileges on the host. The mount namespace isolation (can't see the filesystem except for bind-mounts) comes along with it. I didn't configure any of this—it's just how `portablectl attach` works.

I added a few more things while I was in there: `DynamicUser=yes` allocates a UID at runtime, so I don't need a system user. `StateDirectory=bowlscience` creates `/var/lib/bowlscience` with the right ownership. `ProtectSystem=strict` makes the filesystem read-only. I kept adding lines until `systemd-analyze security bowlscience.service` got the score down to something reasonable.

## The Deploy

I `scp` the new image to the server and run `portablectl reattach` to swap it in. Then I restart just the app service—Litestream keeps running. No unnecessary database snapshot just because I fixed a typo. I wrapped this in a `make deploy` target; there's a `--restart-all` flag for when I actually update Litestream.

Server setup was cloud-init creating a deploy user with SSH access and sudo for `portablectl`. The minimal setup also meant I could match it locally—my dev environment is a Lima VM running the same OS and systemd version as production, so I test the full deploy, not just the app, before pushing.

Secrets go in override files:

```bash
# /etc/systemd/system/bowlscience.service.d/10-env.conf
[Service]
Environment=CF_API_TOKEN=...
```

This works, though `LoadCredential` would be better—the credential stays in a file rather than an environment variable visible in `/proc`. I'll probably do that next.

## Wrapping Up

The deployment config is in git. That was the main thing I wanted. The Python script is gone—turns out 600 lines of "orchestrate copying files and restarting services" is what systemd already does, and frankly, it's better at it.

The downtime thing was a bonus. I'd accepted 4-5 seconds of blip as the cost of deploying a side project without a load balancer. Socket activation brought that to near-zero, and I wasn't even trying to solve that problem when I started.
