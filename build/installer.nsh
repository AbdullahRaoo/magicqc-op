; ============================================================
; MagicQC — Enterprise NSIS installer hooks
; - Robust process termination before install/uninstall
; - Clears stale Electron & Python caches on upgrade
; - Chain-runs the MagicCamera SDK installer if needed
; - Offers "Start on Windows startup" checkbox
; - Full cleanup on uninstall (registry, cache, auto-start)
; ============================================================

; ── Helper: robust kill of all MagicQC processes ─────────────
; Attempts multiple kill strategies and waits for OS handle release.
!macro _KillMagicQC
  DetailPrint "Stopping running MagicQC processes..."

  ; ── Round 1: Graceful close via window message ──────────────
  ; Attempt a clean shutdown first (WM_CLOSE) so the app can release
  ; camera handles and flush data before we force-kill.
  nsExec::ExecToLog 'taskkill /IM "MagicQC.exe"'
  Sleep 2000

  ; ── Round 2: Force-kill the Electron app + child tree ───────
  nsExec::ExecToLog 'taskkill /F /IM "MagicQC.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "magicqc_core.exe" /T'

  ; ── Round 3: Catch orphaned Python processes ────────────────
  ; If magicqc_core.exe was spawned and then the parent crashed,
  ; the child may be orphaned. Use WMIC as a secondary sweep.
  nsExec::ExecToLog 'wmic process where "name=$$"magicqc_core.exe$$"" call terminate'

  ; ── Wait for OS to fully release device handles ─────────────
  ; Camera USB handles (MVCAMSDK_X64.dll) need time to be freed
  ; by Windows after process termination.  3 seconds is safe.
  Sleep 3000

  ; ── Round 4: Verify — retry if still running ────────────────
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq magicqc_core.exe" /NH'
  Pop $0
  Pop $1
  ; $1 contains tasklist output — if it says "magicqc_core.exe", force-kill again
  StrCpy $2 $1 18 ; first 18 chars
  ${If} $2 == "magicqc_core.exe"
    DetailPrint "Process still running — force-killing again..."
    nsExec::ExecToLog 'taskkill /F /IM "magicqc_core.exe" /T'
    Sleep 2000
  ${EndIf}

  DetailPrint "All MagicQC processes stopped."
!macroend

; ── Helper: clean Electron caches (upgrade hygiene) ──────────
; Removes stale Chromium caches from %APPDATA%\operatorpannel
; while preserving user data (Local Storage, secure/, storage/).
!macro _CleanElectronCache
  ; $APPDATA is e.g. C:\Users\<user>\AppData\Roaming
  StrCpy $R0 "$APPDATA\operatorpannel"

  IfFileExists "$R0\*.*" 0 CacheCleanDone

  DetailPrint "Cleaning stale Electron caches for upgrade..."

  ; Chromium HTTP cache — always safe to delete
  RMDir /r "$R0\Cache"
  RMDir /r "$R0\Code Cache"
  RMDir /r "$R0\GPUCache"
  RMDir /r "$R0\DawnCache"
  RMDir /r "$R0\DawnWebGPUCache"

  ; Session data — ephemeral, safe to clear on upgrade
  RMDir /r "$R0\Session Storage"
  RMDir /r "$R0\blob_storage"
  RMDir /r "$R0\Service Worker"
  RMDir /r "$R0\Shared Dictionary"
  RMDir /r "$R0\Network"

  ; Old crash/dump data
  Delete "$R0\Crashpad\reports\*.*"
  RMDir /r "$R0\Crashpad\reports"

  ; Stale Python temp files (measurement worker leftovers)
  RMDir /r "$R0\temp_measure"
  Delete "$R0\temp_annotations\__validation__.json"

  ; Old log files (keep the directory, clear contents)
  Delete "$R0\logs\*.log"
  Delete "$R0\logs\*.log.txt"

  DetailPrint "Cache cleanup complete."

  CacheCleanDone:
!macroend

; ── customInit: runs at the START of installation ─────────────
; Ensures no running instance blocks file overwrites and cleans
; stale caches to prevent upgrade issues.
!macro customInit
  !insertmacro _KillMagicQC
  !insertmacro _CleanElectronCache
!macroend

; ── customInstall: runs AFTER files are copied ────────────────
!macro customInstall
  ; Check if MagicCamera SDK is already installed
  IfFileExists "$PROGRAMFILES\MindVision\*.*" SkipMagicCamera 0
  IfFileExists "$PROGRAMFILES32\MindVision\*.*" SkipMagicCamera 0

  ; SDK not found — ask the user
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "MagicQC requires the MagicCamera SDK for measurement features.$\r$\n$\r$\nWould you like to install it now?$\r$\n$\r$\n(You can skip this if you don't need camera measurement yet)" \
    IDYES InstallMagicCamera IDNO SkipMagicCamera

  InstallMagicCamera:
    ; The SDK installer is bundled in the extraResources
    DetailPrint "Installing MagicCamera SDK..."
    SetDetailsPrint textonly

    ; Run the MagicCamera installer and wait for it to finish
    ; /S = silent install (if the installer supports it — remove if it doesn't)
    nsExec::ExecToLog '"$INSTDIR\resources\installers\MagicCamera_SDK_Setup.exe" /S'
    Pop $0
    ${If} $0 != "0"
      ; Silent install failed or not supported — try interactive
      ExecWait '"$INSTDIR\resources\installers\MagicCamera_SDK_Setup.exe"'
    ${EndIf}

    DetailPrint "MagicCamera SDK installation completed."

  SkipMagicCamera:

  ; ── Auto-start on Windows startup checkbox ──────────────────
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Would you like MagicQC to start automatically when Windows starts?" \
    IDYES EnableAutoStart IDNO SkipAutoStart

  EnableAutoStart:
    ; Write to HKLM Run key (per-machine install → needs the machine-wide key)
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" \
      "MagicQC" '"$INSTDIR\MagicQC.exe"'
    DetailPrint "MagicQC will start automatically on Windows startup."
    Goto AutoStartDone

  SkipAutoStart:
    ; Remove the key in case it was set by a previous install
    DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "MagicQC"
    DetailPrint "MagicQC will NOT start on Windows startup."

  AutoStartDone:
!macroend

; ── customUnInit: runs at the START of uninstallation ─────────
; Ensures no running instance blocks file deletion.
!macro customUnInit
  !insertmacro _KillMagicQC
!macroend

; ── customUnInstall: full cleanup on uninstall ────────────────
!macro customUnInstall
  ; Remove auto-start registry key
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "MagicQC"

  ; Ask user if they want to remove all application data
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to remove all MagicQC application data?$\r$\n$\r$\n\
     This includes cached measurements, logs, calibration settings,$\r$\n\
     and temporary files.$\r$\n$\r$\n\
     Select 'No' to keep your data for future installations." \
    IDYES RemoveAppData IDNO KeepAppData

  RemoveAppData:
    ; Remove all data under %APPDATA%\operatorpannel
    RMDir /r "$APPDATA\operatorpannel"
    DetailPrint "All application data removed."
    Goto UninstallCleanupDone

  KeepAppData:
    ; Still clean caches even if user wants to keep data
    !insertmacro _CleanElectronCache
    DetailPrint "Application data preserved. Caches cleaned."

  UninstallCleanupDone:
!macroend
