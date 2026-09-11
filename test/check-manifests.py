#!/usr/bin/env python3
"""Manifest consistency for the plugin.

Five manifests now describe one plugin — the Agent Plugins pair, the Pi package,
and the Codex and Claude bridges. They describe the same thing and will drift
unless something checks, so this does.

Run from the repo root:  python3 test/check-manifests.py
"""

import json
import os
import sys

ROOT = "plugin"
failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}" + (f" — {detail}" if detail else ""))
        failures.append(label)


def load(path):
    with open(path) as fh:
        return json.load(fh)


def main():
    plugin = load(f"{ROOT}/plugin.json")
    pkg = load(f"{ROOT}/package.json")
    codex = load(f"{ROOT}/.codex-plugin/plugin.json")
    claude = load(f"{ROOT}/.claude-plugin/plugin.json")
    mcp = load(f"{ROOT}/mcp.json")
    dot_mcp = load(f"{ROOT}/.mcp.json")
    market = load(".agents/plugins/marketplace.json")

    # The standard's schema URI is the thing that makes a root plugin.json an
    # Agent Plugins manifest at all.
    schema_key = chr(36) + "schema"
    check(
        "root plugin.json declares the standard schema",
        plugin.get(schema_key) == "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        plugin.get(schema_key),
    )

    names = {plugin["name"], pkg["name"], codex["name"], claude["name"]}
    check("every manifest agrees on the name", len(names) == 1, names)

    versions = {plugin.get("version"), pkg.get("version"), codex.get("version"), claude.get("version")}
    check("every manifest agrees on the version", len(versions) == 1, versions)

    # Shipping both filenames with different servers is the documented way to make
    # a client start the wrong one.
    check(
        "mcp.json and .mcp.json carry the same servers",
        mcp["mcpServers"] == dot_mcp["mcpServers"],
        f"{list(mcp['mcpServers'])} vs {list(dot_mcp['mcpServers'])}",
    )

    # Fixed component locations, per the spec.
    check("skills live at skills/", os.path.isdir(f"{ROOT}/skills"))
    check("mcp.json is at the plugin root", os.path.isfile(f"{ROOT}/mcp.json"))

    servers = mcp["mcpServers"]
    check("at least one MCP server is declared", bool(servers))
    for name, server in servers.items():
        check(
            f"mcp server {name} declares a valid transport",
            server.get("type") in ("stdio", "streamable-http", "sse"),
            server.get("type"),
        )
        if server.get("type") == "stdio":
            command = server.get("command", "")
            check(f"mcp server {name} uses a plugin-relative command", command.startswith("./"), command)
            check(
                f"mcp server {name} is executable",
                os.access(os.path.join(ROOT, command.lstrip("./")), os.X_OK),
                command,
            )

    for manifest_name, manifest in (("codex", codex), ("claude", claude)):
        for key in ("skills", "mcpServers"):
            value = manifest.get(key)
            if not isinstance(value, str) or not value.startswith("./"):
                check(f"{manifest_name} {key} is plugin-relative", False, value)
                continue
            target = os.path.join(ROOT, value.lstrip("./"))
            check(f"{manifest_name} {key} points at something real", os.path.exists(target), value)

    entry = next((p for p in market.get("plugins", []) if p["name"] == market["name"]), None)
    check("the local marketplace lists the plugin it is named after", entry is not None)
    if entry:
        source = os.path.join(entry["source"]["path"], ".codex-plugin/plugin.json")
        check("marketplace entry resolves to a Codex plugin", os.path.isfile(source), source)

    print()
    if failures:
        print(f"{len(failures)} manifest problem(s)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
