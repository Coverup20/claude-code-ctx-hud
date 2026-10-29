#!/usr/bin/env python3
#
# Install, check or remove the CTX HUD mod on this machine.
#
# Two ways to load the mod, both local, neither touches settings.json:
#   --plugin-dir   the command line prints it; works in any session
#   --link-dir     a junction in the hot-reload folder of one session
#
# The hot-reload folder is keyed by the session id, which this script cannot
# know. Pass it explicitly, e.g.
#   python scripts/install.py --link-dir "%USERPROFILE%\.claude\dev-mods\<session-id>"
#
# A third way, and the steadiest: a junction from the folder Claude Code loads
# plugins out of, which survives every session.
#   mklink /J "%USERPROFILE%\.claude\skills\ctx-hud" "<path>\ctx-hud"

import argparse
import os
import shutil
import subprocess
import sys

VERSION = "0.1.0"
MOD_NAME = "ctx-hud"

MOD_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(cmd):
    # The CLI writes UTF-8 (middle dots, box characters); Windows' default
    # code page cannot decode it, so read the output as UTF-8 explicitly.
    try:
        p = subprocess.run(
            cmd,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
        return p.returncode, p.stdout or "", p.stderr or ""
    except Exception as e:
        return 1, "", str(e)


def check_files():
    # The script finds the mod two folders up from itself, so it must sit in
    # <mod>/scripts/. Copied alone it looks in the drive root and misses all.
    if os.path.basename(os.path.dirname(os.path.abspath(__file__))) != "scripts":
        print(f"install.py must sit in <mod>/scripts/, not in {os.path.dirname(os.path.abspath(__file__))}")
        print("copy the whole ctx-hud folder, then run scripts\\install.py from inside it")
        return False

    needed = [
        os.path.join(MOD_DIR, ".claude-plugin", "plugin.json"),
        os.path.join(MOD_DIR, "hooks", "hooks.json"),
        os.path.join(MOD_DIR, "hooks", "register.tsx"),
        os.path.join(MOD_DIR, "types", "index.d.ts"),
    ]
    missing = [p for p in needed if not os.path.isfile(p)]
    for p in missing:
        print(f"MISSING {p}")

    return not missing


def check_claude():
    if shutil.which("claude") is None:
        print("MISSING claude on PATH")
        return False

    rc, out, _ = run(["claude", "--version"])
    print(f"claude: {out.strip() or 'unknown'}")

    return rc == 0


def validate():
    rc, out, err = run(["claude", "plugin", "validate", MOD_DIR])
    text = (out + err).strip()
    # The default profile must pass; directory-profile warnings are expected
    # until the mod is published (license, icon, marketplace line).
    passed = rc == 0 and "Validation passed" in text
    print("validate: " + ("PASS" if passed else "FAIL"))
    if not passed:
        print(text)

    return passed


def is_our_link(path):
    return os.path.exists(path) and os.path.realpath(path) == os.path.realpath(MOD_DIR)


def link(dev_mods_dir):
    if not os.path.isdir(dev_mods_dir):
        print(f"no such folder: {dev_mods_dir}")
        return False

    target = os.path.join(dev_mods_dir, MOD_NAME)
    if os.path.lexists(target):
        if is_our_link(target):
            print(f"already linked: {target}")
            return True
        print(f"refusing: {target} exists and is not this mod")
        return False

    if os.name != "nt":
        os.symlink(MOD_DIR, target, target_is_directory=True)
    else:
        rc, _, err = run(["cmd", "/c", "mklink", "/J", target, MOD_DIR])
        if rc != 0:
            print(f"mklink failed: {err.strip()}")
            return False

    print(f"linked: {target} -> {MOD_DIR}")

    return True


def unlink(dev_mods_dir):
    target = os.path.join(dev_mods_dir, MOD_NAME)
    if not os.path.lexists(target):
        print(f"nothing to remove: {target}")
        return True
    if not is_our_link(target):
        print(f"refusing: {target} is not a link to this mod")
        return False

    # os.rmdir on a junction removes the link only; the mod's files stay.
    os.rmdir(target)
    print(f"removed link: {target} (mod files untouched)")

    return True


def print_launch():
    print("launch without hot reload:")
    print(f'  claude --plugin-dir "{MOD_DIR}"')


def usage():
    print(f"{MOD_NAME} install.py {VERSION}")
    print("  --check                  verify files, claude and validation")
    print("  --link-dir <dir>         link the mod into a hot-reload folder")
    print("  --unlink-dir <dir>       remove that link (files kept)")
    print("  --print-launch           show the --plugin-dir command")


def main(argv):
    if not argv or "--help" in argv or "-h" in argv:
        usage()
        return 0

    ok = True

    if "--check" in argv:
        ok = check_files() and check_claude() and validate() and ok

    if "--link-dir" in argv:
        i = argv.index("--link-dir")
        ok = link(argv[i + 1]) and ok

    if "--unlink-dir" in argv:
        i = argv.index("--unlink-dir")
        ok = unlink(argv[i + 1]) and ok

    if "--print-launch" in argv:
        print_launch()

    return 0 if ok else 1


sys.exit(main(sys.argv[1:]))
