!macro NSIS_HOOK_POSTUNINSTALL
  ; Tauri invokes the old uninstaller with /UPDATE during app updates.
  ; Keep integrations and transient state intact for that maintenance flow.
  ${If} $UpdateMode <> 1
    DeleteRegKey HKCU "Software\Classes\Directory\shell\OrqetoDev"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OrqetoDev"
    DeleteRegKey HKCU "Software\Orqeto\Orqeto Dev"
    RMDir /r "$TEMP\orqeto-dev"
  ${EndIf}
!macroend
