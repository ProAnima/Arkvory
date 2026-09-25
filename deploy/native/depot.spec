Name: proanima-depot
Version: @VERSION@
Release: 1
Summary: ProAnima Depot UPack and file storage
License: Proprietary
BuildArch: x86_64
Requires: postgresql-server >= 16
Requires: systemd
Requires: python3
Requires: ca-certificates
Requires: glibc >= 2.28
Requires: libstdc++
Requires: libatomic
AutoReqProv: no
%global debug_package %{nil}

%description
Autonomous file storage, dedicated local database and supervised services.
Copyright Ian Panaev. All rights reserved.

%install
mkdir -p %{buildroot}/usr
cp -a "@TREE@/usr/." %{buildroot}/usr/

%post
%include @TREE@/DEBIAN/postinst

%preun
%include @TREE@/DEBIAN/prerm

%files
/usr/lib/proanima-depot
/usr/bin/depot
/usr/share/applications/depot.desktop
