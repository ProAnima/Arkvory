#ifndef Payload
  #error Payload is required
#endif
[Setup]
SetupIconFile={#Payload}\arkvory-cli.ico
UninstallDisplayIcon={app}\arkvory-cli.ico
AppId={{7E91994D-B6CA-4DBA-9756-C074A1A83441}
AppName=ProAnima Arkvory CLI
AppVersion={#ArkvoryVersion}
AppPublisher=Ian Panaev · ProAnimaStudio
AppPublisherURL=https://github.com/ProAnima/Arkvory
AppCopyright=Copyright © Ian Panaev. All rights reserved.
DefaultDirName={localappdata}\Programs\ProAnima\Arkvory CLI
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableWelcomePage=no
WizardStyle=modern dynamic windows11
WizardSizePercent=120,115
WizardImageFile={#Payload}\wizard.png
Compression=lzma2/fast
SolidCompression=yes
OutputBaseFilename=Arkvory-CLI-Setup-x64
OutputDir={#Output}
UninstallDisplayName=ProAnima Arkvory CLI
ChangesEnvironment=yes
SetupLogging=yes

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"; LicenseFile: "..\legal\EULA.en.txt"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"; LicenseFile: "..\legal\EULA.ru.txt"

[CustomMessages]
en.WelcomeLabel2=Your storage, from your terminal.%n%nInstall arkvoryctl for this user. Node.js is included; no administrator account, database or server services are needed.%n%nAfter setup, open a new terminal and run arkvoryctl --help. Connect to your server with a profile and a private key file.
ru.WelcomeLabel2=Ваше хранилище — в вашем терминале.%n%nУстановка arkvoryctl для текущего пользователя. Node.js включён; права администратора, база данных и службы сервера не нужны.%n%nПосле установки откройте новый терминал и выполните arkvoryctl --help --lang ru. Подключитесь к серверу через профиль и файл ключа.
en.OpenRemote=Open Arkvory Remote Setup
ru.OpenRemote=Открыть мастер удалённой установки Arkvory

[Files]
Source: "{#Payload}\*"; DestDir: "{app}"; Flags: ignoreversion; Excludes: "wizard.png"

[Icons]
Name: "{autoprograms}\Arkvory Remote Setup"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\remote-setup.ps1"""; Flags: runminimized; IconFilename: "{app}\arkvory-remote.ico"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\remote-setup.ps1"""; Description: "{cm:OpenRemote}"; Flags: nowait postinstall skipifsilent runhidden

[Code]
procedure UpdatePath(Remove: Boolean);
var Current, Segment, ResultPath, Target: String; Split: Integer;
begin
  RegQueryStringValue(HKCU, 'Environment', 'Path', Current);
  Target := ExpandConstant('{app}');
  ResultPath := '';
  while Current <> '' do begin
    Split := Pos(';', Current);
    if Split = 0 then begin Segment := Current; Current := ''; end
    else begin Segment := Copy(Current, 1, Split - 1); Delete(Current, 1, Split); end;
    if (Segment <> '') and (CompareText(Segment, Target) <> 0) then begin
      if ResultPath <> '' then ResultPath := ResultPath + ';';
      ResultPath := ResultPath + Segment;
    end;
  end;
  if not Remove then begin
    if ResultPath <> '' then ResultPath := ResultPath + ';';
    ResultPath := ResultPath + Target;
  end;
  if not RegWriteExpandStringValue(HKCU, 'Environment', 'Path', ResultPath) then
    RaiseException('Unable to update user PATH');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then UpdatePath(False);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then UpdatePath(True);
end;
