; Discord Video Compressor — NSIS installer
; Run via: makensis installer.nsi   (after `npm run build`)

!define APP_NAME       "Discord Video Compressor"
!define APP_VERSION    "1.1.0"
!define APP_PUBLISHER  "Neko"
!define APP_EXE        "Discord Video Compressor.exe"
!define APP_DIR_NAME   "DiscordVideoCompressor"
!define UNINST_KEY     "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_DIR_NAME}"

Unicode True
SetCompressor /SOLID lzma
RequestExecutionLevel admin

Name "${APP_NAME}"
OutFile "..\dist\DiscordVideoCompressor-Setup.exe"
InstallDir "$PROGRAMFILES64\${APP_DIR_NAME}"
InstallDirRegKey HKLM "Software\${APP_DIR_NAME}" "InstallDir"
ShowInstDetails show
ShowUninstDetails show
BrandingText "${APP_NAME} ${APP_VERSION}"

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define MUI_ICON   "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install" SecInstall
  SetOutPath "$INSTDIR"
  ; Pull the entire packaged Electron app folder.
  File /r "..\dist\Discord Video Compressor-win32-x64\*.*"

  ; Bundle the ffmpeg setup script.
  SetOutPath "$INSTDIR"
  File "install_ffmpeg.ps1"

  ; Detect ffmpeg; if absent, download essentials build into $INSTDIR\ffmpeg.
  DetailPrint "Checking for ffmpeg..."
  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\install_ffmpeg.ps1" -TargetDir "$INSTDIR\ffmpeg"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK \
      "Couldn't auto-install ffmpeg (exit $0).$\r$\n$\r$\nThe app will still install, but you'll need to install ffmpeg manually for compression to work.$\r$\n$\r$\nDetails:$\r$\n$1"
  ${EndIf}

  ; Start Menu shortcut
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut  "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" \
                  "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortCut  "$SMPROGRAMS\${APP_NAME}\Uninstall.lnk" \
                  "$INSTDIR\Uninstall.exe"

  ; Desktop shortcut
  CreateShortCut  "$DESKTOP\${APP_NAME}.lnk" \
                  "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  ; Uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\${APP_DIR_NAME}" "InstallDir" "$INSTDIR"

  ; Add/Remove Programs entry
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon"     "$INSTDIR\${APP_EXE}"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1

  ; Estimated size in KB
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Uninstall.lnk"
  RMDir  "$SMPROGRAMS\${APP_NAME}"

  RMDir /r "$INSTDIR"

  DeleteRegKey HKLM "${UNINST_KEY}"
  DeleteRegKey HKLM "Software\${APP_DIR_NAME}"
SectionEnd
