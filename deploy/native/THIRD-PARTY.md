# Dependencies distributed with native installers

Depot remains proprietary, copyright Ian Panaev. Independent components retain their own licenses:

- Node.js 24.21.0: MIT and bundled notices in `runtime/NODE-LICENSE.txt` (Linux: `NODE-LICENSE.txt`).
- PostgreSQL 18.4 Windows binaries supplied by EDB: `runtime/postgres/server_license.txt`, `commandlinetools_3rd_party_licenses.txt` and `doc`. Linux uses distribution packages with their original notices.
- WinSW 2.12.0: MIT, copyright 2008–2020 Kohsuke Kawaguchi, Sun Microsystems, Inc., CloudBees, Inc., Oleg Nenashev, and other contributors. https://github.com/winsw/winsw/blob/v2.12.0/LICENSE.txt
- Microsoft Visual C++ Redistributable x64: Microsoft redistribution license and bundled installer terms. https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist
- Inno Setup 6.7.3 is a build tool, not a Depot runtime dependency. License: https://github.com/jrsoftware/issrc/blob/is-6_7_3/license.txt . Commercial licensing guidance: https://jrsoftware.org/isorder.php .

Versions, origin URLs and SHA-256 values are pinned in `scripts/native-dependencies.mjs`. Dependency upgrades require new checksums and native acceptance. Database major upgrades are operator maintenance, never an automatic side effect of updating Depot.
