Name: proanima-arkvory-cli
Version: @VERSION@
Release: 1
Summary: ProAnima Arkvory remote command-line client
License: Proprietary
BuildArch: x86_64
Requires: ca-certificates
Requires: xdg-utils
Requires: glibc >= 2.28
Requires: libstdc++
Requires: libatomic
AutoReqProv: no
%global debug_package %{nil}

%description
Remote file transfers and repository management with a bundled Node.js runtime.
Copyright Ian Panaev. All rights reserved.

%install
mkdir -p %{buildroot}/usr
cp -a "@TREE@/usr/." %{buildroot}/usr/

%files
/usr/lib/proanima-arkvory-cli
/usr/bin/arkvoryctl
/usr/bin/arkvory-remote
/usr/share/applications/arkvory-remote.desktop

/usr/share/icons/hicolor/scalable/apps/arkvory-remote.svg
