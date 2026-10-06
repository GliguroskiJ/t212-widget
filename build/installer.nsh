!macro customUnInstall
  ; remove the "Start with Windows" entry the app created - but only on a real uninstall.
  ; Installing a new version runs the old uninstaller with --updated; keep autostart then.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "cz.jovan.t212widget"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "cz.jovan.t212widget"
  ${endIf}
!macroend
