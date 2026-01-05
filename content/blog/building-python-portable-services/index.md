---
title: "Building systemd Portable Service Images for Python Apps with Native Dependencies"
date: 2026-01-05T00:00:00Z
lastmod: 2026-01-05T00:00:00Z
authors: ["Rishi Kulkarni"]
description: "How to build lightweight systemd portable service images for Python applications with native dependencies like scikit-sparse and GDAL—using user namespaces and pivot_root instead of Docker."
abstract: "Even Python apps with native dependencies are no problm for building minimal, rootless systemd portable service images."
tags: ["systemd", "linux", "python", "devops", "containers"]
keywords: ["systemd portable services", "Python native dependencies", "mksquashfs", "Alpine Linux", "user namespaces", "pivot_root", "Docker alternative", "buildah", "mkosi", "scikit-sparse", "GDAL", "manylinux wheels", "container image building", "rootless builds", "unshare"]
toc: true
---

In my [previous post](/blog/systemd-portable-services/), I covered running portable services—version-controlled config, atomic updates, zero-downtime restarts, all without a container runtime. This is only half of the container story, though. You also need to build the service images.

For bowl.science, it was trivial. Go produces static binaries; I just needed a directory structure with the binary and unit files, then `mksquashfs`. No dependencies, no package manager, no base OS. The "image" was essentially empty except for my code.

But at work, I often work with Python apps that have dependencies on native math libraries. Fortunately, it turns out to be only very slightly more complex.

## Wheels Are Good When They Exist

Python apps with native dependencies can't start from scratch. You need a libc, a package manager, shared libraries. The image has to be a real OS—or at least enough of one to run your code.

Most Python packages have gotten easier. numpy, scipy, pandas—they ship manylinux wheels with native deps bundled. `pip install scipy` just works; OpenBLAS comes along for the ride.

But some packages can't do that. scikit-sparse links against SuiteSparse, specifically CHOLMOD. CHOLMOD is GPL, and bundling it statically would make scikit-sparse GPL. So it dynamically links—which means the system library needs to be present at runtime.

This isn't obscure. GDAL has the same problem. So do libvips bindings, certain database drivers, anything touching GPU libraries. These are the cases where wheels don't save you; you need actual system packages in your image.

But how do you build that image?

## Why Not Docker or mkosi?

**Docker** is the default. Dockerfiles are easy, the caching is good, the ecosystem is huge. But if I'm not using a container runtime anyway, building with Docker just to extract a rootfs feels backwards. Even using `buildah` (which is peak rootless and daemonless), I'm making an OCI image for no reason.

**mkosi** is the systemd-native answer. It's designed for building OS images—VMs, testing systemd itself, bootable USB sticks, etc. Portable Services are an explicitly supported use case, but a bit of an afterthought - you still have to use a proper distro image as a base.

