#ifndef Payload
  #error Payload is required
#endif
#ifndef DepotVersion
  #error DepotVersion is required
#endif
[Setup]
AppId={{CF8CBDDB-177C-493F-A223-C433AA84EFB6}
AppName=ProAnima Depot
AppVersion={#DepotVersion}
AppPublisher=Ian Panaev · ProAnimaStudio
AppPublisherURL=https://github.com/ProAnima/Depot
AppCopyright=Copyright © Ian Panaev. All rights reserved.
DefaultDirName={autopf}\ProAnima\Depot
DefaultGroupName=ProAnima Depot
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
WizardStyle=modern dynamic windows11
WizardSizePercent=120,115
WizardImageFile={#Payload}\wizard.png
DisableWelcomePage=no
LicenseFile=..\..\LICENSE.md
Compression=lzma2/fast
SolidCompression=yes
LZMAUseSeparateProcess=yes
OutputBaseFilename=Depot-Setup-x64
OutputDir={#Output}
UninstallDisplayName=ProAnima Depot
SetupLogging=yes
CloseApplications=no
RestartApplications=no
Uninstallable=yes

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[CustomMessages]
en.WelcomeLabel2=Your storage. Your infrastructure.%n%nSetup includes Node.js, PostgreSQL and service supervision. No developer tools or internet connection are required.%n%nFiles and database remain on this computer. Automatic updates are disabled by default.
ru.WelcomeLabel2=Ваше хранилище. Ваша инфраструктура.%n%nВ комплекте Node.js, PostgreSQL и службы восстановления. Инструменты разработчика и интернет не требуются.%n%nФайлы и база остаются на этом компьютере. Автообновления по умолчанию отключены.
en.OwnerTitle=Your owner account
ru.OwnerTitle=Учётная запись владельца
en.OwnerDescription=Sign in to Depot with these credentials after installation.
ru.OwnerDescription=После установки войдите в Depot с этими данными.
en.OwnerPrompt=Choose a strong password. The recovery key remains in the protected data directory.
ru.OwnerPrompt=Задайте надёжный пароль. Ключ восстановления останется в защищённой папке данных.
en.Name=Name (3-64 letters, digits, dot, dash or underscore):
ru.Name=Имя (3-64 латинских символа, цифры, точка, дефис, подчёркивание):
en.Password=Password (at least 12 characters):
ru.Password=Пароль (не менее 12 символов):
en.Confirm=Confirm password:
ru.Confirm=Повторите пароль:
en.InvalidOwner=Use a name of 3-64 Latin letters, digits, dots, dashes or underscores, and matching passwords of 12-128 characters.
ru.InvalidOwner=Имя: 3-64 латинских символа, цифры, точка, дефис или подчёркивание. Совпадающие пароли: 12-128 символов.
en.OpenDepot=Open Depot and finish onboarding
ru.OpenDepot=Открыть Depot и пройти знакомство
en.InstallFailed=Depot configuration did not finish. Your data has been preserved. Inspect the setup log and database service logs before retrying.
ru.InstallFailed=Настройка Depot не завершена. Данные сохранены. Проверьте журнал установки и журналы службы базы перед повтором.
en.Configuring=Preparing the database, services and owner account…
ru.Configuring=Подготовка базы, служб и учётной записи владельца…
en.RuntimeReboot=Microsoft runtime requires a restart. Restart Windows and run Setup again; your existing Depot data has been preserved.
ru.RuntimeReboot=Компонент Microsoft требует перезагрузки. Перезагрузите Windows и запустите установщик снова; существующие данные Depot сохранены.

[Files]
Source: "{#Payload}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Depot"; Filename: "http://127.0.0.1:8080/console/"
Name: "{group}\API and CLI"; Filename: "http://127.0.0.1:8080/console/#help"

[Run]
Filename: "http://127.0.0.1:8080/console/#onboarding"; Description: "{cm:OpenDepot}"; Flags: shellexec postinstall skipifsilent runasoriginaluser

[Code]
var OwnerPage: TInputQueryWizardPage;

function DataRoot: String;
begin
  Result := ExpandConstant('{commonappdata}\ProAnima\Depot');
end;

procedure InitializeWizard;
begin
  WizardForm.WelcomeLabel2.Caption := CustomMessage('WelcomeLabel2');
  OwnerPage := CreateInputQueryPage(wpWelcome, CustomMessage('OwnerTitle'), CustomMessage('OwnerDescription'), CustomMessage('OwnerPrompt'));
  OwnerPage.Add(CustomMessage('Name'), False);
  OwnerPage.Add(CustomMessage('Password'), True);
  OwnerPage.Add(CustomMessage('Confirm'), True);
  OwnerPage.Values[0] := 'admin';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = OwnerPage.ID) and (WizardSilent or FileExists(DataRoot + '\installation.json'));
end;

function ValidName(Value: String): Boolean;
var I: Integer;
begin
  Result := (Length(Value) >= 3) and (Length(Value) <= 64);
  for I := 1 to Length(Value) do
    if Pos(Value[I], 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-') = 0 then Result := False;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  // Inno simulates Next clicks during silent setup; credentials come from OWNERFILE there.
  if WizardSilent then Exit;
  if (CurPageID = OwnerPage.ID) and ((not ValidName(OwnerPage.Values[0])) or (Length(OwnerPage.Values[1]) < 12) or (Length(OwnerPage.Values[1]) > 128) or (OwnerPage.Values[1] <> OwnerPage.Values[2])) then begin
    SuppressibleMsgBox(CustomMessage('InvalidOwner'), mbError, MB_OK, IDOK); Result := False;
  end;
end;

function JsonString(Value: String): String;
begin
  StringChangeEx(Value, '\', '\\', True);
  StringChangeEx(Value, '"', '\"', True);
  StringChangeEx(Value, #13, '\r', True);
  StringChangeEx(Value, #10, '\n', True);
  StringChangeEx(Value, #9, '\t', True);
  Result := '"' + Value + '"';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var Code: Integer; Args, OwnerFile: String;
begin
  if CurStep <> ssPostInstall then Exit;
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\prepare.ps1') + '" -Root "' + DataRoot + '" -Payload "' + ExpandConstant('{app}') + '"', '', SW_HIDE, ewWaitUntilTerminated, Code) then RaiseException(CustomMessage('InstallFailed'));
  if Code = 3010 then RaiseException(CustomMessage('RuntimeReboot'));
  if Code <> 0 then RaiseException(CustomMessage('InstallFailed'));
  Args := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\apply.ps1') + '" -Root "' + DataRoot + '" -Payload "' + ExpandConstant('{app}') + '"';
  if not FileExists(DataRoot + '\installation.json') then begin
    // Silent deployment supplies an ACL-protected JSON file, never a password argument.
    OwnerFile := ExpandConstant('{param:OWNERFILE|}');
    if not WizardSilent then begin
      OwnerFile := DataRoot + '\bootstrap.owner';
      if not SaveStringToFile(OwnerFile, UTF8Encode('{"name":' + JsonString(OwnerPage.Values[0]) + ',"password":' + JsonString(OwnerPage.Values[1]) + '}'), False) then RaiseException(CustomMessage('InstallFailed'));
    end;
    if OwnerFile <> '' then Args := Args + ' -OwnerFile "' + OwnerFile + '"';
  end;
  WizardForm.StatusLabel.Caption := CustomMessage('Configuring');
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Args, '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then RaiseException(CustomMessage('InstallFailed'));
  OwnerPage.Values[1] := ''; OwnerPage.Values[2] := '';
end;

function InitializeUninstall(): Boolean;
var Code: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\remove.ps1') + '" -Root "' + DataRoot + '"', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;
