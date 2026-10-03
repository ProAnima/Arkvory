Name: proanima-arkvory
Version: @VERSION@
Release: 1
Summary: ProAnima Arkvory UPack and file storage
License: LicenseRef-ProAnima-Arkvory-1.0
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
Copyright Ian Panaev, ProAnimaStudio. Free of charge under the ProAnima Arkvory License 1.0 (LICENSE.md).

%install
mkdir -p %{buildroot}/usr
cp -a "@TREE@/usr/." %{buildroot}/usr/

%post
%include @TREE@/DEBIAN/postinst

%preun
%include @TREE@/DEBIAN/prerm

%files
/usr/lib/proanima-arkvory
/usr/bin/arkvory
/usr/share/applications/arkvory.desktop

/usr/share/icons/hicolor/scalable/apps/arkvory.svg