The problem is those distros are heavy. One [blog post](https://samthursfield.wordpress.com/2022/05/13/trying-out-systemds-portable-services/) built a portable service with a trivial C application and ended up with a 76MB image containing 5,200 files. That's glibc, systemd libraries, dbus, locale data—none of which matters for a portable service. systemd manages the service from outside; you don't need systemd inside the image. `mkosi` also requires root or privileged operations to bootstrap the package manager.

I wanted Docker-like build convenience (or even `buildah`-like)—run commands, install packages, get a filesystem—but with minimal output, and without needing root.

## What Docker Actually Does

If I were using Docker without multi-stage builds, the Dockerfile would look something like this:

```dockerfile
FROM alpine:3.21
RUN apk add --virtual .build-deps gcc g++ make suitesparse-dev openblas-dev
RUN apk add suitesparse
COPY . /opt/app
RUN cd /opt/app && uv sync --no-dev --compile-bytecode
RUN apk del .build-deps
```

What does Docker actually do here?

1. Download the Alpine base image (really just a tarball of a minimal rootfs)
2. Extract it somewhere
3. Run commands inside it, isolated from the host
4. Package the result

Buildah, rootless Podman, rootless Docker—they all use the same kernel primitives to do step 3: user namespaces, mount namespaces, pivot_root. These tools wrap complexity around those primitives (OCI image format, layer storage, registry protocols), but the core of "run commands in an isolated rootfs as a regular user" is just a few syscalls.

We can use those primitives directly. One wrinkle: I'm building on a glibc system (Debian, Ubuntu, most distros) but targeting Alpine, which uses musl. You can't run musl binaries on a glibc host, so you have to actually pivot into the Alpine rootfs to run anything. You could use chroot, but pivot_root is more secure—once you unmount the old root, there's no path back to the host.

## 130 Lines of Bash

The whole thing is about 130 lines of bash, which really shattered my Dockerbrain. Here's how it maps to the Docker steps:

First, download and extract Alpine's minirootfs tarball—a 3MB download.

The interesting part is running commands inside, isolated from the host. The script uses:

```bash
unshare --user --map-root-user --mount bash -c "$setup"
```

Three flags:
- `--user`: new user namespace. You appear as UID 0 inside.
- `--map-root-user`: maps your host UID to 0 in the namespace. Required for mount operations.
- `--mount`: private mount namespace. Changes don't affect the host.

Inside the namespace, the script uses `pivot_root` to swap the root filesystem:

```bash
pivot_root . .pivot_old
umount -l /.pivot_old
rmdir /.pivot_old
```

This is different from chroot. chroot just changes where `/` resolves—the old root is still accessible if you escape. `pivot_root` atomically swaps the filesystems, then you unmount the old one. There's no path back to the host, which means a compromised build can't touch your actual system (beyond explicit bind mounts).

From there, it's just Alpine. The app definition (my Dockerfile equivalent) is a shell function. This is actually one of my favorite features of `buildah`, anyway, so I don't really miss the `Containerfile` format.

```bash
app_build() {
    BUILD_DEPS="gcc g++ make musl-dev suitesparse-dev openblas-dev"
    RUNTIME_DEPS="suitesparse"

    # Copy app source
    mkdir -p /opt/app
    cp -a /src/. /opt/app/

    # Copy portable service files
    cp /portable/os-release /usr/lib/os-release
    cp /portable/*.service /usr/lib/systemd/system/

    # Install packages
    apk add --virtual .build-deps $BUILD_DEPS
    apk add $RUNTIME_DEPS

    # Install uv (cached)
    if [ ! -x /cache/uv ]; then
        wget -qO- https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-musl.tar.gz \
            | tar -xz -C /cache --strip-components=1
    fi
    export PATH="/cache:$PATH"

    # Build Python app
    cd /opt/app
    uv sync --no-dev --compile-bytecode

    # Remove build dependencies
    apk del .build-deps
}
```

It's actually more flexible than a Dockerfile—anything you can do in bash within Alpine, you can do here. Without generating a bazillion layers, too.

The trade-off versus Docker multi-stage builds: installed build deps aren't cached, so rebuilds reinstall gcc, et al. every time. But the downloaded packages are cached, and apk installs are fast enough that it doesn't matter much (the build takes about 18 seconds on my 7-year old machine).

The build script bind-mounts a cache directory, so APK packages and Python downloads persist across builds. If you had a lot of build deps, Docker's layer caching might win. You could also implement something like multi-stage builds with overlayfs, but that seemed like overkill for my use case. Also, obviously, you can use remote caches with Docker layers... but this is just some files, so you could probably stick them in an S3 bucket if you wanted (especially now that S3 has compare-and-swap).

Finally, `mksquashfs` compresses the rootfs:

```bash
mksquashfs .mkportable pyapp.raw -noappend -all-root -comp xz
```

The result: a 99MB image with Django, scipy, and scikit-sparse, including all the native deps. Quite lightweight. We didn't go all the way spartan, though, busybox is still there—but that's pretty useful for debugging and it only adds a few MB.

The portable service setup from my previous post handles the running side. This handles the building side, and this is powerful enough to build basically any app that would fit in an Alpine-based Docker image.

## The Code

The full code is at [https://github.com/rishi-kulkarni/python-portable-image](https://github.com/rishi-kulkarni/python-portable-image). The interesting files:

- `scripts/mkportable.sh` – the generic build tool (~130 lines)
- `scripts/pyapp.sh` – the app definition: Alpine version, packages, build steps
- `portable/pyapp.service` – systemd unit with the usual hardening

The app definition is just a shell function. You define `app_build()` with whatever commands you need, and the build script runs it inside the namespace.
