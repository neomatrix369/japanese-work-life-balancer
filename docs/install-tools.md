# Installing the tools from scratch

You need **JDK 21+, Maven 3.9+, Node 20+ and Python 3.11+**, plus `make`, `git` and `curl`. If `make check`
already passes, skip this page and go back to the [quick start](../README.md#quick-start).

[← Back to the main README](../README.md)

## macOS

1. Install the Xcode command-line tools (gives `make`, `git` and `curl`) and [Homebrew](https://brew.sh/):

   ```bash
   xcode-select --install
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. Install the toolchain:

   ```bash
   brew install openjdk@21 maven node python
   brew install uv jq            # optional
   ```

   `python` gives a current `python3`; macOS's own `/usr/bin/python3` (3.9) is too old.

3. Make Homebrew's JDK 21 the one Maven uses, and put Homebrew first on your `PATH` (add both lines to `~/.zshrc`):

   ```bash
   export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
   export PATH="$(brew --prefix)/bin:$PATH"
   ```

4. Open a new terminal, then `make check`.

**Already have other versions installed?** That's the most common snag. `make check` names every `mvn` it finds
and the JDK it used. Point the build at the right ones without changing your shell:
`make setup JAVA_HOME=/path/to/jdk-21 MVN=/path/to/mvn` (pass the same to `make demo`). A JDK downloaded by IntelliJ
lives in `~/.jdks/<name>/Contents/Home`; `/usr/libexec/java_home` does not list it.

## Linux (Ubuntu 24.04 / Debian)

Ubuntu's own packages are fine for Java and Python but **too old for Maven (apt: 3.8.7) and Node (apt: 18.x)**,
so those two come from their official downloads. Tested on a blank Ubuntu 24.04 container (2026-10-30).

```bash
# 1. Base tools, JDK 21, Python 3 (+ venv, used when uv is absent)
sudo apt-get update
sudo apt-get install -y git make curl ca-certificates xz-utils openjdk-21-jdk python3 python3-venv jq

# 2. Maven 3.9 (apt's 3.8.7 is too old) — https://maven.apache.org/download.cgi
MVN_VERSION=3.9.9
curl -fsSL https://archive.apache.org/dist/maven/maven-3/$MVN_VERSION/binaries/apache-maven-$MVN_VERSION-bin.tar.gz \
  | sudo tar xz -C /opt

# 3. Node 20+ (apt's 18.x is too old) — https://nodejs.org/en/download
NODE_VERSION=20.19.0
NODE_ARCH=$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')
curl -fsSL https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz \
  | sudo tar xJ -C /opt --no-same-owner

# 4. Optional: uv, for faster Python installs — https://docs.astral.sh/uv/
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Then add to `~/.bashrc` (or `~/.zshrc`) and open a new terminal:

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-$(dpkg --print-architecture)
export PATH="/opt/apache-maven-3.9.9/bin:/opt/node-v20.19.0-linux-$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')/bin:$HOME/.local/bin:$PATH"
```

Prefer a version manager? [SDKMAN](https://sdkman.io/) (`sdk install java 21-tem`, `sdk install maven`) and
[nvm](https://github.com/nvm-sh/nvm) (`nvm install 20`) work just as well; [NodeSource](https://github.com/nodesource/distributions)
also provides a newer Node via apt.

On a blank machine the first `make demo` takes about a minute before the model answers, because Maven downloads
the solver and Quarkus libraries once; later starts take ~20 s.

## Windows

Use [WSL 2](https://learn.microsoft.com/windows/wsl/install) with Ubuntu, then follow the Linux steps inside it.
Open the app from your Windows browser at `http://localhost:5173` as usual.

## Then

```bash
make check     # all OK?
make setup
make demo      # open http://localhost:5173
```

Optional accounts (premium voice, Timefold Enterprise): [external-services.md](external-services.md).
