---
title: "Running Multiple Services in a Docker Container with OpenRC"
subtitle: "Or: serverful containers"
date: 2026-03-07T00:00:00Z
lastmod: 2026-08-21T00:00:00Z
authors: ["Rishi Kulkarni"]
description: "How to use Alpine's built-in OpenRC as a process supervisor inside Docker containers — with service dependencies, health checks, and syslog logging — instead of supervisord or s6-overlay."
abstract: "A case for using OpenRC as a process supervisor inside Docker containers – leveraging familiar init system conventions instead of learning a container-specific tool like s6-overlay. Includes a working proof of concept with FastAPI, a background worker, and nginx."
tags: ["containers", "docker", "openrc", "alpine", "supervisord", "process-supervisor", "s6-overlay"]
keywords: ["docker multiple services", "openrc docker", "s6-overlay alternative", "supervisord alternative", "alpine docker init system", "docker process supervisor"]
toc: false
---

My wife has a blog that I self-host. WordPress-based, so it's MySQL, PHP-FPM, nginx. I'd like to think about its deployment/infrastructure approximately never.

I [wrote previously](/blog/systemd-portable-services/) about portable services being a good fit for single-server side projects. The short version: if you're running your own code on your own server, containers add a process manager on top of a system that already has a process manager, and that's a lot of abstraction to end up back at "run this binary." But WordPress is other people's software, and frankly, software from another, more complicated time. PHP-FPM needs native extensions, its own socket management, and write access to paths you'd rather it couldn't reach – the kind of thing that fights you when you try to sandbox it with systemd's `ProtectSystem=strict`. This is the case containers were actually designed for: packaging someone else's dependency tree so you don't have to understand it. I want to deploy one thing and forget about it.

The obvious move is three containers, one per service, composed together. At work, that's the right call. You want to upgrade the app server without bouncing the database, scale services independently, roll back one thing without touching the rest. But this is my wife's blog. I don't need independent scaling. I don't need zero-downtime MySQL upgrades. I need to deploy one thing and have it work. I have a Gitea instance, so I want one image for her whole stack, pull it down, restart the container on the box. A few seconds of downtime is fine. I'd rather restart three processes together than maintain a compose file that coordinates them separately.

So: one container, three services. The standard answer is s6-overlay[3]. I opened the getting-started guide and immediately felt the weight of it: its own service directory layout, its own shell language, its own readiness protocol. None of it maps to anything I use outside of s6-managed containers, so it seemed like brainspace I could spend on other things. Alpine ships OpenRC. It's in the base image. I use OpenRC at work, so it's not a new thing I'd have to learn. I wanted to see if I could just use it inside a container.

In this case, rather treat the container image like a machine image. Not a single-process isolation unit, but a machine with an init system, services, and state. You `docker exec` in like you'd SSH in. You run `rc-status` and see your services. The init scripts are the same ones you'd write on bare metal. The debugging is the same. The container is just the box it ships in.

I built a proof of concept with a simpler stack first (a FastAPI app, a background worker, and nginx) to see how far this goes.

## The same init script everywhere

The webapp init script:

```sh
#!/sbin/openrc-run

description="FastAPI web application"

supervisor="supervise-daemon"
command="/opt/app/.venv/bin/uvicorn"
command_args="main:app --host 127.0.0.1 --port 8000"
directory="/opt/app"

respawn_delay=3
respawn_max=5
respawn_period=60

healthcheck_delay=10
healthcheck_timer=5

healthcheck() {
    wget -q --spider http://127.0.0.1:8000/health
}

output_logger="logger -t webapp -p daemon.info"
error_logger="logger -t webapp -p daemon.notice"
```

`supervisor="supervise-daemon"` tells OpenRC to keep the process alive – crash, restart, with configurable respawn limits. But the thing I keep coming back to is that this is a standard OpenRC init script. Copy it to a bare-metal Alpine server and it just works. Same file, same commands, same mental model. The container is just the packaging. Inside, it's a normal server.

The dependency model is straightforward. The nginx init script declares what it needs:

```sh
depend() {
    need webapp
}
```

And the worker declares ordering:

```sh
depend() {
    after webapp
}
```

`need` is a hard dependency – nginx won't start if webapp is down, and it stops first on shutdown. `after` is just ordering – the worker starts after webapp but doesn't care if webapp fails later. Shutdown reverses automatically: nginx, then worker, then webapp. Same dependency semantics you'd find in any init system. Nothing container-specific about it.

I found the healthcheck by accident, running `supervise-daemon --help` while debugging a crash loop. Define a `healthcheck()` function in the init script, set a timer with `healthcheck_timer`, and the supervisor calls it periodically. If it fails, the process gets restarted. It felt like discovering that the tool I already had could do the thing I was about to go looking for. This is different from Docker's `HEALTHCHECK`, which reports status to the orchestrator. `supervise-daemon` acts on it directly, which is what you actually want when there's no orchestrator.

## Containers don't boot, but you can pretend

OpenRC expects a full boot sequence to have happened. In a container, obviously, it hasn't – there's no kernel handing off to init, no sysinit runlevel, no `/run` populated by tmpfs mounts. The entrypoint fakes just enough of it:

```sh
#!/bin/sh
set -e

echo "==> Bootstrapping OpenRC..."
mkdir -p /run/openrc
echo "default" > /run/openrc/softlevel

echo "==> Starting services..."
openrc default

echo "==> All services started."
rc-status

# Forward signals to gracefully stop services
shutdown() {
    echo "==> Caught signal, stopping services..."
    rc-service nginx stop || true
    rc-service worker stop || true
    rc-service webapp stop || true
    echo "==> All services stopped."
    exit 0
}

trap shutdown TERM INT

# Wait forever, allowing signals to be delivered
while true; do
    sleep 1 &
    wait $! || true
done
```

