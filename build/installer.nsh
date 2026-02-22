; ============================================================
; MagicQC — Custom NSIS installer hooks
; - Kills running MagicQC processes before install/uninstall
; - Chain-runs the MagicCamera SDK installer if needed
; ============================================================

; ── Helper: kill all MagicQC processes ────────────────────────
!macro _KillMagicQC
  ; Kill the Electron app and all child processes (Python server, etc.)
  nsExec::ExecToLog 'taskkill /F /IM "MagicQC.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "magicqc_core.exe" /T'
  ; Give the OS a moment to release file handles
  Sleep 1500
!macroend

; ── customInit: runs at the START of installation ─────────────
; Ensures no running instance blocks file overwrites.
!macro customInit
  !insertmacro _KillMagicQC
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
!macroend

; ── customUnInit: runs at the START of uninstallation ─────────
; Ensures no running instance blocks file deletion.
!macro customUnInit
  !insertmacro _KillMagicQC
!macroend
