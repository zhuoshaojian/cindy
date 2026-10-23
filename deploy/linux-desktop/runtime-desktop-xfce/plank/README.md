# Cloud Dock preferences visibility

The cloud image omits Plank's Preferences menu item and disables its shared
`preferences` action. Ctrl+right-click, `plank --preferences`, and D-Bus activation
therefore cannot open the panel. The CLI option is hidden from help but remains
accepted as a no-op for compatibility. Application menus, clock options, launch,
minimize/restore, and the existing `lock-items=true` default remain unchanged.
This is a UI policy, not a restriction on editing configuration files.

The complete image Dockerfile builds only `libplank.so.1.0.0`, retaining the stock
executable, docklets, themes and translations. The build checks that all original
exported ABI symbols remain present. Build tools never enter the runtime layer.
The prepared build cache retains the resulting library between cloud revisions.

Sources are Plank 0.11.89 and Debian packaging revision 4 from
`https://deb.debian.org/debian/pool/main/p/plank/`. Both source archives are
SHA-256 pinned in `build.sh` and the Dockerfile. Apply Debian's patch series first,
then `hide-preferences.patch`; dependencies use the base's signed, fixed-date
Debian snapshots and the direct versions in `build-deps.txt`.

Plank is GPL-3.0-or-later. Its original copyright notices remain installed.
The modified library's corresponding source archives, patch and build recipe
are also installed in `/usr/share/doc/cindy-plank/source/`. To rebuild with the
documented compiler dependencies and the original Debian libplank installed:

```sh
bash build.sh /path/to/source-archives /path/to/new-output
```

Release smoke tests query the running Dock's real GAction over its private
session bus, invoke the CLI entry, and verify no Preferences window appears.
Menu appearance and launch/minimize/restore are checked separately in isolated X11.