You have to write `default` to `/run/openrc/softlevel`[2] before calling `openrc default`. My first attempt tried starting services individually with `rc-service` – cleaner, I thought, more explicit. I got "already starting" errors from stale state and spent twenty minutes chasing phantom PID files before realizing I was fighting the init system instead of using it. `openrc default` bootstraps everything properly. Same lesson as always: don't try to be smarter than the system you're using.

Alpine 3.23's OpenRC auto-detects Docker – `openrc --version` prints `[DOCKER]`. The only remaining tweaks are in the Dockerfile:

```dockerfile
RUN sed -i 's/^#rc_cgroup_mode=.*/rc_cgroup_mode="none"/' /etc/rc.conf && \
    rm -f /etc/init.d/hwdrivers /etc/init.d/machine-id
```

Disable cgroup management, since the container runtime owns cgroups and `/sys/fs/cgroup` is read-only inside the container. Remove two hardware init scripts that complain about a missing `dev` service.

The `tmpfs` on `/run` in docker-compose matters:

```yaml
services:
  serverful:
    build: .
    ports:
      - "8080:80"
    stop_grace_period: 30s
    tmpfs:
      - /run
      - /tmp
```

OpenRC writes state files to `/run`. Without the `tmpfs`, you get stale state from the image layer on restarts, and services think they're already running when they aren't. This was the other half of my "already starting" debugging session – the container-as-server illusion breaks down if you don't give it a fresh `/run` on each start, just like a real server gets one on each boot.

## Logging doesn't need a framework

`supervise-daemon` has `--stdout-logger` and `--stderr-logger`[1]. Point them at a program, and it pipes service output through it. In OpenRC init scripts, these are set via the `output_logger` and `error_logger` variables.

My first version was a five-line shell script that read stdin and wrote `[webapp] ...` to `/proc/1/fd/1`, PID 1's stdout. It felt like a bit of a hack, and a coworker pointed out I could just use syslog. The program that tags a line and hands it off already exists: `logger`. So each service now has

```sh
output_logger="logger -t webapp -p daemon.info"
error_logger="logger -t webapp -p daemon.notice"
```

and a `need syslog` in its `depend()`. BusyBox `syslogd` runs as a normal OpenRC service in the same runlevel, configured in `/etc/conf.d/syslog` to write a small rotating file:

```sh
SYSLOGD_OPTS="-t -O /var/log/messages -s 4096 -b 2"
```

One catch: BusyBox `syslogd` writes either to a file or to its in-memory ring buffer, never both, and it has no "also print to stdout" mode. So the entrypoint runs `tail -F /var/log/messages &` before starting services, which puts the same lines on container stdout for `docker logs`. The file is just used as a buffer, so three 4 MB slices is plenty.

What you get is the standard format any Alpine admin recognizes:

```
Aug 22 00:59:21 8cb21743dca9 user.notice worker: Worker started, polling for tasks...
Aug 22 00:59:22 8cb21743dca9 daemon.notice webapp: INFO:     Application startup complete.
```

Timestamps, priority, the service name. `supervise-daemon` logs to syslog as well, so its restart and shutdown messages show up in the same stream, which I didn't get with the shell script. And this is the same `logger` and `syslogd` I'd be looking at on any Alpine box, but exported in a way that k8s or ECS can slurp them up properly.

## On not learning new things

For my own code, I'd use portable services – I [wrote about why](/blog/systemd-portable-services/). But for WordPress, I'm already in a container, and at that point the question is which process supervisor to use inside it.

s6-overlay is the standard answer, and it gets a lot right: proper PID 1 signal handling, a real supervision tree, clean process lifecycle management. I opened the getting-started guide and could see the engineering behind it. But it's a third init system to hold in my head, after systemd and OpenRC, and one with a much smaller user base than either. `s6-rc.d` service directories, `type` files, `dependencies.d` directories, `run` scripts in execline syntax, a readiness notification protocol, a `cont-init.d` pattern for one-shot setup, its own logging pipeline. I bounced off it not because it looked hard, but because it's knowledge I'd use in exactly one place. Next time I needed it I'd re-learn it from scratch, because none of the concepts transfer.

OpenRC init scripts, service dependencies, `rc-service`, `rc-status`: I already know these. They work on any Alpine or Gentoo server. The mental model – supervised daemons, runlevels, dependency ordering – is the same one behind systemd, runit, and every other Unix init system. When something breaks at 10pm and I `docker exec` in, the experience is the same as SSHing into any Alpine box. I run `rc-status`, I see what's down, I check logs. I'd rather debug with tools I use everywhere than remember what `s6-svc -d /var/run/s6/services/nginx` does.

I've never liked the advice that you should always use the best tool for the job. In this specific instance, I'd rather just use the one I already understand.

---

[1] In OpenRC init scripts, `--stdout-logger` and `--stderr-logger` are set via the `output_logger` and `error_logger` variables. The supervisor spawns the logger process and pipes service output through it.

[2] `softlevel` is how OpenRC tracks which runlevel is active. Normally written by sysinit during boot, which doesn't happen in containers.

[3] s6-overlay – Laurent Bercot's s6 process supervision suite, packaged for containers by Just Containers.
